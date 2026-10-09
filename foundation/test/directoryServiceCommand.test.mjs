import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { registerHooks } from 'node:module'

test('fresh Enterprise Directory command uses the legacy HMAC exactly and closed identity pairs', async () => {
  const hooks = registerHooks({ resolve(s, c, next) {
    if (s === './serviceAppUrl')
      return { url: 'data:text/javascript,export const resolveTrustedServiceAppRoute=()=>null', shortCircuit: true }
    if (s === './serviceOidc')
      return { url: 'data:text/javascript,export const requestWithServiceAccessToken=()=>{};export const fetchConsoleServiceJson=()=>{};export const trustedServiceRequestHeaders=()=>({})', shortCircuit: true }
    if (s === './serviceOperation')
      return next(s + '.ts', c)
    return next(s, c)
  } })
  try {
    const { directoryCommandHeaders } = await import('../server/utils/directoryServiceCommand.ts')
    const claims = { token_use: 'service', source_app: 'enterprise', target_app: 'console', client_id: 'enterprise.runtime', hzy: { appCode: 'enterprise', clientCode: 'enterprise.runtime' }, aud: 'console', tenant: 'C000001', deployment: 'C000001-enterprise', scope: 'console:directory-identity:reserve' }
    const token = c => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(c)).toString('base64url')}.signature`
    const op = { operationId: 'f0244b90-07c0-4bb5-8cdd-cdd99f491d1b', operationKey: 'stable', idempotencyKey: 'stable', operationCode: 'people.directory.identity-reserve.v1', requiredCapability: claims.scope, commandSchemaVersion: 'v1', commandSha256: 'a'.repeat(64), tenantCode: claims.tenant, deploymentCode: claims.deployment, sourceApp: 'enterprise', targetApp: 'console', command: { uid: 'employee', originalActorUid: 'HR' } }
    const path = '/api/v1/console/service/directory/onboarding/identity-reservations'
    const stamp = '1800000000'
    const jwt = token(claims)
    const headers = await directoryCommandHeaders(jwt, path, op, 'C000001-console', stamp)
    const canonical = `POST\n${path}\nC000001\nC000001-enterprise\nC000001-console\nenterprise\nconsole\n${op.operationId}\n${op.operationCode}\n${op.requiredCapability}\nstable\nv1\n${op.commandSha256}\nHR\n${stamp}`
    assert.equal(headers['x-hzy-service-command-signature'], createHmac('sha256', jwt).update(canonical).digest('hex'))
    const { verifyPeopleDirectorySignature } = await import('../../console/server/utils/directoryLifecycleReliable.ts')
    const auth = { authenticated: true, subjectType: 'service', tokenUse: 'service', clientCode: 'enterprise.runtime', appCode: 'enterprise', tenant: 'C000001', deployment: 'C000001-enterprise' }
    const body = { serviceCommand: { ...op, sourceDeployment: op.deploymentCode, targetDeployment: 'C000001-console' } }
    // Use an in-window signature for the actual receiver, not the golden time.
    const live = await directoryCommandHeaders(jwt, path, op, 'C000001-console')
    const event = { path, context: { consoleAuth: auth }, node: { req: { headers: live } } }
    assert.equal(verifyPeopleDirectorySignature(event, body, { tenantId: 'C000001', deploymentId: 'C000001-console' }), 'enterprise')
    for (const bad of [{ authenticated: false }, { tokenUse: 'user' }, { clientCode: 'people.runtime' }, { appCode: 'people' }, { deployment: 'other' }, { tenant: 'other' }])
      assert.throws(() => verifyPeopleDirectorySignature({ ...event, context: { consoleAuth: { ...auth, ...bad } } }, body, { tenantId: 'C000001', deploymentId: 'C000001-console' }), { statusCode: 403 })
    for (const bad of [{ token_use: 'user' }, { client_id: 'people.runtime' }, { source_app: 'people' }, { aud: 'data-runtime' }, { tenant: 'other' }, { deployment: 'other' }, { target_app: 'platform' }, { scope: 'console:directory-user:provision' }, { hzy: { appCode: 'enterprise', clientCode: 'foreign.runtime' } }])
      await assert.rejects(directoryCommandHeaders(token({ ...claims, ...bad }), path, op, 'C000001-console', stamp), { statusCode: 403 })
    await assert.rejects(directoryCommandHeaders(jwt, path + '-other', op, 'C000001-console', stamp), { statusCode: 403 })
  } finally {
    hooks.deregister()
  }
})

test('lifecycle probe uses original immutable revision and fresh exact scope, never sends a mutation', async () => {
  globalThis.__lifecycleProbe = { calls: [], claims: { token_use: 'service', source_app: 'enterprise', target_app: 'console', client_id: 'enterprise.runtime', hzy: { appCode: 'enterprise', clientCode: 'enterprise.runtime' }, aud: 'console', tenant: 'C000001', deployment: 'Host', scope: 'console:directory-offboarding:disable' }, result: { lifecycleType: 'offboarding', directoryStatus: 'succeeded', platformStatus: 'partial_unknown' } }
  const hooks = registerHooks({ resolve(s, c, next) {
    if (s === './serviceAppUrl')
      return { url: 'data:text/javascript,export const resolveTrustedServiceAppRoute=()=>({origin:"https://console.test",deploymentCode:"Console"})', shortCircuit: true }
    if (s === './serviceOidc')
      return { url: 'data:text/javascript,' + encodeURIComponent('export const requestWithServiceAccessToken=async o=>{globalThis.__lifecycleProbe.calls.push(o.scope);const c=globalThis.__lifecycleProbe.claims;return o.request(Buffer.from(\'{}\').toString(\'base64url\')+\'.\'+Buffer.from(JSON.stringify(c)).toString(\'base64url\')+\'.signature\')};export const fetchConsoleServiceJson=async(_e,url,o)=>{globalThis.__lifecycleProbe.calls.push([url,o.method]);return {code:0,data:globalThis.__lifecycleProbe.result}};export const trustedServiceRequestHeaders=()=>({})'), shortCircuit: true }
    if (s === './serviceOperation')
      return next(s + '.ts', c)
    return next(s, c)
  } })
  try {
    const { callDirectoryLifecycleProbe } = await import('../server/utils/directoryServiceCommand.ts?probe')
    const op = { operationId: 'f0244b90-07c0-4bb5-8cdd-cdd99f491d1b', operationCode: 'people.directory.offboarding-disable.v1', requiredCapability: 'console:directory-offboarding:disable', tenantCode: 'C000001', deploymentCode: 'Host', sourceApp: 'enterprise', targetApp: 'console', command: { employeeUid: 'employee', sourceRevision: 7, snapshotHash: 'a'.repeat(64), originalActorUid: 'HR' } }
    assert.deepEqual(await callDirectoryLifecycleProbe({}, op), globalThis.__lifecycleProbe.result)
    assert.equal(globalThis.__lifecycleProbe.calls[0], op.requiredCapability)
    const [url, method] = globalThis.__lifecycleProbe.calls[1]
    assert.equal(method, 'GET')
    assert.equal(new URL(url).searchParams.get('revision'), '7')
    assert.equal(new URL(url).searchParams.get('hash'), 'a'.repeat(64))
    const original = structuredClone(globalThis.__lifecycleProbe.claims)
    for (const bad of [{ client_id: 'people.runtime' }, { source_app: 'people' }, { aud: 'data-runtime' }, { tenant: 'Other' }, { deployment: 'Other' }, { token_use: 'user' }, { scope: 'console:directory-employment:sync' }]) {
      globalThis.__lifecycleProbe.claims = { ...original, ...bad }
      await assert.rejects(callDirectoryLifecycleProbe({}, op), { statusCode: 403 })
    }
    globalThis.__lifecycleProbe.claims = original
    for (const bad of [{ requiredCapability: 'console:directory-user:provision' }, { operationCode: 'generic' }, { command: { ...op.command, sourceRevision: 0 } }])
      await assert.rejects(callDirectoryLifecycleProbe({}, { ...op, ...bad }), { statusCode: 403 })
    globalThis.__lifecycleProbe.result.platformStatus = 'private-error-url'
    await assert.rejects(callDirectoryLifecycleProbe({}, op), { statusCode: 502 })
  } finally {
    hooks.deregister()
    delete globalThis.__lifecycleProbe
  }
})
