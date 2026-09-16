#!/usr/bin/env bash
set -euo pipefail
[[ $(hostname) == iZcqwiqyhp9u8rZ ]] || exit 1
cd /wiztek/hzy-test
echo '58fe4a997daed3591a059b01b4b3cadbade4435d4c02b69fb2f7a0823ffb313c  platform-source-5f898581.tar.gz' | sha256sum --check
test ! -e platform-release-5f898581
mkdir -m 700 platform-release-5f898581
tar -xzf platform-source-5f898581.tar.gz -C platform-release-5f898581
cd platform-release-5f898581
export PATH=/root/.nvm/versions/node/v24.18.0/bin:$PATH
export NODE_OPTIONS=--max-old-space-size=2048
export NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export HZY_DEPLOYMENT_PROFILE=platform-self-hosted-db
export NUXT_TELEMETRY_DISABLED=1
pnpm --filter 'platform...' install --frozen-lockfile --ignore-scripts
pnpm --filter 'platform...' rebuild
pnpm --dir platform exec nuxt prepare
pnpm --dir platform lint
pnpm --dir platform typecheck
# No real dotenv or production credentials are present in this source archive.
pnpm --dir platform exec nuxt build --preset=node-server
test -f platform/.output/server/index.mjs
