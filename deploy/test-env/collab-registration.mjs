/** Stage B collab.runtime service identity for the C000001 test tenant.
 * Default plan; --verify performs SELECT only; --apply is explicit and transactional.
 * Never creates credentials or reactivates revoked records. The Runtime routes
 * stay closed until deploymentBindings.collab equals `deployment` below and
 * apps.codocs.collaborationV2Enabled is set (docs/Codocs-Document-Write-Coordination.md). */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enterprisePilot as p } from './enterprise-topology.mjs'

export const collabRegistrationPlan = {
  tenant: p.tenantCode,
  consoleDatabase: 'hzy_console_test_local_20260910',
  serviceClient: 'collab.runtime',
  appCode: 'collab',
  deployment: `${p.tenantCode}-test-collab`,
  audience: 'data-runtime',
  capabilities: ['codocs:collaboration-snapshots:read', 'codocs:collaboration-snapshots:publish'],
  credentialIssued: false
}

// Capabilities must be declared by the target manifest (codocs), never invented here.
const manifest = JSON.parse(readFileSync(new URL('../../codocs/app.manifest.json', import.meta.url)))
for (const capability of collabRegistrationPlan.capabilities) {
  const [app, resource, action] = capability.split(':')
  if (app !== manifest.appCode || !manifest.resources.some(item => item.code === resource && item.actions.includes(action))) throw Error('COLLAB_CAPABILITY_UNDECLARED')
}

const parse = value => (typeof value === 'string' ? JSON.parse(value) : value)
export function collabGrantScope(capability) {
  return { source: 'collab-test-pilot', tenantCode: collabRegistrationPlan.tenant, deploymentCode: collabRegistrationPlan.deployment, audience: collabRegistrationPlan.audience, semanticScope: capability }
}
export function collabGrantMatches(value, capability) {
  const scope = parse(value)
  return scope?.tenantCode === collabRegistrationPlan.tenant && scope?.deploymentCode === collabRegistrationPlan.deployment
    && scope?.audience === collabRegistrationPlan.audience && scope?.semanticScope === capability
}
const split = capability => { const i = capability.lastIndexOf(':'); return [capability.slice(0, i), capability.slice(i + 1)] }

export async function verifyCollabRegistration(db) {
  const [service] = await db.query("SELECT client_code,app_code,status,current_credential_id IS NOT NULL AS hasCurrentCredential FROM service_clients WHERE client_code='collab.runtime'")
  const [grants] = await db.query("SELECT g.resource_code,g.action,g.status,g.scope_json FROM service_client_grants g JOIN service_clients c ON c.id=g.service_client_id WHERE c.client_code='collab.runtime'")
  const active = capability => { const [resource, action] = split(capability); return grants.some(g => g.resource_code === resource && g.action === action && g.status === 'active' && collabGrantMatches(g.scope_json, capability)) }
  return {
    serviceClientActive: service.some(c => c.app_code === 'collab' && c.status === 'active'),
    currentCredentialPointer: service.some(c => Boolean(c.hasCurrentCredential)),
    missingCapabilities: collabRegistrationPlan.capabilities.filter(capability => !active(capability)),
    unexpectedActiveCapabilities: grants.filter(g => g.status === 'active' && !collabRegistrationPlan.capabilities.some(capability => capability === `${g.resource_code}:${g.action}` && collabGrantMatches(g.scope_json, capability))).map(g => `${g.resource_code}:${g.action}`),
    tokenIssuanceVerified: false
  }
}

export async function applyCollabRegistration(db) {
  await db.beginTransaction()
  try {
    const [services] = await db.query("SELECT id,app_code,status FROM service_clients WHERE client_code='collab.runtime' FOR UPDATE")
    if (services.some(c => c.app_code !== 'collab' || c.status !== 'active')) throw Error('SERVICE_STATE_CONFLICT')
    if (!services.length) await db.query("INSERT INTO service_clients(client_code,client_name,client_type,app_code,description,status) VALUES('collab.runtime','Collab Runtime','runtime','collab','Stage B v2 collaboration snapshots, C000001 test; credential enrolled separately','active')")
    const [[service]] = await db.query("SELECT id FROM service_clients WHERE client_code='collab.runtime'")
    for (const capability of collabRegistrationPlan.capabilities) {
      const [resource, action] = split(capability)
      const [existing] = await db.query('SELECT status,scope_json FROM service_client_grants WHERE service_client_id=? AND resource_code=? AND action=? FOR UPDATE', [service.id, resource, action])
      if (existing.some(row => row.status !== 'active')) throw Error('GRANT_REVOKED')
      if (existing.some(row => !collabGrantMatches(row.scope_json, capability))) throw Error('GRANT_SCOPE_CONFLICT')
      if (!existing.length) await db.query("INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status) VALUES(?,?,?,?,'active')", [service.id, resource, action, JSON.stringify(collabGrantScope(capability))])
    }
    await db.commit()
  } catch (error) { await db.rollback(); throw error }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let db
  try {
    const mode = process.argv[2] || '--plan'
    if (!['--plan', '--verify', '--apply'].includes(mode)) throw Error('UNKNOWN_MODE')
    if (mode === '--plan') console.log(JSON.stringify(collabRegistrationPlan, null, 2))
    else {
      const config = JSON.parse(readFileSync(resolve(homedir(), 'Library/Application Support/HuizhiYun/test-runtime/config.json')))
      const d = config.apps?.console?.db
      if (config.tenant !== p.tenantCode || config.deployment !== p.runtimeDeployment || config.deploymentBindings?.console !== p.consoleDeployment || d?.database !== collabRegistrationPlan.consoleDatabase || d.host !== '127.0.0.1') throw Error('TARGET_MISMATCH')
      const mysql = createRequire(new URL('../../platform/package.json', import.meta.url))('mysql2/promise')
      db = await mysql.createConnection({ host: d.host, port: d.port, user: d.user, password: d.password, database: d.database })
      const [[identity]] = await db.query('SELECT DATABASE() AS name,@@server_uuid AS uuid')
      if (identity.name !== collabRegistrationPlan.consoleDatabase || identity.uuid !== '37d8994e-4c12-11ee-afad-8cb2da2e572b') throw Error('INSTANCE_MISMATCH')
      if (mode === '--apply') await applyCollabRegistration(db)
      console.log(JSON.stringify(await verifyCollabRegistration(db), null, 2))
    }
  } catch { console.error('COLLAB_REGISTRATION_FAILED (details suppressed)'); process.exitCode = 1 } finally { await db?.end() }
}
