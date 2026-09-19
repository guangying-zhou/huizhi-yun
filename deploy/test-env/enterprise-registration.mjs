/** Default plan; --verify performs SELECT only; --apply is explicit and transactional.
 * Never creates credentials or reactivates revoked records. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enterprisePilot as p } from './enterprise-topology.mjs'
const template = JSON.parse(readFileSync(new URL('./enterprise-readiness.template.json', import.meta.url)))
export const registrationPlan = {
  tenant: p.tenantCode, consoleDatabase: 'hzy_console_test_local_20260910',
  client: { clientId: 'enterprise', appCode: 'enterprise', clientType: 'public', callback: p.callback, postLogout: p.logoutRedirect },
  serviceClient: 'enterprise.runtime', capabilities: template.servicePolicy.capabilities,
  deployment: p.deploymentCode, audience: 'data-runtime',
  externalServicePolicies: template.externalServicePolicies, credentialIssued: false
}
// External service grants remain separate from the Runtime transport allowlist.
export const registrationGrants = [
  ...registrationPlan.capabilities.map(capability => ({ capability, audience: registrationPlan.audience })),
  ...registrationPlan.externalServicePolicies.flatMap(policy => policy.capabilities.map(capability => ({ capability, audience: policy.audience })))
]
// The target manifest defines available actions; this template only selects grants.
for (const policy of registrationPlan.externalServicePolicies) {
  if (!/^[a-z][a-z0-9-]*$/.test(policy.audience) || ['data-runtime','tenant-runtime'].includes(policy.audience)) throw Error('EXTERNAL_AUDIENCE_INVALID')
  const manifest=JSON.parse(readFileSync(new URL(`../../${policy.audience}/app.manifest.json`,import.meta.url)))
  for (const capability of policy.capabilities) {
    // 复合动作（codocs:project-document:content:read）在 manifest 里是一个带冒号的 action；
    // 按三段硬拆会把已声明的能力判成未声明。
    const [app,resource,...rest]=capability.split(':')
    const action=rest.join(':')
    if (!action || app!==manifest.appCode || app!==policy.audience || !manifest.resources.some(item=>item.code===resource&&item.actions.includes(action))) throw Error('EXTERNAL_CAPABILITY_UNDECLARED')
  }
}
if (new Set(registrationGrants.map(grant=>grant.capability)).size!==registrationGrants.length) throw Error('DUPLICATE_CAPABILITY_GRANT')
function scopeMatches(value) {
  const scope = typeof value === 'string' ? JSON.parse(value) : value
  return scope?.tenantCode === p.tenantCode && scope?.deploymentCode === p.deploymentCode
}
function semanticMatches(value,cap,audience) {
  const scope=typeof value==='string'?JSON.parse(value):value
  return scope?.audience===audience&&scope?.semanticScope===cap
}
export async function verifyRegistration(db) {
  const [clients] = await db.query("SELECT client_id,app_code,client_type,auth_mode,status FROM auth_clients WHERE client_id='enterprise'")
  const [uris] = await db.query("SELECT u.uri_type,u.redirect_uri,u.status FROM auth_client_redirect_uris u JOIN auth_clients c ON c.id=u.client_id WHERE c.client_id='enterprise'")
  const [service] = await db.query("SELECT client_code,app_code,status,current_credential_id IS NOT NULL AS hasCurrentCredential FROM service_clients WHERE client_code='enterprise.runtime'")
  const [grants] = await db.query("SELECT g.resource_code,g.action,g.status,g.scope_json FROM service_client_grants g JOIN service_clients c ON c.id=g.service_client_id WHERE c.client_code='enterprise.runtime'")
  const grantActive = ({capability: cap, audience}) => { const i=cap.lastIndexOf(':'); return grants.some(g=>g.resource_code===cap.slice(0,i)&&g.action===cap.slice(i+1)&&g.status==='active'&&scopeMatches(g.scope_json)&&semanticMatches(g.scope_json,cap,audience)) }
  return { oidcRegistered: clients.some(c=>c.app_code==='enterprise'&&c.client_type==='public'&&c.auth_mode==='oidc'&&c.status==='active'),
    callbackRegistered: uris.some(u=>u.uri_type==='redirect'&&u.redirect_uri===p.callback&&u.status==='active'),
    logoutRegistered: uris.some(u=>u.uri_type==='post_logout'&&u.redirect_uri===p.logoutRedirect&&u.status==='active'),
    serviceClientActive: service.some(c=>c.app_code==='enterprise'&&c.status==='active'),
    currentCredentialPointer: service.some(c=>Boolean(c.hasCurrentCredential)),
    missingCapabilities: registrationGrants.filter(grant=>!grantActive(grant)).map(grant=>grant.capability),
    unexpectedActiveCapabilities: grants.filter(g=>g.status==='active'&&!registrationGrants.some(grant=>grant.capability===`${g.resource_code}:${g.action}`&&semanticMatches(g.scope_json,grant.capability,grant.audience))).map(g=>`${g.resource_code}:${g.action}`),
    tokenIssuanceVerified: false }
}
export async function applyRegistration(db) {
  await db.beginTransaction()
  try {
    const [clients] = await db.query("SELECT id,app_code,client_type,auth_mode,status FROM auth_clients WHERE client_id='enterprise' FOR UPDATE")
    if (clients.some(c=>c.app_code!=='enterprise'||c.client_type!=='public'||c.auth_mode!=='oidc'||c.status!=='active')) throw Error('OIDC_STATE_CONFLICT')
    await db.query("INSERT INTO auth_clients(client_id,client_name,app_code,client_type,auth_mode,home_url,logout_url,source,status) SELECT 'enterprise','汇智云','enterprise','public','oidc',?,?,'local','active' WHERE NOT EXISTS(SELECT 1 FROM auth_clients WHERE client_id='enterprise')", [p.origin+'/aims/',p.logoutRedirect])
    const [[client]] = await db.query("SELECT id FROM auth_clients WHERE client_id='enterprise'")
    for (const [type,uri] of [['redirect',p.callback],['post_logout',p.logoutRedirect]]) {
      const [existing] = await db.query('SELECT status FROM auth_client_redirect_uris WHERE client_id=? AND uri_type=? AND redirect_uri=? FOR UPDATE',[client.id,type,uri])
      if (existing.some(row=>row.status!=='active')) throw Error('OIDC_URI_REVOKED')
      if (!existing.length) await db.query("INSERT INTO auth_client_redirect_uris(client_id,uri_type,redirect_uri,source,status) VALUES(?,?,?,'local','active')",[client.id,type,uri])
    }
    const [services] = await db.query("SELECT id,app_code,status FROM service_clients WHERE client_code='enterprise.runtime' FOR UPDATE")
    if (services.some(c=>c.app_code!=='enterprise'||c.status!=='active')) throw Error('SERVICE_STATE_CONFLICT')
    if (!services.length) await db.query("INSERT INTO service_clients(client_code,client_name,client_type,app_code,description,status) VALUES('enterprise.runtime','Enterprise Runtime','runtime','enterprise','ADR-018 C000001 test pilot; credential enrolled separately','active')")
    const [[service]] = await db.query("SELECT id FROM service_clients WHERE client_code='enterprise.runtime'")
    for (const {capability: cap, audience} of registrationGrants) {
      const i=cap.lastIndexOf(':'),resource=cap.slice(0,i),action=cap.slice(i+1)
      const [existing] = await db.query('SELECT status,scope_json FROM service_client_grants WHERE service_client_id=? AND resource_code=? AND action=? FOR UPDATE',[service.id,resource,action])
      if (existing.some(row=>row.status!=='active')) throw Error('GRANT_REVOKED')
      if (existing.some(row=>!scopeMatches(row.scope_json))) throw Error('GRANT_SCOPE_CONFLICT')
      for(const row of existing) {
        const scope=typeof row.scope_json==='string'?JSON.parse(row.scope_json):row.scope_json
        if((Object.hasOwn(scope,'audience')&&scope.audience!==audience)||(Object.hasOwn(scope,'semanticScope')&&scope.semanticScope!==cap))throw Error('GRANT_AUDIENCE_CONFLICT')
        if(!semanticMatches(scope,cap,audience))await db.query("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.audience',?,'$.semanticScope',?) WHERE service_client_id=? AND resource_code=? AND action=? AND status='active'",[audience,cap,service.id,resource,action])
      }
      if (!existing.length) await db.query("INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json,status) VALUES(?,?,?,?,'active')",[service.id,resource,action,JSON.stringify({source:'enterprise-test-pilot',tenantCode:p.tenantCode,deploymentCode:p.deploymentCode,audience,semanticScope:cap})])
    }
    await db.commit()
  } catch (error) { await db.rollback(); throw error }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let db
  try {
    const mode=process.argv[2]||'--plan'
    if (!['--plan','--verify','--apply'].includes(mode)) throw Error('UNKNOWN_MODE')
    if(mode==='--plan') console.log(JSON.stringify(registrationPlan,null,2))
    else {
      const config=JSON.parse(readFileSync(resolve(homedir(),'Library/Application Support/HuizhiYun/test-runtime/config.json')))
      const d=config.apps?.console?.db
      if(config.tenant!==p.tenantCode||config.deployment!==p.runtimeDeployment||config.deploymentBindings?.console!==p.consoleDeployment||d?.database!==registrationPlan.consoleDatabase||d.host!=='127.0.0.1') throw Error('TARGET_MISMATCH')
      const mysql=createRequire(new URL('../../platform/package.json',import.meta.url))('mysql2/promise')
      db=await mysql.createConnection({host:d.host,port:d.port,user:d.user,password:d.password,database:d.database})
      const [[identity]]=await db.query('SELECT DATABASE() AS name,@@server_uuid AS uuid')
      if(identity.name!==registrationPlan.consoleDatabase||identity.uuid!=='37d8994e-4c12-11ee-afad-8cb2da2e572b') throw Error('INSTANCE_MISMATCH')
      if(mode==='--apply') await applyRegistration(db)
      console.log(JSON.stringify(await verifyRegistration(db),null,2))
    }
  } catch { console.error('ENTERPRISE_REGISTRATION_FAILED (details suppressed)');process.exitCode=1 } finally { await db?.end() }
}
