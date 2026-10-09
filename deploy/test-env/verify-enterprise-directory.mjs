// Real signed token issuance + target service authorization; no token output/files.
import { readFileSync, statSync } from 'node:fs'
import { capabilities } from './enterprise-directory-grants.mjs'
const origin = 'https://hzy-test.huizhi.yun'
async function main() {
  if (process.argv[2] !== '--execute' || process.argv.length !== 3) throw Error('EXPLICIT_EXECUTE_REQUIRED')
  const file = new URL('./.cloudflare-workers/gateway/secrets.json', import.meta.url)
  const stat = statSync(file)
  if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077) throw Error('CREDENTIAL_FILE_PERMISSIONS')
  const secrets = JSON.parse(readFileSync(file)), key = secrets.HZY_CLOUDFLARE_INTERNAL_TOKEN || secrets.HZY_TENANT_GATEWAY_INTERNAL_TOKEN
  if (!key) throw Error('GATEWAY_CREDENTIAL_MISSING')
  const digest = await fetch(origin + '/__test/registry-digest', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { authorization: `Bearer ${key}` } })
  const live = await digest.json()
  if (!digest.ok || live.tenant !== 'C000001' || live.environment !== 'test' || live.enterpriseDeployment !== 'C000001-test-enterprise') throw Error('REGISTRY_MISMATCH')
  const headers = { 'x-hzy-gateway': 'tenant-gateway', 'x-hzy-gateway-token': key, 'x-hzy-app-code': 'enterprise', 'x-hzy-tenant': 'C000001', 'x-hzy-environment': 'test', 'x-hzy-deployment': 'C000001-test-enterprise' }
  const issue = (scope, audience = 'console') => fetch(origin + '/oauth/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'enterprise.runtime', app_code: 'enterprise', audience, scope, source_binding: 'service-client-policy' }) })
  const paths = ['/api/v1/console/service/directory/project-access?projection=projects&only_group=true', '/api/v1/console/service/business-domains']
  const get = (path, token) => fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(30000), headers: { ...headers, authorization: `Bearer ${token}` } })
  const results = []
  for (let i = 0; i < capabilities.length; i++) {
    const response = await issue(capabilities[i]), payload = await response.json()
    if (!response.ok || payload.scope !== capabilities[i] || !payload.access_token) throw Error('TOKEN_ISSUANCE_FAILED')
    const service = await get(paths[i], payload.access_token)
    await service.body?.cancel()
    if (service.status !== 200) throw Error('SERVICE_READ_FAILED')
    const denied = await get(paths[1 - i], payload.access_token)
    await denied.body?.cancel()
    if (denied.status !== 403) throw Error('CROSS_CAPABILITY_NOT_REJECTED')
    const wrongAudience = await issue(capabilities[i], 'data-runtime')
    await wrongAudience.body?.cancel()
    if (![400, 403].includes(wrongAudience.status)) throw Error('WRONG_AUDIENCE_NOT_REJECTED')
    results.push({ capability: capabilities[i], tokenIssued: true, targetReadStatus: service.status, crossCapabilityDenied: true, wrongAudienceDenied: true })
  }
  console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), tenant: 'C000001', deployment: 'C000001-test-enterprise', audience: 'console', results, configurationMutated: false }))
}
main().catch(error => { console.error(/^[A-Z_]+$/.test(error?.message) ? error.message : 'DIRECTORY_PROBE_FAILED'); process.exitCode = 1 })
