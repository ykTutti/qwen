# Image for per-conversation agent sandboxes: docker build -t qwen-sandbox qwen-server/sandbox
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv git curl ca-certificates procps \
  && rm -rf /var/lib/apt/lists/*

# Containers run as the server's uid, which usually has no passwd entry here; keep tool caches in a writable HOME.
ENV HOME=/tmp \
  npm_config_cache=/tmp/.npm \
  PIP_CACHE_DIR=/tmp/.cache/pip

WORKDIR /workspace
