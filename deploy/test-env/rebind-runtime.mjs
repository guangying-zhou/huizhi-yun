#!/usr/bin/env node
// One-time, guarded rebind of the existing domestic test Runtime. No Platform writes.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, createCipheriv } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

export const targetBinding = {
  tenant: 'C000001', deployment: 'c000001-test-tenant-runtime',
  deploymentBindings: { console: 'C000001-test-console', people: 'C000001-test-people' }
}
export function rebindConfig(source) {
  if (source.tenant !== 'HTEST001' || source.deployment !== 'htest001-test-tenant-runtime'
    || source.deploymentBindings?.console !== 'HTEST001-console'
    || source.deploymentBindings?.people !== 'HTEST001-people'
    || Object.keys(source.deploymentBindings).length !== 2) throw new Error('Unexpected source binding')
  if (source.server?.host !== '127.0.0.1' || source.server?.port !== 18084
    || source.auth?.mode !== 'jwt' || !source.auth.jwt?.jwksJson
    || Object.keys(source.control || {}).length) throw new Error('Unexpected security/control configuration')
  for (const app of ['console', 'directory', 'people']) {
    const db = source.apps?.[app]?.db
    const schema = app === 'people' ? 'hzy_people_test_20260905' : 'hzy_console_test_20260905'
    if (!source.apps[app].enabled || db?.host !== '127.0.0.1' || db.port !== 13316
      || db.database !== schema || db.user !== 'hzy_test_runtime') throw new Error('Non-test database rejected')
  }
  return { ...structuredClone(source), ...structuredClone(targetBinding) }
}

