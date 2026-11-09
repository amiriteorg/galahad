# The workshop where Galahad's squires work. Built on each sandbox host by
# `galahad sandbox build`. Runs unprivileged (uid 1000), read-only at runtime,
# with all capabilities dropped; see packages/sandbox/src/spec.ts.
FROM debian:trixie-slim

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl git unzip jq ripgrep procps python3 python3-venv build-essential \
 && rm -rf /var/lib/apt/lists/*

# Pinned toolchain, installed system-wide and readable by the squire.
ENV BUN_INSTALL=/opt/bun
ENV PATH=/opt/bun/bin:$PATH
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.4" && chmod -R a+rX /opt/bun

RUN useradd --uid 1000 --create-home --home-dir /home/squire --shell /bin/bash squire \
 && mkdir -p /work && chown 1000:1000 /work

USER 1000:1000
WORKDIR /work
ENV HOME=/work
CMD ["sleep", "infinity"]
