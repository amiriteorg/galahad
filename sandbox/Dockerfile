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

# OpenCode, the coding agent for long quests (galahad do --agent opencode). Pinned, and
# checked against its SHA-256; it reaches models only through Galahad's gateway.
ARG OPENCODE_VERSION=2.2.6
ARG OPENCODE_SHA256=08bb21d6326ce740d91cce7ebe88a6536933f6e1e30353b91a06b01f25da306c
RUN curl -fsSL -o /tmp/opencode.tgz "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz" \
 && echo "${OPENCODE_SHA256}  /tmp/opencode.tgz" | sha256sum -c - \
 && mkdir -p /opt/opencode/bin && tar -xzf /tmp/opencode.tgz -C /opt/opencode/bin opencode \
 && chmod 0755 /opt/opencode/bin/opencode && rm /tmp/opencode.tgz
ENV PATH=/opt/opencode/bin:$PATH

# Web search through Galahad's own SearXNG, via the gateway (no internet needed).
COPY websearch /usr/local/bin/websearch
RUN chmod 0755 /usr/local/bin/websearch

# Simulations shown live in Galahad's SANDBOX world, via the gateway (python3 -m galahad_world).
COPY galahad_world.py /usr/lib/python3/dist-packages/galahad_world.py
RUN chmod 0644 /usr/lib/python3/dist-packages/galahad_world.py

RUN useradd --uid 1000 --create-home --home-dir /home/squire --shell /bin/bash squire \
 && mkdir -p /work && chown 1000:1000 /work

USER 1000:1000
WORKDIR /work
ENV HOME=/work
CMD ["sleep", "infinity"]
