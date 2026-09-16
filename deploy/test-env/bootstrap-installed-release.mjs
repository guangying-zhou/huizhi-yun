#!/usr/bin/env node
// Explicit migration-only fallback for the already installed amd64 release.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, verify } from 'node:crypto'
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' })
async function main() {
  if (process.argv[2] !== '--execute') throw new Error('explicit --execute required; one-time migration only')
  if (run('hostname', []).toString().trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('host')
  const root = '/wiztek/hzy-test', path = `${root}/platform-dev.config.json`
  const config = JSON.parse(fs.readFileSync(path)), app = config.apps[0]
  if (app.name !== 'hzy-platform-dev' || app.env.DB_NAME !== 'hzy_platform_dev'
    || app.env.PLATFORM_SERVICE_URL !== 'https://hzy.wiztek.cn'
    || app.env.HZY_DATA_RUNTIME_APPROVED_VERSION) throw new Error('unexpected configuration')
  const archive = fs.readFileSync(`${root}/runtime/release-0.3.215.tar.gz`)
  if (createHash('sha256').update(archive).digest('hex') !== '85ea75938c2ef43f090ecb871e0c12b38d11f61424313a5b7be1a01bd224b0a0'
    || !verify(null, archive, fs.readFileSync(`${root}/release-signing-public.pem`), fs.readFileSync(`${root}/runtime/release-0.3.215.sig`))) throw new Error('installed artifact verification')
  const health = await fetch('http://127.0.0.1:18084/runtime/health').then(r => r.json())
  if (health.tenant !== 'C000001' || health.deployment !== 'c000001-test-tenant-runtime' || health.version !== '0.3.215') throw new Error('runtime mismatch')
  const backup = `${root}/backups/platform-installed-release-bootstrap-20260905`
  fs.mkdirSync(backup, { mode: 0o700 })
  fs.copyFileSync(path, `${backup}/platform-dev.config.json`, fs.constants.COPYFILE_EXCL)
  fs.chmodSync(`${backup}/platform-dev.config.json`, 0o600)
  app.env.HZY_DATA_RUNTIME_APPROVED_VERSION = app.env.NUXT_DATA_RUNTIME_RELEASE_APPROVED_VERSION = '0.3.215'
  fs.writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 })
  run('pm2', ['restart', path, '--only', 'hzy-platform-dev', '--update-env'])
  run('pm2', ['save'])
  fs.writeFileSync(`${backup}/complete.json`, JSON.stringify({ configuredAt: new Date().toISOString(),
    version: '0.3.215', artifactSignatureVerified: true, purpose: 'existing-test-runtime-migration-only',
    registryApproved: false, removeAfterSignedMultiarchReleaseApproval: true }), { flag: 'wx', mode: 0o600 })
  console.log('Installed signed amd64 0.3.215 pinned as development migration bootstrap only; registry approval and production remain unchanged.')
}
main().catch(() => { console.error('Migration bootstrap stopped; inspect protected state.'); process.exitCode = 1 })
