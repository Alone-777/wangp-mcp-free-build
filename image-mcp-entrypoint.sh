#!/usr/bin/env bash
set -euo pipefail
# No paid activity or dependencies downloaded by this entrypoint.
cd /workspace/WanGP
mkdir -p /data/config /data/cache /data/outputs /data/workspaces
python3 - <<'PY'
import torch
print("PyTorch:", torch.__version__)
print("CUDA:", torch.cuda.is_available())
if not torch.cuda.is_available():
    raise SystemExit("CUDA not available - refusing to start inference")
print("GPU:", torch.cuda.get_device_name(0))
PY
exec python3 wgp.py \
  --mcp --mcp-api-version 1 \
  --mcp-transport streamable-http \
  --mcp-host 127.0.0.1 --mcp-port 7866 \
  --config /data/config \
  --output-dir /data/outputs \
  --workspaces-dir /data/workspaces \
  --attention sdpa --profile 4
