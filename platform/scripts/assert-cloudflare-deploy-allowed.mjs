#!/usr/bin/env node
import process from 'node:process'

const allow = String(process.env.HZY_ALLOW_PLATFORM_CLOUDFLARE_DEPLOY || '').trim().toLowerCase()

if (!['1', 'true', 'yes', 'on'].includes(allow)) {
  console.error(
    [
      '[platform-cloudflare] deploy blocked.',
      'Platform prod/dev for wiztek must run on domestic PM2/Nginx so WeCom login can use a fixed server IP.',
      'Use platform build:prod/build:dev and pm2:start:prod/pm2:start:dev for wiztek deployments.',
      'For a deliberate legacy/non-wiztek Cloudflare deploy, rerun with HZY_ALLOW_PLATFORM_CLOUDFLARE_DEPLOY=true.'
    ].join('\n')
  )
  process.exit(1)
}

console.info('[platform-cloudflare] explicit override detected; continuing Cloudflare deploy')
