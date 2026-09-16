#!/usr/bin/env node
// Upgrade only the approved shared development control plane after a probe pass.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { nuxtPlatformEnv } from './platform-env.mjs'

process.on('uncaughtException', error => {
  console.error(`Development upgrade stopped (${error.code || 'check_failed'}). Inspect protected receipts before retrying; credentials suppressed.`)
  process.exit(1)
})
const root = '/wiztek/hzy-test'
const backup = `${root}/backups/platform-dev-20260905`
const source = `${root}/platform-release-5f898581/platform`
const sourcePatchHashes = Object.fromEntries(['server/utils/runtimeBootstrapIssuer.ts', 'server/api/platform/internal/tenant-gateway/runtime-bootstrap-token.post.ts'].map(path => [path, createHash('sha256').update(fs.readFileSync(`${source}/${path}`)).digest('hex')]))
if (process.argv[2] !== '--execute' || execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Unexpected invocation')
if (fs.existsSync(`${root}/platform-upgrade-started.json`)) throw new Error('Upgrade already attempted; inspect before retrying')
const probe = JSON.parse(fs.readFileSync(`${root}/platform-probe-verified.json`, 'utf8'))
const restored = JSON.parse(fs.readFileSync(`${root}/platform-probe-restored.json`, 'utf8'))
const receipt = JSON.parse(fs.readFileSync(`${backup}/receipt.json`, 'utf8'))
const old = JSON.parse(fs.readFileSync(`${backup}/process.json`, 'utf8'))
const env = JSON.parse(fs.readFileSync(`${backup}/runtime-env.json`, 'utf8'))
if (probe.database !== 'hzy_platform_upgrade_probe' || receipt.database !== 'hzy_platform_dev' || env.DB_NAME !== 'hzy_platform_dev' || env.PORT !== '3011') throw new Error('Isolation proof missing')
if (JSON.stringify(probe.sourcePatchHashes) !== JSON.stringify(sourcePatchHashes)) throw new Error('Source patch changed after probe')
const active = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' })).find(p => p.name === 'hzy-platform-dev')
if (!active?.pid || active.pm2_env?.pm_cwd !== receipt.oldWorkdir) throw new Error('Development release changed after backup')
const activeEnv = Object.fromEntries(fs.readFileSync(`/proc/${active.pid}/environ`, 'utf8').split('\0').filter(Boolean).map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]))
for (const key of ['DB_NAME', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'PORT', 'HZY_PLATFORM_SIGNING_PRIVATE_KEY']) {
  if (activeEnv[key] !== env[key]) throw new Error('Development binding changed after backup')
}
const require = createRequire(`${receipt.oldWorkdir}/.output/server/index.mjs`)
const mysql = require('mysql2/promise')
const db = await mysql.createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306), user: env.DB_USER,
  password: env.DB_PASSWORD, database: env.DB_NAME, multipleStatements: true, connectTimeout: 10000 })
const [[identity]] = await db.query('SELECT DATABASE() AS db')
if (identity.db !== 'hzy_platform_dev') throw new Error('Wrong database')
// Additive migrations leave the old release usable for code rollback. No DROP,
// DELETE, credential replacement or production repository cutover is allowed.
const sql = restored.migrations.map(({ name, sha256 }) => {
  const content = fs.readFileSync(`${source}/docs/sql/${name}`, 'utf8')
  if (createHash('sha256').update(content).digest('hex') !== sha256) throw new Error('Migration changed since probe')
  if (/^\s*(USE\s|(?:CREATE|DROP)\s+DATABASE|DROP\s+TABLE|DELETE\s+FROM|TRUNCATE\s)/mi.test(content)) throw new Error('Non-additive migration')
  return { name, content }
})
const secret = (name, content) => fs.writeFileSync(`${root}/${name}`, JSON.stringify(content, null, 2), { mode: 0o600, flag: 'wx' })
secret('platform-rollback.config.json', { apps: [{ name: 'hzy-platform-dev', cwd: receipt.oldWorkdir,
  script: '.output/server/index.mjs', interpreter: old.pm2_env.exec_interpreter || 'node', instances: 1,
  exec_mode: 'fork', watch: false, env: nuxtPlatformEnv(env) }] })
secret('platform-upgrade-started.json', { startedAt: new Date().toISOString(), database: identity.db, sourceCommit: '5f898581aea6448385541d88f3357bbbbf24bd37' })
for (const item of sql) {
  await db.query(item.content)
  console.log(`Development migration passed: ${item.name}`)
}
await db.end()
const upgradedEnv = { ...env, HZY_PLATFORM_PM2_NAME: 'hzy-platform-dev', HOST: '127.0.0.1', PORT: '3011',
  NITRO_HOST: '127.0.0.1', NITRO_PORT: '3011', NODE_ENV: 'production', NODE_OPTIONS: '--max-old-space-size=448',
  HZY_DEPLOYMENT_PROFILE: 'platform-self-hosted-db' }
// Explicit Nuxt runtime overrides are required: DB_* alone is build-time input.
for (const key of ['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD', 'CONNECTION_LIMIT']) upgradedEnv[`NUXT_DB_${key}`] = env[`DB_${key}`] || (key === 'PORT' ? '3306' : key === 'CONNECTION_LIMIT' ? '3' : '')
upgradedEnv.NUXT_SECURITY_INTERNAL_SERVICE_TOKENS = [env.HZY_CLOUDFLARE_INTERNAL_TOKEN, env.PLATFORM_INTERNAL_SERVICE_TOKENS, env.PLATFORM_INTERNAL_SERVICE_TOKEN].filter(Boolean).join(',')
upgradedEnv.NUXT_PUBLIC_SERVICE_URL = env.PLATFORM_SERVICE_URL
upgradedEnv.NUXT_PUBLIC_PLATFORM_STAGE = 'test'
secret('platform-dev.config.json', { apps: [{ name: 'hzy-platform-dev', cwd: source, script: '.output/server/index.mjs',
  interpreter: '/root/.nvm/versions/node/v24.18.0/bin/node', instances: 1, exec_mode: 'fork', autorestart: true,
  watch: false, max_memory_restart: '512M', env: nuxtPlatformEnv(upgradedEnv),
  error_file: `${root}/platform-dev-error.log`, out_file: `${root}/platform-dev-out.log` }] })
secret('platform-upgrade-migrated.json', { database: 'hzy_platform_dev', sourceCommit: '5f898581aea6448385541d88f3357bbbbf24bd37', sourcePatchHashes, migratedAt: new Date().toISOString(), migrations: restored.migrations, signingKid: probe.signingKid })
execFileSync(process.execPath, [`${root}/platform-cutover.mjs`, '--execute'], { stdio: 'pipe' })
console.log('Development control plane upgraded; original development DB and signing identity retained. Production untouched.')
