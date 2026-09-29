// Explicitly approved C000001 test repair: two exact read grants only.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const capabilities = ['console:directory-project-access:read', 'console:business-domain:view']
const expected = capability => ({ tenantCode: 'C000001', deploymentCode: 'C000001-test-enterprise', audience: 'console', semanticScope: capability })
export function inspect(rows) {
  return capabilities.map(capability => {
    const matches = rows.filter(row => `${row.resource_code}:${row.action}` === capability)
    if (matches.length > 1) throw Error('DUPLICATE_GRANT')
    if (!matches.length) return { capability, state: 'missing' }
    const row = matches[0], scope = typeof row.scope_json === 'string' ? JSON.parse(row.scope_json) : row.scope_json
    if (row.status !== 'active') throw Error('GRANT_REVOKED')
    if (!scope || Object.entries(expected(capability)).some(([key, value]) => scope[key] !== value)) throw Error('GRANT_SCOPE_CONFLICT')
    return { capability, state: 'active', id: row.id }
  })
}

export async function repair(db, apply = false) {
  await db.beginTransaction()
  try {
    const [clients] = await db.query("SELECT id,app_code,status,current_credential_id FROM service_clients WHERE client_code='enterprise.runtime' FOR UPDATE")
    if (clients.length !== 1 || clients[0].app_code !== 'enterprise' || clients[0].status !== 'active' || !clients[0].current_credential_id) throw Error('CLIENT_CONFLICT')
    const clientId = clients[0].id
    const read = async () => (await db.query('SELECT id,resource_code,action,scope_json,status FROM service_client_grants WHERE service_client_id=? ORDER BY id FOR UPDATE', [clientId]))[0]
    const before = await read(), plan = inspect(before), added = []
    if (apply) for (const item of plan.filter(item => item.state === 'missing')) {
      const split = item.capability.lastIndexOf(':')
      const [result] = await db.query("INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status) VALUES(?,?,?,?,'active')", [clientId, item.capability.slice(0, split), item.capability.slice(split + 1), JSON.stringify({ ...expected(item.capability), source: 'approved-enterprise-directory-repair:20260920' })])
      added.push({ capability: item.capability, id: result.insertId })
    }
    const after = await read()
    if (JSON.stringify(after.filter(row => !added.some(item => item.id === row.id))) !== JSON.stringify(before)) throw Error('UNRELATED_GRANT_CHANGED')
    const result = { tenant: 'C000001', deployment: 'C000001-test-enterprise', client: 'enterprise.runtime', grants: inspect(after), added, otherGrantsUnchanged: true }
    if (apply) await db.commit(); else await db.rollback()
    return result
  } catch (error) { await db.rollback(); throw error }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let db
  try {
    const mode = process.argv[2] || '--verify'
    if (!['--verify', '--apply'].includes(mode) || process.argv.length > 3) throw Error('MODE_INVALID')
    const config = JSON.parse(readFileSync(resolve(homedir(), 'Library/Application Support/HuizhiYun/test-runtime/config.json')))
    const d = config.apps?.console?.db
    if (config.tenant !== 'C000001' || config.deployment !== 'c000001-test-tenant-runtime' || config.deploymentBindings?.console !== 'wiztek-test-console' || d?.host !== '127.0.0.1' || d.database !== 'hzy_console_test_local_20260910') throw Error('TARGET_MISMATCH')
    const manifest = JSON.parse(readFileSync(new URL('../../console/app.manifest.json', import.meta.url)))
    for (const capability of capabilities) {
      const [app, resource, action] = capability.split(':')
      if (app !== manifest.appCode || !manifest.resources.some(item => item.code === resource && item.actions.includes(action))) throw Error('CAPABILITY_UNDECLARED')
    }
    const mysql = createRequire(new URL('../../platform/package.json', import.meta.url))('mysql2/promise')
    db = await mysql.createConnection({ host: d.host, port: d.port, user: d.user, password: d.password, database: d.database })
    const [[identity]] = await db.query('SELECT DATABASE() AS name,@@server_uuid AS uuid')
    if (identity.name !== d.database || identity.uuid !== '37d8994e-4c12-11ee-afad-8cb2da2e572b') throw Error('INSTANCE_MISMATCH')
    console.log(JSON.stringify(await repair(db, mode === '--apply')))
  } catch (error) {
    console.error(/^[A-Z_]+$/.test(error?.message) ? error.message : 'DIRECTORY_GRANT_REPAIR_FAILED')
    process.exitCode = 1
  } finally { await db?.end() }
}
