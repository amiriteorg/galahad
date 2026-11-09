#!/usr/bin/env bash
# Runs ON the target host, from the staged release (see scripts/deploy.sh). Idempotent.
#   remote-setup.sh <stage> <rev> <mode> <name|-> <fleet|-> <invite|-> <port> <skip-tests> <sudo> <expose|0> <open-firewall>
set -euo pipefail
STAGE=$1 REV=$2 MODE=$3 NAME=$4 FLEET=$5 INVITE=$6 PORT=$7 SKIP_TESTS=$8 SUDO=$9 EXPOSE=${10} OPEN_FIREWALL=${11}
[[ $NAME == - ]] && NAME=$(hostname -s)
SYSTEM_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ─── Root phase: never run Galahad as root; use a dedicated service user ───────────
if [[ $(id -u) -eq 0 && -z ${GALAHAD_USER_PHASE:-} ]]; then
  SVC=galahad
  SVC_HOME=/var/lib/galahad
  if ! id "$SVC" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "$SVC_HOME" --shell /bin/bash "$SVC"
    echo "→ created service user $SVC ($SVC_HOME)"
  fi
  for group in docker kvm; do
    if getent group "$group" >/dev/null && ! id -nG "$SVC" | tr ' ' '\n' | grep -qx "$group"; then
      usermod -aG "$group" "$SVC"
      echo "→ $SVC joined group $group"
    fi
  done
  command -v unzip >/dev/null || { echo "→ installing unzip (needed by the bun installer)"; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unzip >/dev/null; }

  if [[ $SUDO == 1 ]]; then
    # Full sudo, recorded. visudo validates before anything is installed, so a bad
    # rule can never break sudo for anyone else on the machine.
    TMP=$(mktemp)
    if sudo --version 2>/dev/null | grep -q sudo-rs; then
      # sudo-rs (Ubuntu 25.10+) logs every command to the journal and rejects
      # classic-sudo logging options in the shared sudoers.d.
      cat >"$TMP" <<'SUDOERS'
# Galahad's sudo rights. Remove this file to revoke them.
# sudo-rs logs every command to the journal: journalctl -t sudo
galahad ALL=(ALL:ALL) NOPASSWD: ALL
SUDOERS
      WHERE="journalctl -t sudo"
    else
      cat >"$TMP" <<'SUDOERS'
# Galahad's sudo rights. Remove this file to revoke them.
# Every command is logged to /var/log/galahad-sudo.log; output is recorded for `sudoreplay`.
Defaults:galahad logfile=/var/log/galahad-sudo.log
Defaults:galahad log_output
Defaults:galahad !requiretty
galahad ALL=(ALL:ALL) NOPASSWD: ALL
SUDOERS
      WHERE="/var/log/galahad-sudo.log + sudoreplay"
    fi
    if visudo -cf "$TMP" >/dev/null; then
      install -m 0440 -o root -g root "$TMP" /etc/sudoers.d/galahad
      echo "→ sudo granted to $SVC (audit: $WHERE)"
    else
      visudo -cf "$TMP" >&2 || true
      echo "sudoers rule failed validation; not installed" >&2
    fi
    rm -f "$TMP"
  fi

  chown -R "$SVC:$SVC" "$STAGE"
  runuser -u "$SVC" -- env -i HOME="$SVC_HOME" USER="$SVC" LOGNAME="$SVC" PATH="$SYSTEM_PATH" GALAHAD_USER_PHASE=1 \
    bash "$STAGE/scripts/remote-setup.sh" "$@"

  BUN="$SVC_HOME/.bun/bin/bun"
  APP="$SVC_HOME/galahad/app"
  # The tailnet-facing daemon holds the vault, so it runs sandboxed even though the
  # galahad user itself may sudo: a bug in the listener must not be a root shell.
  cat >/etc/systemd/system/galahad.service <<UNIT
[Unit]
Description=Galahad node
After=network-online.target tailscaled.service docker.service
Wants=network-online.target

[Service]
User=$SVC
Group=$SVC
Environment=HOME=$SVC_HOME
Environment=GALAHAD_KEYSTORE=file
WorkingDirectory=$APP
ExecStart=$BUN $APP/packages/node/src/cli.ts serve
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$SVC_HOME
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
UNIT
  cat >/usr/local/bin/galahad <<WRAPPER
