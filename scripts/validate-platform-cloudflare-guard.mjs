#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

const guardPath = 'platform/scripts/assert-cloudflare-deploy-allowed.mjs'
const packagePath = 'platform/package.json'
const wranglerPath = 'platform/wrangler.jsonc'
const envExamplePath = 'platform/.env.cloudflare.example'
const gitignorePath = 'platform/.gitignore'
const realEnvPath = 'platform/.env.cloudflare'
const overrideEnv = 'HZY_ALLOW_PLATFORM_CLOUDFLARE_DEPLOY'
const forbiddenWiztekDomains = [
  'platform.wiztek.cn',
  'platform-dev.wiztek.cn'
]

function fail(message) {
  console.error(`[platform-cloudflare-guard] ${message}`)
  process.exit(1)
}

function runGuard(env) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    encoding: 'utf8'
  })
}

if (!existsSync(guardPath)) {
  fail(`missing guard script: ${guardPath}`)
}

if (!existsSync(packagePath)) {
  fail(`missing package file: ${packagePath}`)
}

if (!existsSync(gitignorePath)) {
  fail(`missing gitignore file: ${gitignorePath}`)
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

for (const filePath of [wranglerPath, envExamplePath]) {
  if (!existsSync(filePath)) {
    fail(`missing Cloudflare config file: ${filePath}`)
  }
  const content = readFileSync(filePath, 'utf8')
  for (const domain of forbiddenWiztekDomains) {
    if (content.includes(domain)) {
      fail(`${filePath} must not reference ${domain}; wiztek Platform domains belong to PM2/Nginx`)
    }
  }
}

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
const deployScript = String(packageJson.scripts?.['deploy:cloudflare'] || '')

if (!deployScript.includes('node scripts/assert-cloudflare-deploy-allowed.mjs &&')) {
  fail('platform deploy:cloudflare must run assert-cloudflare-deploy-allowed.mjs before build/deploy')
}

const blocked = runGuard({ [overrideEnv]: '' })
if (blocked.status === 0) {
  fail(`guard must block when ${overrideEnv} is not set`)
}
if (!`${blocked.stdout}\n${blocked.stderr}`.includes('deploy blocked')) {
  fail('blocked guard output must explain that deploy is blocked')
}

const allowed = runGuard({ [overrideEnv]: 'true' })
if (allowed.status !== 0) {
  fail(`guard must allow explicit ${overrideEnv}=true override`)
}

console.info('[platform-cloudflare-guard] passed')
