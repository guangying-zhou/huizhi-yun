#!/usr/bin/env node
// Run only on the approved production Runtime host. No credential output.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const change = 'POLICY-STORE-C000001-20260907'
const mode = process.argv[2] || '--check'
try {
  if (!['--check', '--execute'].includes(mode)) throw Error('mode')
  if (mode === '--execute' && process.argv[3] !== change) throw Error('confirmation')
  const env = {}
  for (const line of readFileSync('/etc/hzy-data-runtime/.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  }
  const health = JSON.parse(execFileSync('curl', ['-fsS', '--max-time', '10', 'http://127.0.0.1:18080/runtime/health'], { encoding: 'utf8' }))
  const bindings = JSON.parse(readFileSync('/etc/hzy-data-runtime/deployment-bindings.json', 'utf8'))
  if (execFileSync('hostname', [], { encoding: 'utf8' }).trim() !== 'vultr.guest'
    || health.tenant !== 'C000001' || health.deployment !== 'c000001-prod-tenant-runtime'
    || bindings.console !== 'C000001-console' || env.HZY_CONSOLE_DB_NAME !== 'hzy_console'
    || env.HZY_DATA_RUNTIME_AUTH_MODE !== 'jwt' || env.HZY_DATA_RUNTIME_DB_USER !== 'root') throw Error('target')
  const sql = input => execFileSync('mysql', ['--host=127.0.0.1', '--port=3306', '--user=root', '--batch', '--raw', '--skip-column-names', 'hzy_console'], {
    input, env: { ...process.env, MYSQL_PWD: env.HZY_DATA_RUNTIME_DB_PASSWORD }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  }).trim()
  const ready = sql("SELECT COUNT(*) FROM service_clients c JOIN service_client_credentials k ON k.id=c.current_credential_id AND k.service_client_id=c.id WHERE c.client_code='console.runtime' AND c.app_code='console' AND c.status='active' AND k.status='active';")
  if (ready !== '1') throw Error('client readiness')
  const before = sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='policy_bundle_snapshots';")
  if (mode === '--execute') {
    const dir = `/var/backups/hzy-policy/${change}`
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    // Only the affected grant table; no credential, Vault or business rows.
    const backup = execFileSync('mysqldump', ['--host=127.0.0.1', '--port=3306', '--user=root', '--single-transaction', '--quick', '--no-tablespaces', '--set-gtid-purged=OFF', 'hzy_console', 'service_client_grants'], {
      env: { ...process.env, MYSQL_PWD: env.HZY_DATA_RUNTIME_DB_PASSWORD }, stdio: ['ignore', 'pipe', 'pipe']
    })
    writeFileSync(`${dir}/grants.sql`, backup, { flag: 'wx', mode: 0o600 })
    writeFileSync(`${dir}/before.json`, JSON.stringify({ change, tenant: health.tenant, deployment: bindings.console, tableExisted: before === '1', backupSha256: createHash('sha256').update(backup).digest('hex') }), { flag: 'wx', mode: 0o600 })
    sql(readFileSync(new URL('./Console-SQL-Migration-policy-bundle-snapshots.sql', import.meta.url), 'utf8'))
    if (sql(readFileSync(new URL('./Console-SQL-Seed-policy-bundle-grants.sql', import.meta.url), 'utf8')) !== '2') throw Error('grant drift')
  }
  console.log(JSON.stringify({ change, mode, tenant: health.tenant, consoleDeployment: bindings.console, tableBefore: Number(before) }))
  console.log(sql("SELECT COUNT(*) AS active_grants FROM service_client_grants g JOIN service_clients c ON c.id=g.service_client_id WHERE c.client_code='console.runtime' AND g.resource_code='console:policy-bundle' AND g.action IN ('read','write') AND g.status='active';"))
  if (before === '1' || mode === '--execute') console.log(sql("SELECT JSON_OBJECT('snapshots',COUNT(*),'newestSyncMs',MAX(synced_at_ms),'ageMs',ROUND(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000)-MAX(synced_at_ms),'maxEnvelopeBytes',MAX(OCTET_LENGTH(envelope))) FROM policy_bundle_snapshots WHERE tenant_code='C000001' AND deployment_code='C000001-console';"))
} catch {
  console.error('Production policy migration stopped; inspect controlled host evidence. Sensitive diagnostics suppressed; do not automatically retry.')
  process.exitCode = 1
}
