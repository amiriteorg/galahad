#!/usr/bin/env bash
# Runs ON the target host (piped by scripts/deploy.sh). Idempotent.
set -euo pipefail
MODE=$1 NAME=${2:-$(hostname -s)} FLEET=$3 INVITE=$4 PORT=$5 SKIP_TESTS=$6
export PATH="$HOME/.bun/bin:$PATH"
# Servers have no unlocked desktop keychain at boot; keep device keys in a 0600 file.
export GALAHAD_KEYSTORE=file
APP="$HOME/galahad/app"

if ! command -v bun >/dev/null 2>&1; then
  echo "→ installing bun"
  curl -fsSL https://bun.sh/install | bash >/dev/null
  export PATH="$HOME/.bun/bin:$PATH"
fi
echo "→ bun $(bun --version)"

cd "$APP"
bun install --frozen-lockfile >/dev/null
if [[ $SKIP_TESTS != 1 ]]; then
  echo "→ running the test suite on this host"
  LOG=$(mktemp)
  if ! bun test >"$LOG" 2>&1; then
    tail -30 "$LOG"
    echo "tests failed on this host; not (re)starting the service" >&2
    exit 1
  fi
  tail -4 "$LOG"
  rm -f "$LOG"
fi

if [[ ! -f $HOME/.galahad/config.json ]]; then
  case $MODE in
    found) bun galahad init --name "$NAME" --fleet "$FLEET" --port "$PORT" --keystore file ;;
    join) bun galahad join "$INVITE" --name "$NAME" --port "$PORT" --keystore file ;;
    *) echo "no Galahad node here yet; deploy with --found <fleet> or --join <invite>" >&2; exit 1 ;;
  esac
else
  echo "→ existing node kept ($(grep -o '"name": *"[^"]*"' "$HOME/.galahad/config.json"))"
fi

BUN="$HOME/.bun/bin/bun"
if [[ $(uname) == Linux ]] && command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat >"$HOME/.config/systemd/user/galahad.service" <<UNIT
[Unit]
Description=Galahad node
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Environment=GALAHAD_KEYSTORE=file
WorkingDirectory=$APP
ExecStart=$BUN $APP/packages/node/src/cli.ts serve
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable galahad.service >/dev/null 2>&1
  systemctl --user restart galahad.service
  if [[ $(loginctl show-user "$USER" -p Linger --value 2>/dev/null) != yes ]]; then
    loginctl enable-linger "$USER" 2>/dev/null ||
      echo "note: run 'sudo loginctl enable-linger $USER' once so Galahad starts at boot without a login"
  fi
elif [[ $(uname) == Darwin ]]; then
  PLIST="$HOME/Library/LaunchAgents/dev.galahad.node.plist"
  mkdir -p "$(dirname "$PLIST")" "$HOME/.galahad"
  cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.galahad.node</string>
  <key>ProgramArguments</key><array><string>$BUN</string><string>$APP/packages/node/src/cli.ts</string><string>serve</string></array>
  <key>EnvironmentVariables</key><dict><key>GALAHAD_KEYSTORE</key><string>file</string></dict>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.galahad/node.log</string>
  <key>StandardErrorPath</key><string>$HOME/.galahad/node.log</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/dev.galahad.node" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
else
  echo "no service manager found; start it yourself with: cd $APP && GALAHAD_KEYSTORE=file bun galahad serve" >&2
  exit 0
fi

for _ in $(seq 1 30); do
  if bun galahad status >/dev/null 2>&1; then break; fi
  sleep 1
done
bun galahad status
