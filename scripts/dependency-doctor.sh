#!/usr/bin/env bash
set -euo pipefail

echo "[1/3] proxy env"
env | grep -E '(^|_)(http_proxy|https_proxy|HTTP_PROXY|HTTPS_PROXY|npm_config_http_proxy|npm_config_https_proxy)=' || true

echo "[2/3] npm registry"
npm config get registry

echo "[3/3] connectivity test"
if curl -sS -I https://registry.npmjs.org >/dev/null; then
  echo "direct registry reachable"
else
  echo "direct registry not reachable"
fi

if curl -sS -I -x "${HTTP_PROXY:-http://proxy:8080}" https://registry.npmjs.org >/dev/null; then
  echo "registry reachable via proxy"
else
  echo "registry blocked via proxy"
fi
