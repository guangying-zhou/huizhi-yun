#!/usr/bin/env node
// Guarded TEST-only additive migration. No production database or business rows.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

try {
  const mode = process.argv[2]
  if (!['--check', '--execute'].includes(mode)) throw Error('mode')
  const c = JSON.parse(readFileSync('/wiztek/hzy-test/runtime/config.json', 'utf8'))
  const hostname = execFileSync('hostname', [], { encoding: 'utf8' }).trim()
  if (hostname !== 'iZcqwiqyhp9u8rZ' || c.tenant !== 'C000001'
    || c.deployment !== 'c000001-test-tenant-runtime' || c.deploymentBindings?.console !== 'wiztek-test-console'
    || c.apps?.console?.db?.database !== 'hzy_console_test_20260905'
    || c.apps.console.db.port !== 13316 || c.auth?.mode !== 'jwt') throw Error('binding')
  const sql = input => execFileSync('docker', ['exec', '-i', 'hzy-test-mysql', 'sh', '-c',
    'MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysql -uroot --batch --raw --skip-column-names hzy_console_test_20260905'],
  { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  const clientCount = sql("SELECT COUNT(*) FROM service_clients WHERE client_code='console.runtime' AND app_code='console' AND status='active' AND current_credential_id IS NOT NULL;")
  if (clientCount !== '1') throw Error('client')
  if (mode === '--execute') {
    sql(readFileSync(new URL('./Console-SQL-Migration-policy-bundle-snapshots.sql', import.meta.url), 'utf8'))
    const count = sql(readFileSync(new URL('./Console-SQL-Seed-policy-bundle-grants.sql', import.meta.url), 'utf8'))
    if (count !== '2') throw Error('grant drift')
  }
  const tables = sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='policy_bundle_snapshots';")
  console.log(JSON.stringify({ mode, tenant: c.tenant, database: c.apps.console.db.database, tables: Number(tables) }))
  if (tables === '1') console.log(sql("SELECT JSON_OBJECT('snapshots',COUNT(*),'newestSyncMs',MAX(synced_at_ms),'maxEnvelopeBytes',MAX(OCTET_LENGTH(envelope))) FROM policy_bundle_snapshots WHERE tenant_code='C000001' AND deployment_code='wiztek-test-console';"))
} catch {
  console.error('Policy storage migration stopped; guarded target/grant verification failed. No credentials logged.')
  process.exitCode = 1
}
