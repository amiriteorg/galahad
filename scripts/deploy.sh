#!/usr/bin/env bash
# Deploy or update a Galahad node on a Linux or macOS host over SSH.
#
# Idempotent: re-running ships the current commit, keeps the node's identity and
# mind, re-runs the test suite on the host, and restarts the service. Each commit
# lands in its own release directory behind an atomic `app` symlink (rollback =
# repoint the symlink + restart); the current release and the two before it are kept.
#
# usage:
#   scripts/deploy.sh <ssh-target> --found camelot [--name ultra]   first node of a new fleet
#   scripts/deploy.sh <ssh-target> --join <invite> [--name ultra]   join an existing fleet
#   scripts/deploy.sh <ssh-target>                                  update an existing node
# root targets only (Galahad then runs as a dedicated `galahad` user, never as root):
#   --sudo              give the galahad user passwordless sudo, with every command logged
#   --expose <port>     publish the PWA with `tailscale serve` on that HTTPS port (tailnet only)
#   --open-firewall     allow the Galahad port on tailscale0 when UFW is active
# other: --port 7777, --skip-tests
#
# Transport: plain ssh by default; GALAHAD_SSH="tailscale ssh" uses Tailscale SSH.
set -euo pipefail

if [[ $# -lt 1 || $1 == -* ]]; then
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
TARGET=$1
shift
NAME="-" MODE="update" FLEET="-" INVITE="-" PORT=7777 SKIP_TESTS=0 SUDO=0 EXPOSE=0 OPEN_FIREWALL=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --name) NAME=$2; shift 2 ;;
    --found) MODE="found"; FLEET=$2; shift 2 ;;
    --join) MODE="join"; INVITE=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --sudo) SUDO=1; shift ;;
    --expose) EXPOSE=$2; shift 2 ;;
    --open-firewall) OPEN_FIREWALL=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done
for value in "$NAME" "$FLEET" "$INVITE" "$PORT" "$EXPOSE"; do
  [[ $value =~ ^[A-Za-z0-9._-]+$ ]] || { echo "refusing unsafe argument: $value" >&2; exit 1; }
done

read -r -a SSH <<<"${GALAHAD_SSH:-ssh}"
cd "$(git rev-parse --show-toplevel)"
if [[ -n $(git status --porcelain) ]]; then
  echo "refusing to deploy: the working tree has uncommitted changes (deploys ship commits, not drafts)" >&2
  exit 1
fi
REV=$(git rev-parse --short=12 HEAD)

echo "→ shipping $REV to $TARGET"
# A fresh, private stage directory made on the server (mktemp -d: a name nobody can guess,
# mode 700, owned by whoever deploys), so no one else on the host can plant or change what
# root runs from it. It goes when the deploy ends, however it ends.
STAGE=$("${SSH[@]}" "$TARGET" "mktemp -d /tmp/galahad-stage.XXXXXXXXXX" | tr -d '\r')
[[ $STAGE =~ ^/tmp/galahad-stage\.[A-Za-z0-9]{10}$ ]] || { echo "the server didn't make a stage directory" >&2; exit 1; }
trap '"${SSH[@]}" "$TARGET" "rm -rf -- $STAGE" || true' EXIT
# The repository's own bytes: with core.autocrlf (Git for Windows' default) and a .gitattributes,
# git archive would turn every script into CRLF, and bash on the target refuses it.
git -c core.autocrlf=false -c core.eol=lf archive --format=tar HEAD | "${SSH[@]}" "$TARGET" "tar -x -C $STAGE"

echo "→ setting up the node on $TARGET"
"${SSH[@]}" "$TARGET" "bash $STAGE/scripts/remote-setup.sh $STAGE $REV $MODE $NAME $FLEET $INVITE $PORT $SKIP_TESTS $SUDO $EXPOSE $OPEN_FIREWALL"
