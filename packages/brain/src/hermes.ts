import { redact } from "@galahad/core";
import type { AgentDriver } from "./agents.ts";

/*
 * Hermes' supported ACP protocol works on v0.21.1, whose CLI predates stream-json.
 * Python is already required by runAgent and Hermes. This stdlib bridge runs INSIDE
 * the assigned sandbox: no host tools, owner config, provider keys or arm tokens.
 * Its profile and ACP session database survive subsequent runs in that workspace.
 */
export const HERMES_ACP_BRIDGE = String.raw`import argparse, json, os, selectors, signal, subprocess, sys, time
from pathlib import Path
from urllib.parse import urlsplit

def emit(kind, **fields):
    event = dict(type=kind, **fields)
    # runAgent polls bounded JSONL lines. Clip prose without ever splitting JSON.
    while len(json.dumps(event, ensure_ascii=False).encode()) > 16000:
        strings = [k for k, v in event.items() if k != "type" and isinstance(v, str) and len(v) > 100]
        if not strings:
            break
        key = max(strings, key=lambda k: len(event[k]))
        event[key] = event[key][:len(event[key]) // 2] + "…"
    print(json.dumps(event, ensure_ascii=False), flush=True)

def content_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        if content.get("type") == "text":
            return str(content.get("text", ""))
        return content_text(content.get("content", ""))
    if isinstance(content, list):
        return "\n".join(content_text(c) for c in content)
    return ""

def value_text(value):
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)

def gateway_environment(path):
    values = {k: os.environ.get(k, "") for k in ("OPENAI_API_KEY", "GALAHAD_GATEWAY")}
    if path.exists():
        if path.stat().st_size > 16384:
            raise RuntimeError("Galahad gateway environment file is too large")
        try:
            fresh = json.loads(path.read_text())
        except (ValueError, OSError):
            raise RuntimeError("Galahad gateway environment file is invalid") from None
        if not isinstance(fresh, dict) or any(not isinstance(fresh.get(k), str) or not fresh[k] for k in values):
            raise RuntimeError("Galahad gateway environment file is incomplete")
        values.update({k: fresh[k] for k in values})
    if not all(values.values()):
        raise RuntimeError("Hermes needs this workspace's Galahad gateway endpoint and token")
    url = urlsplit(values["GALAHAD_GATEWAY"])
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise RuntimeError("Galahad gateway endpoint is invalid")
    return values

class Bridge:
    def __init__(self, args):
        self.args, self.session, self.child = args, args.session, None
        self.sequence, self.buffer = 0, b""
        self.active, self.cancelled, self.stopping = False, False, None
        self.tools, self.completed, self.text = {}, set(), ""
        self.selector = selectors.DefaultSelector()

    def send(self, message):
        self.child.stdin.write((json.dumps(message) + "\n").encode())
        self.child.stdin.flush()

    def cancel(self, *_):
        if self.stopping is None:
            self.cancelled, self.stopping = True, time.monotonic()
            if self.child and self.child.poll() is None and self.session:
                try:
                    self.send({"jsonrpc": "2.0", "method": "session/cancel", "params": {"sessionId": self.session}})
                except (OSError, ValueError):
                    pass

    def message(self, message):
        method, params = message.get("method"), message.get("params") or {}
        if "id" in message and method:
            # We never advertise host filesystem/terminal access. Permission requests
            # outside Hermes' workspace-edit mode fail closed, with no standing grant.
            if method == "session/request_permission":
                result = {"outcome": {"outcome": "cancelled"}}
                self.send({"jsonrpc": "2.0", "id": message["id"], "result": result})
            else:
                self.send({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "Galahad exposes no client resources"}})
            return
        # session/load replays history before its response: never count replayed work.
        if method != "session/update" or not self.active or params.get("sessionId") != self.session:
            return
        update = params.get("update") or {}
        kind = update.get("sessionUpdate")
        if kind == "agent_message_chunk":
            self.text = (self.text + content_text(update.get("content")))[-24000:]
        elif kind in ("tool_call", "tool_call_update"):
            ident = update.get("toolCallId")
            if not isinstance(ident, str) or ident in self.completed:
                return
            item = self.tools.setdefault(ident, {})
            if kind == "tool_call":
                item["input"] = value_text(update["rawInput"]) if "rawInput" in update else content_text(update.get("content"))
            item.update({k: v for k, v in update.items() if v is not None})
            if item.get("status") in ("completed", "failed"):
                self.completed.add(ident)
                emit("tool", tool=str(item.get("title") or item.get("kind") or "tool")[:200],
                     input=item.get("input", "")[:2000],
                     output=(value_text(item["rawOutput"]) if "rawOutput" in item else content_text(update.get("content")))[:4000],
                     ok=item["status"] == "completed")
                self.tools.pop(ident, None)
                if len(self.completed) >= self.args.max_tools:
                    emit("error", message="Hermes reached this run's tool budget")
                    self.cancel()

    def request(self, method, params, timeout=45):
        self.sequence += 1
        ident = self.sequence
        self.send({"jsonrpc": "2.0", "id": ident, "method": method, "params": params})
        until = time.monotonic() + timeout
        while True:
            if self.stopping is not None and time.monotonic() - self.stopping > 3:
                raise RuntimeError("Hermes run was cancelled")
            if time.monotonic() > until:
                self.cancel()
                raise RuntimeError("Hermes ACP timed out during " + method)
            if not self.selector.select(0.2):
                if self.child.poll() is not None:
                    raise RuntimeError("Hermes ACP exited during " + method)
                continue
            chunk = os.read(self.child.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError("Hermes ACP closed its protocol stream during " + method)
            self.buffer += chunk
            if len(self.buffer) > 2000000:
                raise RuntimeError("Hermes ACP exceeded the protocol message limit")
            while b"\n" in self.buffer:
                raw, self.buffer = self.buffer.split(b"\n", 1)
                try:
                    message = json.loads(raw)
                except (ValueError, UnicodeError):
                    raise RuntimeError("Hermes ACP returned invalid JSON") from None
                if not isinstance(message, dict):
                    raise RuntimeError("Hermes ACP returned an invalid message")
                if message.get("id") == ident and "method" not in message:
                    if "error" in message:
                        # Provider errors can contain request headers. Never echo raw RPC errors.
                        raise RuntimeError("Hermes ACP rejected " + method)
                    return message.get("result")
                self.message(message)

    def run(self):
        args = self.args
        home = Path(args.home).resolve()
        home.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Deliberate allowlist: no owner credentials, SSH agent, proxy, PYTHONPATH or
        # ambient plugin settings. This dedicated profile belongs to this VM alone.
        env = {k: os.environ[k] for k in ("PATH", "LANG", "LC_ALL", "TMPDIR", "TERM") if k in os.environ}
        env.update({"HOME": str(home.parent), "HERMES_HOME": str(home), "PYTHONUNBUFFERED": "1"})
        if not args.check:
            env.update(gateway_environment(Path(args.gateway_env)))
            base = env["GALAHAD_GATEWAY"].rstrip("/") + "/" + args.provider
            config = {"model": {"provider": "custom:galahad", "default": args.model},
                      "providers": {"galahad": {"base_url": base, "key_env": "OPENAI_API_KEY",
                                    "transport": "chat_completions", "default_model": args.model,
                                    "discover_models": False, "models": [args.model]}},
                      "terminal": {"backend": "local", "cwd": os.getcwd()},
                      "memory": {"provider": "builtin"}}
            # JSON is a YAML subset. No secret is written to this configuration.
            target = home / "config.yaml"
            target.write_text(json.dumps(config))
            target.chmod(0o600)
        checked = subprocess.run(["hermes", "acp", "--check"], env=env, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        if checked.returncode:
            raise RuntimeError("Hermes ACP is unavailable; install Hermes with ACP support in this workspace")
        self.child = subprocess.Popen(["hermes", "acp"], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr)
        self.selector.register(self.child.stdout, selectors.EVENT_READ)
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, self.cancel)
        initialized = self.request("initialize", {"protocolVersion": 1, "clientCapabilities": {},
                                   "clientInfo": {"name": "galahad", "version": "1"}})
        if not isinstance(initialized, dict) or initialized.get("protocolVersion") != 1:
            raise RuntimeError("Hermes ACP protocol version 1 is required")
        if not initialized.get("agentCapabilities", {}).get("loadSession"):
            raise RuntimeError("Hermes ACP must support durable session loading")
        if args.check:
            emit("text", text="Hermes ACP is ready (protocol 1, durable session loading)")
            return
        params = {"cwd": os.getcwd(), "mcpServers": []}
        if self.session:
            state = self.request("session/load", dict(params, sessionId=self.session))
            if not isinstance(state, dict):
                raise RuntimeError("The saved Hermes session could not be loaded; it was not replaced")
        else:
            state = self.request("session/new", params)
            self.session = state.get("sessionId") if isinstance(state, dict) else None
            if not isinstance(self.session, str) or not self.session:
                raise RuntimeError("Hermes did not create a session")
        emit("session", id=self.session)
        # Explicit named custom selection resets a restored endpoint too; merely
        # changing config or a model name would keep the previous provider's URL.
        self.request("session/set_model", {"sessionId": self.session, "modelId": "custom:galahad:" + args.model})
        modes = (state.get("modes") or {}).get("availableModes", [])
        if any(m.get("id") == "accept_edits" for m in modes):
            self.request("session/set_mode", {"sessionId": self.session, "modeId": "accept_edits"})
        self.active = True
        prompt = Path(args.prompt).read_text()
        result = self.request("session/prompt", {"sessionId": self.session, "prompt": [{"type": "text", "text": prompt}]}, args.max_seconds)
        if self.text.strip():
            emit("text", text=self.text)
        usage = result.get("usage") or {} if isinstance(result, dict) else {}
        emit("tokens", input=max(0, int(usage.get("inputTokens", 0))), output=max(0, int(usage.get("outputTokens", 0))))
        if self.cancelled or not isinstance(result, dict) or result.get("stopReason") != "end_turn":
            raise RuntimeError("Hermes did not complete its turn")
        if not self.text.strip():
            raise RuntimeError("Hermes ended without a result")

    def close(self):
        self.selector.close()
        if self.child and self.child.poll() is None:
            self.child.terminate()
            try:
                self.child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--session")
    parser.add_argument("--home", default="/work/.hermes")
    parser.add_argument("--prompt", default="/work/.agent/prompt.md")
    parser.add_argument("--gateway-env", default="/work/.galahad-gateway.json")
    parser.add_argument("--max-tools", type=int, default=128)
    parser.add_argument("--max-seconds", type=int, default=900)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.max_tools < 1 or args.max_seconds < 1 or (not args.check and (not args.provider or not args.model)):
        parser.error("a provider, model and positive run budgets are required")
    bridge = Bridge(args)
    try:
        bridge.run()
        return 0
    except FileNotFoundError:
        emit("error", message="Hermes or a required workspace file is missing; install Hermes with ACP support in this workspace")
        return 1
    except Exception as error:
        # Only our own controlled RuntimeErrors are shown; OS/provider errors may
        # carry credentials. stderr is separately redacted by the outer runner.
        emit("error", message=str(error) if type(error) is RuntimeError else "Hermes ACP bridge failed (" + type(error).__name__ + ")")
        return 1
    finally:
        bridge.close()

if __name__ == "__main__":
    sys.exit(main())
`;

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export const HERMES: AgentDriver = {
  name: "hermes",
  files: () => ({ "/work/.agent/hermes-acp.py": HERMES_ACP_BRIDGE }),
  command: (model, session) => `python3 /work/.agent/hermes-acp.py --provider ${quote(model.provider)} --model ${quote(model.model)}${session ? ` --session ${quote(session)}` : ""}`,
  read(line) {
    let e: any;
    try { e = JSON.parse(line); } catch { return []; }
    if (!e || typeof e !== "object") return [];
    if (e.type === "session" && typeof e.id === "string" && e.id.length <= 256) return [{ type: "session", id: e.id }];
    if (e.type === "text" && typeof e.text === "string") return [{ type: "text", text: redact(e.text) }];
    if (e.type === "error" && typeof e.message === "string") return [{ type: "error", message: redact(e.message) }];
    if (e.type === "tool" && [e.tool, e.input, e.output].every((v) => typeof v === "string") && typeof e.ok === "boolean") {
      return [{ type: "tool", tool: redact(e.tool), input: redact(e.input), output: redact(e.output), ok: e.ok }];
    }
    if (e.type === "tokens" && [e.input, e.output].every((v) => Number.isSafeInteger(v) && v >= 0)) return [{ type: "tokens", input: e.input, output: e.output }];
    return [];
  },
};
