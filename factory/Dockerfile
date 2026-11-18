# The factory workspace image: Node, Git, ripgrep and a PINNED OpenCode, plus
# the sandbox-shim helper that @cloudflare/sandbox's Files needs. Follows
# Cloudflare's "Run OpenCode in a sandbox" and the sandbox-sdk OpenCode example.
#
# Pins (change them together, and only on purpose):
#  - cloudflare/sandbox:1.0.3 matches the @cloudflare/sandbox version in
#    package.json (test/config.test.ts checks the two agree).
#  - opencode-linux-x64-baseline@1.19.4 matches OPENCODE_VERSION in
#    src/opencode.ts, whose configuration shape is 1.19.4's (the test checks
#    this too). The baseline build runs on every x64 CPU; `opencode-ai` would
#    pick a binary for the CPU of the machine that builds the image.
#  - Base images by digest. Dependabot (docker) proposes digest updates.
#
# Nothing personal and no credential is ever added to this image or to the
# container's environment (src/opencode.ts, test/opencode.test.ts).
FROM docker.io/cloudflare/sandbox:1.0.3@sha256:fc1740c3cba26461f0ab1771287c84018ab2cca43a70ebb823087c85d780aaec AS sandbox-tools

FROM docker.io/library/node:24-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0

# ripgrep: without it OpenCode tries to download rg from GitHub at run time.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm install --global --ignore-scripts opencode-linux-x64-baseline@1.19.4 \
  && ln -s /usr/local/lib/node_modules/opencode-linux-x64-baseline/bin/opencode /usr/local/bin/opencode

COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

WORKDIR /workspace
# The Durable Object starts `opencode serve` itself (src/workspace-core.ts).
CMD ["sleep", "infinity"]