#!/bin/sh
# Run the Galahad CLI as the galahad service user.
CMD="env -i HOME=$SVC_HOME PATH=$SYSTEM_PATH GALAHAD_KEYSTORE=file $BUN $APP/packages/node/src/cli.ts"
if [ "\$(id -un)" = "$SVC" ]; then exec \$CMD "\$@"; fi
if [ "\$(id -u)" = 0 ]; then exec runuser -u $SVC -- \$CMD "\$@"; fi
exec sudo -u $SVC \$CMD "\$@"
WRAPPER
  chmod 0755 /usr/local/bin/galahad
  systemctl daemon-reload
  systemctl enable galahad.service >/dev/null 2>&1
  systemctl restart galahad.service

  if [[ $OPEN_FIREWALL == 1 ]] && command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow in on tailscale0 to any port "$PORT" proto tcp comment "Galahad link over Tailscale" >/dev/null &&
      echo "→ ufw: allowed $PORT/tcp on tailscale0 only" || echo "ufw rule not added" >&2
  fi
  if [[ $EXPOSE != 0 ]]; then
    # `tailscale serve` blocks while waiting for Serve/HTTPS to be enabled for the
    # tailnet; never let that hang a deploy. Show its link instead.
    # Serve targets the dedicated "proxied" listener (port + 1), never the local-only port.
    SERVE_OUT=$(timeout 20 tailscale serve --bg --https="$EXPOSE" "http://127.0.0.1:$((PORT + 1))" 2>&1) && SERVE_OK=1 || SERVE_OK=0
    DNS=$(tailscale status --self --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1)
    if [[ $SERVE_OK == 1 ]]; then
      echo "→ PWA: https://$DNS:$EXPOSE/  (tailnet only)"
    else
      echo "→ tailscale serve needs a one-time approval for this tailnet; open the link below, then re-run the deploy:"
      echo "$SERVE_OUT" | grep -Eo 'https://login\.tailscale\.com/[^ ]+' | head -1 || echo "$SERVE_OUT" | tail -3
    fi
  fi

  for _ in $(seq 1 30); do
    /usr/local/bin/galahad status >/dev/null 2>&1 && break
    sleep 1
  done
  /usr/local/bin/galahad status
  rm -rf "$STAGE"
  exit 0
fi

# ─── User phase: install, test, create or join, (user-level service) ───────────────
export PATH="$HOME/.bun/bin:$PATH"
# Servers have no unlocked desktop keychain at boot; device keys live in a 0600 file.
export GALAHAD_KEYSTORE=file
if ! command -v bun >/dev/null 2>&1; then
  echo "→ installing bun"
  curl -fsSL https://bun.sh/install | bash >/dev/null
fi
echo "→ bun $(bun --version)"

mkdir -p "$HOME/galahad/releases"
rm -rf "$HOME/galahad/releases/$REV"
cp -a "$STAGE" "$HOME/galahad/releases/$REV"
ln -sfn "$HOME/galahad/releases/$REV" "$HOME/galahad/app.next"
mv -T "$HOME/galahad/app.next" "$HOME/galahad/app" 2>/dev/null || { rm -f "$HOME/galahad/app"; mv "$HOME/galahad/app.next" "$HOME/galahad/app"; }
APP="$HOME/galahad/app"
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

# Root deploys install a hardened system unit in the root phase.
[[ -n ${GALAHAD_USER_PHASE:-} ]] && exit 0

BUN="$HOME/.bun/bin/bun"
if [[ $(uname) == Linux ]] && command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat >"$HOME/.config/systemd/user/galahad.service" <<UNIT
[Unit]
Description=Galahad node
After=network-online.target

[Service]
Environment=GALAHAD_KEYSTORE=file
WorkingDirectory=$APP
ExecStart=$BUN $APP/packages/node/src/cli.ts serve
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable galahad.service >/dev/null 2>&1
  systemctl --user restart galahad.service
  [[ $(loginctl show-user "$USER" -p Linger --value 2>/dev/null) == yes ]] || loginctl enable-linger "$USER" 2>/dev/null ||
    echo "note: run 'sudo loginctl enable-linger $USER' once so Galahad starts at boot without a login"
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
  echo "no service manager found; start it yourself: cd $APP && GALAHAD_KEYSTORE=file bun galahad serve" >&2
  exit 0
fi

for _ in $(seq 1 30); do
  bun galahad status >/dev/null 2>&1 && break
  sleep 1
done
bun galahad status
rm -rf "$STAGE"
