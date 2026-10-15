# WanGP MCP v1 - public build feasibility test

This repository contains only generic build scripts for the upstream [WanGP](https://github.com/deepbeepmeep/Wan2GP) source (source pinned to commit `de302eec64b692dc83949d687cadf7d60bd74091`). It does **not** contain personal code, credentials, model weights or a published Docker image. WanGP is distributed under its own [Community License](https://github.com/deepbeepmeep/Wan2GP/blob/main/LICENSE.txt); terms and notices remain with the upstream source.

GitHub Actions supports manual workflow dispatch:
- `preflight`: check runner CPU/RAM/disk, download pinned public WanGP source, prepare Docker build context and test it without building;
- `build`: attempt a full, timeout-limited Docker build **only if 24 GiB are free**. For standard GitHub runners the published specification is 14 GB SSD, so this will normally fail safely.

The workflow refuses private repositories to avoid possible charges for minutes; it does not push images, upload artifacts, download model weights, or request paid GPUs.

The real image remains **unbuilt and unverified** unless the CI logs demonstrate otherwise. No costs are promised or guaranteed beyond GitHub's documented free use of standard runners on public repositories.
