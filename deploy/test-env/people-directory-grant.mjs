#!/usr/bin/env node
// Explicitly approved test-only repair. Run on the isolated domestic host.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const run = (cmd, args, input) => execFileSync(cmd, args, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
try {
  const execute = process.argv[2] === '--execute'
  if (!['--check', '--execute'].includes(process.argv[2])) throw Error('mode')
  if (run('hostname', []) !== 'iZcqwiqyhp9u8rZ') throw Error('host')
  const config = JSON.parse(readFileSync('/wiztek/hzy-test/runtime/config.json', 'utf8'))
  const db = 'hzy_console_test_20260905'
  if (config.tenant !== 'C000001' || config.deployment !== 'c000001-test-tenant-runtime'
    || config.deploymentBindings?.console !== 'wiztek-test-console'
    || config.deploymentBindings?.people !== 'C000001-test-people'
    || config.auth?.mode !== 'jwt' || config.apps?.console?.db?.database !== db
    || config.apps.console.db.host !== '127.0.0.1' || config.apps.console.db.port !== 13316) throw Error('binding')
  const sql = input => run('docker', ['exec', '-i', 'hzy-test-mysql', 'sh', '-c',
    'MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysql -uroot --batch --raw --skip-column-names hzy_console_test_20260905'], input)
  const clients = sql("SELECT id FROM service_clients WHERE client_code='people.runtime' AND app_code='people' AND status='active' AND current_credential_id IS NOT NULL;").split('\n')
  if (clients.length !== 1 || !/^\d+$/.test(clients[0])) throw Error('client')
  const id = clients[0]
  const read = () => sql(`SELECT JSON_OBJECT('id',id,'resource',resource_code,'action',action,'scope',scope_json,'status',status) FROM service_client_grants WHERE service_client_id=${id} ORDER BY id;`).split('\n').filter(Boolean).map(JSON.parse)
  const before = read()
  const existing = before.filter(g => g.resource === 'console:directory-users' && g.action === 'read')
  if (existing.length) {
    if (existing.length !== 1 || existing[0].status !== 'active' || existing[0].scope?.tenantCode !== 'C000001'
      || existing[0].scope?.deploymentCode !== 'C000001-test-people') throw Error('existing grant requires review')
    console.log(JSON.stringify({ status: 'already present', grant: existing[0] })); process.exit(0)
  }
  console.log(JSON.stringify({ mode: process.argv[2], client: 'people.runtime', clientId: id,
    tenant: config.tenant, deployment: config.deploymentBindings.people, scope: 'console:directory-users:read', beforeCount: before.length }))
  if (execute) {
    const backup = '/wiztek/hzy-test/backups/people-directory-grant-20260906'
    mkdirSync(backup, { mode: 0o700 })
    writeFileSync(`${backup}/before.json`, JSON.stringify(before, null, 2), { mode: 0o600, flag: 'wx' })
    sql(`INSERT INTO service_client_grants (service_client_id,resource_code,action,scope_json,status,created_at,updated_at)
      VALUES (${id},'console:directory-users','read',JSON_OBJECT('source','approved-test-repair:20260906',
      'semanticScope','console:directory-users:read','audience','console','tenantCode','C000001',
      'deploymentCode','C000001-test-people','purpose','people-directory-sharing-read'),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP());`)
    const after = read(), added = after.filter(g => !before.some(b => b.id === g.id))
    if (added.length !== 1 || JSON.stringify(after.filter(g => g.id !== added[0].id)) !== JSON.stringify(before)) throw Error('verification')
    writeFileSync(`${backup}/rollback.sql`, `DELETE FROM service_client_grants WHERE id=${added[0].id} AND service_client_id=${id} AND resource_code='console:directory-users' AND action='read';\n`, { mode: 0o600, flag: 'wx' })
    console.log(JSON.stringify({ status: 'added', grant: added[0], otherGrantsUnchanged: true }))
  }
} catch {
  console.error('Test grant repair stopped; inspect guarded target. Credentials and SQL errors suppressed.')
  process.exitCode = 1
}
