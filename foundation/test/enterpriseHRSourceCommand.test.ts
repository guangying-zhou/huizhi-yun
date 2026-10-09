import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { enterpriseAPFPermitCanonical } from '../server/utils/enterpriseAPFPermit'

const mocks = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/enterpriseHRSourceCommand.ts') && specifier.startsWith('./')) {
    const code = specifier === './serviceAppUrl' ? 'export const resolveTrustedServiceAppRoute=()=>null' : specifier === './serviceOidc' ? 'export const requestWithServiceAccessToken=()=>{};export const fetchConsoleServiceJson=()=>{};export const trustedServiceRequestHeaders=()=>{}' : 'export const buildServiceCommandRuntimeHeaders=()=>{};export const hashServiceCommandPayload=()=>{}'
    return { url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true }
  }
  return next(specifier, context)
} })
const { validateHRSourceClaims, hrSourcePath } = await import('../server/utils/enterpriseHRSourceCommand')
mocks.deregister()
const claims = { token_use: 'service', source_app: 'enterprise', hzy: { appCode: 'enterprise', clientCode: 'enterprise.runtime' }, client_id: 'enterprise.runtime', aud: 'console', target_app: 'console', tenant: 'C000001', deployment: 'Host', scope: 'console:hr-source-sync:admin' }
const token = (c: unknown) => 'e30.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.signature'
test('HR source fresh identity is Enterprise, never legacy People or a body claim', () => {
  validateHRSourceClaims(token(claims), claims.scope, 'C000001', 'Host')
  for (const [k, value] of Object.entries({ token_use: 'user', source_app: 'people', client_id: 'people.runtime', target_app: 'people', aud: 'data-runtime', tenant: 'other', deployment: 'other', scope: 'console:read' })) assert.throws(() => validateHRSourceClaims(token({ ...claims, [k]: value }), claims.scope, 'C000001', 'Host'), { statusCode: 403 }, k)
  assert.throws(() => validateHRSourceClaims(token({ ...claims, hzy: { appCode: 'people', clientCode: 'enterprise.runtime' } }), claims.scope, 'C000001', 'Host'), { statusCode: 403 })
  assert.equal(hrSourcePath('jobs-retry', { jobId: 'crj_abcdefghijklmnopqrst' }), '/api/v1/console/service/connector-runtime/people-sync-jobs/crj_abcdefghijklmnopqrst/retry')
  for (const jobId of ['../job', '/x', 'x/y', '']) assert.throws(() => hrSourcePath('jobs-retry', { jobId }), { statusCode: 400 })
})
test('HR TS/Go golden freezes nested command, source object, action, actor and version', () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/enterprise-people-hr-source-permit.json', import.meta.url), 'utf8'))
  assert.equal(enterpriseAPFPermitCanonical(f.method, f.target, f.body), f.canonical)
  for (const [k, value] of Object.entries({ actorUid: 'other', resource: 'employees', action: 'view', deployment: 'other', operation: 'hr-jobs-start-prepare', objectId: 'fake|', expiresAt: 0 })) {
    const c = structuredClone(f.body)
    c.authorization[k] = value
    assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, c), f.canonical)
  }
  const c = structuredClone(f.body)
  c.peopleFacts.payload.command.mappings[0].canonicalDeptCode = 'Other'
  assert.notEqual(enterpriseAPFPermitCanonical(f.method, f.target, c), f.canonical)
})
