#!/usr/bin/env bash
# Deploy or update a Galahad node on a Linux or macOS host over SSH.
#
# Idempotent: re-running ships the current commit, reinstalls only what changed,
# keeps the node's identity and mind, and restarts the service. Each commit lands
# in its own release directory and `app` is an atomic symlink, so rolling back is
# `ln -sfn ~/galahad/releases/<rev> ~/galahad/app` + restart.
#
# usage:
#   scripts/deploy.sh <ssh-target> --found camelot [--name ultra]   # first node of a new fleet
#   scripts/deploy.sh <ssh-target> --join <invite> [--name ultra]   # join an existing fleet
#   scripts/deploy.sh <ssh-target>                                  # update an existing node
#
# Transport: plain ssh by default; GALAHAD_SSH="tailscale ssh" to use Tailscale SSH.
set -euo pipefail

if [[ $# -lt 1 || $1 == -* ]]; then
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi
TARGET=$1
shift
NAME="" MODE="update" FLEET="" INVITE="" PORT=7777 SKIP_TESTS=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --name) NAME=$2; shift 2 ;;
    --found) MODE="found"; FLEET=$2; shift 2 ;;
    --join) MODE="join"; INVITE=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

read -r -a SSH <<<"${GALAHAD_SSH:-ssh}"
cd "$(git rev-parse --show-toplevel)"
if [[ -n $(git status --porcelain) ]]; then
  echo "refusing to deploy: the working tree has uncommitted changes (deploys ship commits, not drafts)" >&2
  exit 1
fi
REV=$(git rev-parse --short=12 HEAD)

echo "→ shipping $REV to $TARGET"
git archive --format=tar HEAD | "${SSH[@]}" "$TARGET" \
  "set -e; mkdir -p ~/galahad/releases/$REV; tar -x -C ~/galahad/releases/$REV; ln -sfn ~/galahad/releases/$REV ~/galahad/app.next; mv -T ~/galahad/app.next ~/galahad/app 2>/dev/null || { rm -f ~/galahad/app; mv ~/galahad/app.next ~/galahad/app; }"

echo "→ setting up the node on $TARGET"
"${SSH[@]}" "$TARGET" "bash -s -- '$MODE' '$NAME' '$FLEET' '$INVITE' '$PORT' '$SKIP_TESTS'" <scripts/remote-setup.sh
