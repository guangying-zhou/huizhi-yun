#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const packagePath = 'platform/package.json'
const wranglerPath = 'platform/wrangler.jsonc'
const envExamplePath = 'platform/.env.cloudflare.example'
const gitignorePath = 'platform/.gitignore'
const realEnvPath = 'platform/.env.cloudflare'
const legacyGuardPath = 'platform/scripts/assert-cloudflare-deploy-allowed.mjs'

function fail(message) {
  console.error(`[platform-cloudflare-default] ${message}`)
  process.exit(1)
}

for (const filePath of [packagePath, wranglerPath, envExamplePath, gitignorePath]) {
  if (!existsSync(filePath)) fail(`missing required file: ${filePath}`)
}
if (existsSync(legacyGuardPath)) {
  fail(`${legacyGuardPath} must be removed; wiztek deploys to Cloudflare by default`)
}

const gitignoreLines = readFileSync(gitignorePath, 'utf8')
  .split(/\r?\n/)
  .map(line => line.trim())
if (gitignoreLines.includes('!.env.cloudflare')) {
  fail(`${gitignorePath} must not unignore real .env.cloudflare; only .env.cloudflare.example should be tracked`)
}

const trackedRealEnv = spawnSync('git', ['-C', 'platform', 'ls-files', '--error-unmatch', '.env.cloudflare'], {
  cwd: process.cwd(),
  encoding: 'utf8'
})
if (trackedRealEnv.status === 0) {
  const deletedRealEnv = spawnSync('git', ['-C', 'platform', 'ls-files', '--deleted', '--error-unmatch', '.env.cloudflare'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  if (deletedRealEnv.status !== 0) {
    fail(`${realEnvPath} must not be tracked; keep only ${envExamplePath} in git`)
  }
}

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const deployScript = String(packageJson.scripts?.['deploy:cloudflare'] || '')
const verifyScript = String(packageJson.scripts?.['verify:cloudflare-deploy'] || '')
if (!verifyScript.startsWith('pnpm run preflight:cloudflare &&')) {
  fail('platform verify:cloudflare-deploy must start with the Cloudflare preflight without an override guard')
}
if (!deployScript.startsWith('pnpm run verify:cloudflare-deploy &&')) {
  fail('platform deploy:cloudflare must pass verify:cloudflare-deploy before the real deploy')
}
for (const script of Object.values(packageJson.scripts || {})) {
  if (String(script).includes('HZY_ALLOW_PLATFORM_CLOUDFLARE_DEPLOY') || String(script).includes('assert-cloudflare-deploy-allowed')) {
    fail('Platform scripts must not require the legacy Cloudflare override')
  }
}

const wrangler = readFileSync(wranglerPath, 'utf8')
for (const marker of ['"name": "hzy-platform"', '"pattern": "huizhi.yun"', '"pattern": "www.huizhi.yun"', '"binding": "HYPERDRIVE"']) {
  if (!wrangler.includes(marker)) fail(`${wranglerPath} is missing default Cloudflare marker: ${marker}`)
}

const envExample = readFileSync(envExamplePath, 'utf8')
if (envExample.includes('HZY_ALLOW_PLATFORM_CLOUDFLARE_DEPLOY') || /legacy\s*\/\s*exception-only/i.test(envExample)) {
  fail(`${envExamplePath} still describes Cloudflare as an exception`)
}

console.info('[platform-cloudflare-default] passed')