async function main() {
  const mode = process.argv[2] || '--check'
  if (!['--check', '--execute'].includes(mode)) throw new Error('Use --check or --execute')
  const run = (cmd, args, input) => execFileSync(cmd, args, {
    input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024
  })
  if (run('hostname', []).toString().trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Unexpected host')
  const root = '/wiztek/hzy-test', path = `${root}/runtime/config.json`
  const backup = `${root}/backups/rebind-c000001-test-20260905`
  const original = fs.readFileSync(path), before = JSON.parse(original)
  const after = rebindConfig(before)
  const mysql = JSON.parse(run('docker', ['inspect', 'hzy-test-mysql']))[0]
  if (mysql.Config.Labels?.['hzy.environment'] !== 'test'
    || mysql.HostConfig.PortBindings?.['3306/tcp']?.[0]?.HostIp !== '127.0.0.1'
    || mysql.HostConfig.PortBindings?.['3306/tcp']?.[0]?.HostPort !== '13316') throw new Error('Unexpected MySQL container')
  if (run('systemctl', ['is-active', 'hzy-test-data-runtime']).toString().trim() !== 'active') throw new Error('Runtime not active')
  const sql = input => run('docker', ['exec', '-i', 'hzy-test-mysql', 'sh', '-c',
    'MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysql -uroot --batch --raw --skip-column-names'], input).toString().trim()
  const db = 'hzy_console_test_20260905', peopleDb = 'hzy_people_test_20260905'
  const q = text => `CONVERT(0x${Buffer.from(text).toString('hex')} USING utf8mb4)`
  const profiles = sql(`SELECT JSON_OBJECT('id',id,'tenant',tenant_code,'updatedAt',CAST(updated_at AS CHAR)) FROM ${db}.org_profiles;`).split('\n').filter(Boolean).map(JSON.parse)
  if (profiles.length !== 1 || profiles[0].tenant !== 'HTEST001') throw new Error('Unexpected org profile')
  const grants = sql(`SELECT JSON_OBJECT('id',g.id,'scope',g.scope_json,'status',g.status,'client',c.client_code,'resource',g.resource_code,'action',g.action,'updatedAt',CAST(g.updated_at AS CHAR)) FROM ${db}.service_client_grants g JOIN ${db}.service_clients c ON c.id=g.service_client_id ORDER BY g.id;`).split('\n').filter(Boolean).map(JSON.parse)
  if (grants.length !== 4 || new Set(grants.map(g => `${g.resource}:${g.action}`)).size !== 4
    || grants.some(g => g.client !== 'people.runtime' || g.status !== 'active'
      || !['data-runtime:people', 'tenant-runtime:people'].includes(g.resource)
      || !['read', 'write'].includes(g.action) || g.scope?.tenantCode !== 'HTEST001'
      || g.scope.deploymentCode !== 'HTEST001-people'
      || g.scope.audience !== g.resource.split(':')[0])) throw new Error('Unexpected service grants')
  // Discover textual references, but never return business values or credentials.
  const columns = sql(`SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN ('${db}','${peopleDb}') AND DATA_TYPE IN ('char','varchar','text','mediumtext','longtext','json') ORDER BY TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME;`).split('\n').filter(Boolean).map(s => s.split('\t'))
  const refs = sql(columns.map(([schema, table, column]) => `SELECT '${schema}.${table}.${column}',COUNT(*) FROM \`${schema}\`.\`${table}\` WHERE CAST(\`${column}\` AS CHAR) LIKE '%HTEST001%' HAVING COUNT(*)>0`).join(' UNION ALL ') + ';')
  const expectedRefs = new Set([`${db}.org_profiles.tenant_code\t1`, `${db}.service_client_grants.scope_json\t4`])
  if (refs.split('\n').filter(Boolean).some(line => !expectedRefs.has(line))) throw new Error('Additional old-tenant references require review')
  console.log(JSON.stringify({ mode, source: before.tenant, target: targetBinding,
    databases: [db, peopleDb], orgProfiles: profiles.length, serviceGrants: grants.length,
    auth: 'jwt unchanged', platformEnrollment: 'not configured; unchanged' }))
  if (mode === '--check') return
  fs.mkdirSync(backup, { mode: 0o700 }) // Existing backup/receipt refuses repeat execution.
  const save = (name, value) => fs.writeFileSync(`${backup}/${name}`, value, { mode: 0o600, flag: 'wx' })
  save('runtime-config.json', original)
  const hash = value => createHash('sha256').update(value).digest('hex')
  const dump = (schema, ignored = []) => run('docker', ['exec', 'hzy-test-mysql', 'sh', '-c',
    'MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysqldump -uroot "$@"', 'mysqldump',
    '--single-transaction', '--quick', '--no-tablespaces', '--set-gtid-purged=OFF',
    '--skip-triggers', '--skip-events', '--hex-blob', '--skip-add-locks', '--skip-comments',
    '--compact', '--order-by-primary', ...ignored.map(t => `--ignore-table=${schema}.${t}`), schema])
  const protectedHashes = () => ({
    console: hash(dump(db, ['org_profiles', 'service_client_grants'])), people: hash(dump(peopleDb))
  })
  const rollbackSql = `START TRANSACTION; UPDATE ${db}.org_profiles SET tenant_code='HTEST001',updated_at=${q(profiles[0].updatedAt)} WHERE id=${profiles[0].id};\n`
    + grants.map(g => `UPDATE ${db}.service_client_grants SET scope_json=${q(JSON.stringify(g.scope))},updated_at=${q(g.updatedAt)} WHERE id=${g.id};`).join('\n') + '\nCOMMIT;'
  save('rollback.sql', rollbackSql)
  let changed = false
  run('systemctl', ['stop', 'hzy-test-data-runtime'])
  try {
    if (!fs.readFileSync(path).equals(original)) throw new Error('Config drift')
    const key = randomBytes(32)
    save('backup-key', key)
    for (const schema of [db, peopleDb]) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(gzipSync(dump(schema))), cipher.final()])
      save(`${schema}.enc`, Buffer.concat([iv, cipher.getAuthTag(), encrypted]))
    }
    const protectedBefore = protectedHashes()
    save('before.json', JSON.stringify({ protectedBefore, configSha256: hash(original), profiles, grants }, null, 2))
    changed = true
    sql(`START TRANSACTION; UPDATE ${db}.org_profiles SET tenant_code='C000001' WHERE id=${profiles[0].id} AND tenant_code='HTEST001';\n`
      + grants.map(g => `UPDATE ${db}.service_client_grants SET scope_json=JSON_SET(scope_json,'$.tenantCode','C000001','$.deploymentCode','C000001-test-people') WHERE id=${g.id} AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.tenantCode'))='HTEST001';`).join('\n') + '\nCOMMIT;')
    if (sql(`SELECT COUNT(*) FROM ${db}.org_profiles WHERE tenant_code='C000001';`) !== '1'
      || sql(`SELECT COUNT(*) FROM ${db}.service_client_grants WHERE JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.tenantCode'))='C000001' AND JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.deploymentCode'))='C000001-test-people';`) !== '4') throw new Error('DB binding mismatch')
    if (JSON.stringify(protectedHashes()) !== JSON.stringify(protectedBefore)) throw new Error('Protected data changed')
    // In-place write keeps the existing root/runtime ownership and mode.
    fs.writeFileSync(path, JSON.stringify(after, null, 2))
    run('systemctl', ['start', 'hzy-test-data-runtime'])
    let health
    for (let i = 0; i < 15; i++) {
      try {
        const r = await fetch('http://127.0.0.1:18084/runtime/health', { signal: AbortSignal.timeout(2000) })
        if (r.ok) { health = await r.json(); if (health.status === 'ok') break }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (health?.tenant !== targetBinding.tenant || health.deployment !== targetBinding.deployment
      || health.status !== 'ok' || ['console', 'directory', 'people'].some(app => health.apps?.[app]?.db !== 'ok')) throw new Error('Health mismatch')
    for (const headers of [{}, { Authorization: 'Bearer invalid-test-token', 'x-hzy-tenant': 'C000001' }]) {
      const denied = await fetch('http://127.0.0.1:18084/v1/console/directory/users', { headers, signal: AbortSignal.timeout(3000) })
      if (denied.status !== 401) throw new Error('Authentication boundary failed')
    }
    save('complete.json', JSON.stringify({ completedAt: new Date().toISOString(), ...targetBinding,
      protectedBefore, databases: [db, peopleDb], jwtRequired: true, platformEnrolled: false }, null, 2))
    console.log('Rebind complete: C000001 test Runtime healthy; 4 grants rebound; protected data unchanged; unauthorized requests rejected (401).')
  } catch (error) {
    run('systemctl', ['stop', 'hzy-test-data-runtime'])
    if (changed) sql(rollbackSql)
    fs.writeFileSync(path, original)
    run('systemctl', ['start', 'hzy-test-data-runtime'])
    console.error('Rebind failed; original binding restored. Protected backups retained.')
    throw error
  }
}

if (process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().catch(() => { console.error('Rebind stopped; inspect protected host state. SQL, rows and credentials suppressed.'); process.exitCode = 1 })
}
