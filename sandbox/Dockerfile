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

# Engram, the notes store a squire's harness may be given (galahad squires engram on). Pinned, and
# checked against its SHA-256. A newer one migrates a store when it first opens it, so a bump says what
# becomes of the stores there are. Its store is on the squire's own disk and its update check is off;
# nothing here starts it (a harness does, for the length of a run: packages/brain/src/engram.ts).
ARG ENGRAM_VERSION=3.7.2
ARG ENGRAM_SHA256=8db9d5db1c1574b8b830aac4ffbe86c024014aed6b9a3f0406ac3361a152cdf0
RUN curl -fsSL -o /tmp/engram.tgz "https://github.com/Gentleman-Programming/engram/releases/download/v${ENGRAM_VERSION}/engram_${ENGRAM_VERSION}_linux_amd64.tar.gz" \
 && echo "${ENGRAM_SHA256}  /tmp/engram.tgz" | sha256sum -c - \
 && mkdir -p /opt/engram/bin && tar -xzf /tmp/engram.tgz -C /opt/engram/bin engram \
 && chmod 0755 /opt/engram/bin/engram && rm /tmp/engram.tgz
ENV PATH=/opt/engram/bin:$PATH
ENV ENGRAM_DATA_DIR=/work/.memory/engram
ENV ENGRAM_NO_UPDATE_CHECK=1

# A login shell sets PATH afresh (/etc/profile), and a squire's commands run in one: this puts the tools
# above back on it (tools-path.sh says why; a directory added to the PATH here is added there too).
COPY tools-path.sh /etc/profile.d/galahad-tools.sh
RUN chmod 0644 /etc/profile.d/galahad-tools.sh

# Web search through Galahad's own SearXNG, via the gateway (no internet needed).
COPY websearch /usr/local/bin/websearch
RUN chmod 0755 /usr/local/bin/websearch

RUN useradd --uid 1000 --create-home --home-dir /home/squire --shell /bin/bash squire \
 && mkdir -p /work && chown 1000:1000 /work

USER 1000:1000
WORKDIR /work
ENV HOME=/work
# What is installed in a VM for itself (a vendor's coding tool) is found, after everything above.
ENV PATH=$PATH:/work/.local/bin
CMD ["sleep", "infinity"]
