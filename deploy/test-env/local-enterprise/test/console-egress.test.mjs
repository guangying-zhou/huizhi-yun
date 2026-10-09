import assert from 'node:assert/strict'
import test from 'node:test'
import { request } from 'node:http'
import { createConsoleEgress, allowedConsoleRequest, internalHostRuntimeScopes } from '../console-egress.mjs'
import { generatedSource, projectedScopes, projectedChannels, projectedAimsHostChannels } from '../generate-console-egress-scopes.mjs'
import { hostRuntimeOperations, hostRuntimeScopes, apfServiceChannels } from '../console-egress-scopes.generated.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test('Foundation Host operation projection is current and grants exactly exposed data-runtime scopes', () => {
  assert.equal(readFileSync(fileURLToPath(new URL('../console-egress-scopes.generated.mjs', import.meta.url)), 'utf8'), generatedSource())
  const { operations, scopes, registry } = projectedScopes()
  assert.deepEqual(hostRuntimeOperations, operations)
  assert.deepEqual(hostRuntimeScopes, scopes)
  for (const operation of ['codocs.document-share-create', 'codocs.document-share-mark-read', 'codocs.document-share-delete', 'aims.project-create', 'codocs.collab-document-list', 'codocs.collab-document-list-admin', 'assets.ip-assets-link-product', 'altoc.customer-list', 'altoc.customer-view', 'altoc.contract-list', 'altoc.contract-view', 'altoc.receivable-list', 'altoc.receivable-view']) {
    assert.ok(operations.includes(operation), operation)
  }
  for (const suffix of ['list', 'view', 'owner', 'create', 'summary', 'delete', 'context', 'department-source', 'accessible-list']) assert.ok(operations.includes(`aims.project-document-${suffix}`), suffix)
  assert.ok(projectedScopes().reachedFiles.includes('aims/layer/server/internal/projectDocumentPorts.ts'))
  assert.ok(!projectedScopes().reachedFiles.some(path => path.startsWith('aims/server/api/')))
  for (const scope of ['codocs:collab-documents:read', 'codocs:collab-documents:review-admin']) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), false, scope)
  }
  assert.ok(!operations.includes('codocs.personal-document-collaboration-open'))
  for (const operation of ['collaboration-open', 'snapshot-read', 'snapshot-prepare', 'snapshot-publish', 'versions', 'version-view']) assert.ok(!operations.includes(`codocs.department-documents-${operation}`), operation)
  for (const scope of scopes) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), true, scope)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope: 'assets:enterprise-host:execute', audience: 'tenant-runtime' })), false)
  const navigationRoute = readFileSync(fileURLToPath(new URL('../../../../enterprise/server/routes/enterprise/api/navigation.get.ts', import.meta.url)), 'utf8')
  const policyGate = readFileSync(fileURLToPath(new URL('../../../../enterprise/server/utils/enterprisePolicyGate.ts', import.meta.url)), 'utf8')
  const policyReader = readFileSync(fileURLToPath(new URL('../../../../foundation/server/utils/enterprisePolicyReader.ts', import.meta.url)), 'utf8')
  assert.match(navigationRoute, /requireCurrentEnterprisePolicy\(event, user\)/)
  assert.match(policyGate, /readEnterprisePolicySnapshot\(event,/)
  const internalScopes = [...policyReader.matchAll(/scope: '([^']+)'/g)].map(match => match[1])
  assert.deepEqual([...internalHostRuntimeScopes].sort(), internalScopes.sort())
  assert.ok(operations.includes('console.directory-self-departments'))
  assert.ok(operations.includes('console.directory-self-projects'))
  assert.ok(operations.includes('console.directory-self-accessible-departments'))
  assert.ok(scopes.includes('console:enterprise-host:execute'))
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope: 'console:directory-user:view' })), false)
  for (const scope of internalHostRuntimeScopes) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), true, scope)
  const notExposed = [...new Set([...registry.entries()].filter(([operation]) => !operations.includes(operation)).map(([, scope]) => scope))]
    .filter(scope => !scopes.includes(scope))
  for (const scope of notExposed) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), false, scope)
  for (const scope of ['unknown:object:read', 'aims:products:*', 'aims:projects:view aims:projects:edit']) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), false, scope)
  }
})

const tokenBody = { grant_type: 'client_credentials', client_id: 'enterprise.runtime', app_code: 'enterprise', audience: 'data-runtime', scope: 'aims:enterprise-host:execute', source_binding: 'service-client-policy' }
test('local Workflow tokens have exact identities, audiences and scopes', () => {
  const issue = body => allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(body), { workflowLocal: true })
  const host = { ...tokenBody, audience: 'workflow', scope: 'workflow:proxy' }
  assert.equal(issue(host), true)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(host)), false)
  const worker = { ...tokenBody, client_id: 'workflow.runtime', app_code: 'workflow', audience: 'data-runtime', scope: 'data-runtime:workflow:read' }
  assert.equal(issue(worker), true)
  assert.equal(issue({ ...worker, scope: 'tenant-runtime:workflow:write', audience: 'tenant-runtime' }), true)
  assert.equal(issue({ ...worker, scope: 'workflow.read' }), false)
  assert.equal(issue({ ...worker, scope: 'data-runtime:workflow:work-item-complete:create', audience: 'data-runtime' }), true)
  assert.equal(issue({ ...worker, scope: 'workflow:work-item-complete:create', audience: 'data-runtime' }), false)
  assert.equal(issue({ ...worker, scope: 'console:authorization:subject-eligibility', audience: 'console' }), true)
  assert.equal(issue({ ...worker, scope: 'console:directory-users:read', audience: 'console' }), true)
  assert.equal(issue({ ...worker, scope: 'console:authorization-role-holders:read', audience: 'console' }), true)
  assert.equal(issue({ ...worker, scope: 'workflow:callback', audience: 'aims' }), true)
  const aims = { ...worker, client_id: 'aims.runtime', app_code: 'aims', scope: 'aims:integration_operation:execute' }
  assert.equal(issue({ ...aims, scope: 'aims:work-item-completion-callback:execute', audience: 'data-runtime' }), true)
  assert.equal(issue({ ...aims, scope: 'aims:work-item-completion-callback:execute', audience: 'tenant-runtime' }), false)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...aims, scope: 'aims:work-item-completion-callback:execute' })), false)
  assert.equal(issue(aims), true)
  assert.equal(issue({ ...aims, scope: 'workflow:work-item-complete:create', audience: 'workflow' }), true)
  assert.equal(issue({ ...aims, scope: 'workflow:callback', audience: 'aims' }), false)
  assert.equal(issue({ ...aims, scope: 'aims:integration_operation:execute', audience: 'workflow' }), false)
  // Unified scheduler lanes: exact client app, both Runtime audiences, due reminders off (D4).
  assert.equal(issue({ ...aims, audience: 'tenant-runtime' }), true)
  assert.equal(issue({ ...worker, scope: 'aims:integration_operation:execute', audience: 'tenant-runtime' }), false)
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    assert.equal(issue({ ...aims, scope: 'aims:milestone-rollover:execute', audience }), true)
    assert.equal(issue({ ...worker, scope: 'aims:milestone-rollover:execute', audience }), false)
    assert.equal(issue({ ...worker, scope: 'workflow:integration_operation:execute', audience }), true)
    assert.equal(issue({ ...aims, scope: 'workflow:integration_operation:execute', audience }), false)
    assert.equal(issue({ ...aims, scope: 'aims:notifications-due:execute', audience }), false)
  }
  assert.equal(issue({ ...aims, scope: 'aims:milestone-rollover:execute', audience: 'aims' }), false)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...worker, scope: 'workflow:integration_operation:execute' })), false)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(aims)), false)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...worker, scope: 'notifications:publish', audience: 'notifications' }), { workflowLocal: true, notificationsInAppOnly: true }), true)
  assert.equal(issue({ ...worker, scope: 'notifications:publish', audience: 'notifications' }), false)
  for (const changed of [{ app_code: 'enterprise' }, { client_id: 'enterprise.runtime' }, { scope: 'workflow:admin' }, { audience: 'notifications' }, { source_binding: 'untrusted' }]) {
    assert.equal(issue({ ...worker, ...changed }), false)
  }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(worker)), false)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/runtime/apps/workflow/config', '', { workflowLocal: true }), true)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/runtime/apps/workflow/config'), false)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/runtime/apps/aims/config', '', { workflowLocal: true }), true)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/runtime/apps/aims/config'), false)
  assert.equal(allowedConsoleRequest('POST', '/api/v1/console/runtime/apps/aims/config', '{}', { workflowLocal: true }), false)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/runtime/apps/codocs/config', '', { workflowLocal: true }), false)
})

test('Codocs summary publish egress opens only the Aims runtime exact combination when enabled', () => {
  const body = { grant_type: 'client_credentials', client_id: 'aims.runtime', app_code: 'aims',
    audience: 'codocs', scope: 'codocs:company-weekly-summary:publish', source_binding: 'service-client-policy' }
  const issue = (value, options = {}) => allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(value),
    { workflowLocal: true, companySummaryCodocsDelivery: true, ...options })
  assert.equal(issue(body), true)
  assert.equal(issue(body, { companySummaryCodocsDelivery: false }), false)
  for (const change of [
    { audience: 'data-runtime' }, { scope: 'codocs:company-weekly-summary:admin' },
    { client_id: 'enterprise.runtime' }, { app_code: 'codocs' }, { source_binding: 'untrusted' }
  ]) assert.equal(issue({ ...body, ...change }), false)
})

test('local Codocs OSS config and service tokens require the exact private delivery lane', () => {
  const options = { workflowLocal: true, companySummaryCodocsDelivery: true, codocsSource: true }
  const config = '/api/v1/console/runtime/apps/codocs/config'
  assert.equal(allowedConsoleRequest('GET', config, '', options), true)
  for (const changed of [{ workflowLocal: false }, { companySummaryCodocsDelivery: false }]) {
    assert.equal(allowedConsoleRequest('GET', config, '', { ...options, ...changed }), false)
  }
  assert.equal(allowedConsoleRequest('GET', config, '', { ...options, codocsSource: false }), false)
  for (const [method, path] of [['POST', config], ['GET', `${config}/more`], ['GET', '/api/v1/console/runtime/apps/other/config']]) {
    assert.equal(allowedConsoleRequest(method, path, '', options), false)
  }
  const token = { grant_type: 'client_credentials', client_id: 'codocs.runtime', app_code: 'codocs',
    audience: 'data-runtime', scope: 'integration_config:view', source_binding: 'service-client-policy' }
  const issue = (value, flags = options) => allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(value), flags)
  for (const scope of ['integration_config:view', 'credential_vault:resolve', 'data-runtime:codocs:write']) {
    assert.equal(issue({ ...token, scope }), true, scope)
    assert.equal(issue({ ...token, scope }, { workflowLocal: false, companySummaryCodocsDelivery: true }), false)
    assert.equal(issue({ ...token, scope }, { workflowLocal: true, companySummaryCodocsDelivery: false }), false)
    assert.equal(issue({ ...token, scope }, { ...options, codocsSource: false }), false)
  }
  for (const changed of [
    { client_id: 'enterprise.runtime' }, { app_code: 'enterprise' }, { audience: 'tenant-runtime' },
    { audience: 'console' }, { scope: 'integration_config:edit' }, { scope: 'credential_vault:*' },
    { scope: 'integration_config:view credential_vault:resolve' }, { source_binding: 'untrusted' },
    { deployment: 'C000002-test-codocs' },
    { scope: 'data-runtime:codocs:write', audience: 'tenant-runtime' }, { scope: 'tenant-runtime:codocs:write' },
    { scope: 'codocs:write' }, { scope: 'data-runtime:codocs:read' }, { scope: 'data-runtime:codocs:admin' },
    { scope: 'data-runtime:codocs:write data-runtime:codocs:read' }, { scope: 'data-runtime:codocs:write', client_id: 'aims.runtime' },
    { scope: 'data-runtime:codocs:write', client_secret: 'must-not-be-accepted' }
  ]) assert.equal(issue({ ...token, ...changed }), false, JSON.stringify(changed))
})

test('only the distinct local Codocs egress credential selects Codocs trusted forwarding context', async () => {
  const calls = []
  const server = createConsoleEgress({ localSecret: 'shared-local-credential', codocsLocalSecret: 'codocs-only-credential', remoteSecret: 'remote-gateway-credential',
    workflowLocal: true, companySummaryCodocsDelivery: true,
    fetchImpl: async (_url, init) => { calls.push(init.headers); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const body = { grant_type: 'client_credentials', client_id: 'codocs.runtime', app_code: 'codocs',
    audience: 'data-runtime', scope: 'integration_config:view', source_binding: 'service-client-policy' }
  const post = (credential, value = body, extra = {}) => fetch(`${base}/oauth/token`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hzy0-egress-token': credential,
      'x-hzy-app-code': 'codocs', 'x-hzy-deployment': 'C000001-test-codocs', ...extra }, body: JSON.stringify(value) })
  try {
    assert.equal((await post('codocs-only-credential', body, { 'x-hzy-app-code': 'enterprise', 'x-hzy-deployment': 'C000002-test-codocs' })).status, 200)
    assert.equal(calls[0].get('x-hzy-app-code'), 'codocs')
    assert.equal(calls[0].get('x-hzy-deployment'), 'C000001-test-codocs')
    assert.equal(calls[0].get('x-hzy-tenant'), 'C000001')
    assert.equal(calls[0].has('x-hzy0-egress-token'), false)
    assert.equal((await post('shared-local-credential')).status, 403)
    assert.equal((await post('forged-codocs-only-credential')).status, 401)
    for (const changed of [{ client_id: 'enterprise.runtime' }, { app_code: 'enterprise' },
      { audience: 'tenant-runtime' }, { deployment: 'C000002-test-codocs' }]) {
      assert.equal((await post('codocs-only-credential', { ...body, ...changed })).status, 403)
    }
    assert.equal((await fetch(`${base}/api/v1/console/auth/me`, { headers: { 'x-hzy0-egress-token': 'codocs-only-credential' } })).status, 403)
    assert.equal((await post('shared-local-credential', { ...tokenBody, scope: 'console:policy-bundle:read' })).status, 200)
    assert.equal(calls[1].get('x-hzy-app-code'), 'enterprise')
    assert.equal(calls[1].get('x-hzy-deployment'), 'C000001-test-enterprise')
    assert.equal(calls.length, 2)
  } finally { server.close() }
})

test('local Workflow eligibility egress accepts only bound task decisions', () => {
  const path = '/api/v1/console/service/authorization/subject-eligibility'
  const allowed = body => allowedConsoleRequest('POST', path, JSON.stringify(body), { workflowLocal: true })
  assert.equal(allowed({ subjectUid: 'test', purpose: 'task_approve' }), true)
  assert.equal(allowed({ subjectUid: 'test', purpose: 'task_reject' }), true)
  assert.equal(allowedConsoleRequest('POST', path, JSON.stringify({ subjectUid: 'test', purpose: 'task_approve' })), false)
  for (const body of [{ subjectUid: '@all', purpose: 'task_approve' }, { subjectUid: 'system', purpose: 'task_approve' },
    { subjectUid: 'test', purpose: 'task_approve', action: 'admin' }, { subjectUid: 'test', purpose: 'instance_status' }]) {
    assert.equal(allowed(body), false)
  }
  assert.equal(allowedConsoleRequest('GET', path, '', { workflowLocal: true }), false)
})

test('local Workflow notification eligibility purposes need in-app-only notifications', () => {
  const path = '/api/v1/console/service/authorization/subject-eligibility'
  const request = (purpose, options) => allowedConsoleRequest('POST', path, JSON.stringify({ subjectUid: 'test', purpose }), options)
  for (const purpose of ['task_actionable', 'instance_actionable', 'instance_status']) {
    assert.equal(request(purpose, { workflowLocal: true, notificationsInAppOnly: true }), true)
    assert.equal(request(purpose, { workflowLocal: true }), false)
    assert.equal(request(purpose, { notificationsInAppOnly: true }), false)
  }
  assert.equal(request('task_admin', { workflowLocal: true, notificationsInAppOnly: true }), false)
  assert.equal(allowedConsoleRequest('POST', path, JSON.stringify({ subjectUid: '@all', purpose: 'task_actionable' }), { workflowLocal: true, notificationsInAppOnly: true }), false)
})
test('verified Enterprise policy reader uses only the exact data-runtime read scope', () => {
  const policyRead = { ...tokenBody, scope: 'console:policy-bundle:read' }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(policyRead)), true)
  for (const changed of [
    { audience: 'console' }, { audience: 'tenant-runtime' },
    { scope: 'console:policy-bundle:write' }, { scope: 'console:policy-bundle:*' },
    { scope: 'console:policy-bundle:read console:policy-bundle:write' },
    { client_id: 'codocs.runtime' }, { app_code: 'codocs' },
    { source_binding: 'untrusted' }
  ]) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...policyRead, ...changed })), false)
})

test('local Workflow service introspection requires one JWT token field', () => {
  const token = 'header.payload.signature'
  assert.equal(allowedConsoleRequest('POST', '/oauth/introspect', `token=${token}`, { workflowLocal: true }), true)
  for (const [method, path, body, options] of [
    ['POST', '/oauth/introspect', `token=${token}`, {}],
    ['GET', '/oauth/introspect', `token=${token}`, { workflowLocal: true }],
    ['POST', '/oauth/introspect/', `token=${token}`, { workflowLocal: true }],
    ['POST', '/oauth/introspect', `token=${token}&token=${token}`, { workflowLocal: true }],
    ['POST', '/oauth/introspect', `token=${token}&client_id=workflow.runtime`, { workflowLocal: true }],
    ['POST', '/oauth/introspect', 'token=plain', { workflowLocal: true }],
    ['POST', '/oauth/introspect', `token=${'x'.repeat(8193)}`, { workflowLocal: true }]
  ]) assert.equal(allowedConsoleRequest(method, path, body, options), false)
})
test('egress permits exact Enterprise reads and rejects writes or identity overrides', () => {
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(tokenBody)), true)
  for (const changed of [{ client_id: 'console.runtime' }, { app_code: 'aims' }, { scope: 'aims:products:edit' }, { audience: 'tenant-runtime' }, { deployment: 'other' }, { scope: 'aims:enterprise-host:execute aims:projects:view' }]) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, ...changed })), false)
  }
  assert.equal(allowedConsoleRequest('POST', '/api/v1/console/service/business-domains', '{}'), false)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/vault'), false)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/auth/me'), true)
  assert.equal(allowedConsoleRequest('POST', '/api/v1/console/auth/me'), false)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/auth/me/../vault'), false)
})

test('user notification egress allows only exact list, summary and item methods', () => {
  const item = '/api/v1/console/notifications/notif_123'
  for (const path of ['/api/v1/console/notifications', '/api/v1/console/notifications/summary', `${item}/detail`]) {
    assert.equal(allowedConsoleRequest('GET', path), true, path)
    assert.equal(allowedConsoleRequest('POST', path, '{}'), false, `${path} POST`)
  }
  for (const path of ['/api/v1/console/notifications/read-all', `${item}/read`, `${item}/archive`]) {
    assert.equal(allowedConsoleRequest('POST', path, '{}'), true, path)
    assert.equal(allowedConsoleRequest('GET', path), false, `${path} GET`)
  }
  for (const path of ['/api/v1/console/notifications/admin', `${item}/delete`, `${item}/read/extra`,
    '/api/v1/console/notifications/notif%2f123/detail', '/api/v1/console/notifications/other/summary']) {
    assert.equal(allowedConsoleRequest('GET', path), false, path)
    assert.equal(allowedConsoleRequest('POST', path, '{}'), false, `${path} POST`)
  }
})

test('approved product write retains exact scope, audience and identity restrictions', () => {
  const approved = { ...tokenBody, scope: 'assets:enterprise-host:execute' }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, scope: 'codocs:document-shares:create' })), false)
  for (const changed of [
    { audience: 'console' }, { audience: 'tenant-runtime' },
    { scope: 'assets:product:admin' }, { scope: 'codocs:personal-documents:admin' },
    { scope: 'assets:enterprise-host:execute assets:product:read' },
    { client_id: 'assets.runtime' }, { app_code: 'assets' },
    { source_binding: 'untrusted' }, { tenant: 'other' }, { deployment: 'other' }
  ]) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, ...changed })), false)
})

test('FE-2 writes allow only their exact data-runtime capabilities', () => {
  for (const scope of [
    'aims:product-requests:create',
    'aims:product-requests:decide',
    'aims:product-versions:create',
    'aims:product-versions:edit',
    'aims:product-priorities:project-authorization',
    'aims:product-priorities:handoff'
  ]) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), false, scope)
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope: 'aims:enterprise-host:execute' })), true)
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope, audience: 'console' })), false, `${scope} audience`)
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope, client_id: 'aims.runtime' })), false, `${scope} client`)
  }
  for (const scope of ['aims:product-requests:delete', 'aims:product-priorities:admin']) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), false, scope)
  }
})

test('follow-up 7 association scopes require exact Enterprise identity and data-runtime audience', () => {
  for (const scope of ['aims:product-documents:create', 'aims:project-products:read', 'aims:project-products:create']) {
    const approved = { ...tokenBody, scope: 'aims:enterprise-host:execute' }
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true, scope)
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, scope })), false, scope)
    for (const changed of [
      { audience: 'console' }, { audience: 'tenant-runtime' }, { client_id: 'aims.runtime' },
      { app_code: 'aims' }, { scope: `aims:enterprise-host:execute ${scope}` }, { scope: 'aims:project-products:*' }
    ]) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, ...changed })), false, `${scope} rejected`)
  }
})

test('approved product and document operations include only their exact transitive service capabilities', () => {
  for (const scope of [
    'aims:products:authorization-object',
    'codocs:personal-documents:create',
    'codocs:personal-documents:edit',
    'codocs:personal-documents:delete',
    'codocs:personal-documents:export',
    'integration_config:view',
    'credential_vault:resolve'
  ]) {
    // Storage integration scopes remain a separate existing channel; precise
    // Host route scopes are replaced by the domain transport grant.
    const integration = scope === 'integration_config:view' || scope === 'credential_vault:resolve'
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), integration, scope)
    if (!integration) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope: scope.startsWith('codocs:') ? 'codocs:enterprise-host:execute' : 'aims:enterprise-host:execute' })), true)
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope, audience: 'console' })), false, `${scope} audience`)
  }
  for (const scope of ['aims:products:*', 'credential_vault:*', 'integration_config:edit', 'codocs:document-access-records:record']) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), false, scope)
  }
})

test('Codocs owner share creation permits only the existing exact Runtime capability', () => {
  const approved = { ...tokenBody, scope: 'codocs:enterprise-host:execute' }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, scope: 'codocs:document-shares:mark-read' })), false)
  for (const changed of [
    { audience: 'console' }, { client_id: 'codocs.runtime' }, { app_code: 'codocs' },
    { scope: 'codocs:document-shares:*' }, { scope: 'codocs:document-shares:create codocs:document-shares:read' }
  ]) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, ...changed })), false)
})

test('Codocs recipient mark-read permits only the exact data-runtime capability', () => {
  const approved = { ...tokenBody, scope: 'codocs:enterprise-host:execute' }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true)
  for (const changed of [
    { audience: 'console' }, { client_id: 'codocs.runtime' }, { app_code: 'codocs' },
    { scope: 'codocs:document-shares:admin' },
    { scope: 'codocs:document-shares:*' }, { scope: 'codocs:document-shares:mark-read codocs:document-shares:create' }
  ]) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, ...changed })), false)
})

test('Codocs owner cleanup permits exact share and personal document delete scopes only', () => {
  for (const scope of ['codocs:document-shares:delete', 'codocs:personal-documents:delete']) {
    const approved = { ...tokenBody, scope: 'codocs:enterprise-host:execute' }
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true, scope)
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, scope })), false, scope)
    for (const changed of [
      { audience: 'console' }, { client_id: 'codocs.runtime' }, { app_code: 'codocs' },
      { scope: `codocs:enterprise-host:execute ${scope}` }, { scope: 'codocs:document-shares:*' }
    ]) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, ...changed })), false)
  }
})

test('hzy0 notification mode opens only exact publish scope and in-app payload', () => {
  const mode = { notificationsInAppOnly: true }
  const token = { ...tokenBody, audience: 'notifications', scope: 'notifications:publish' }
  const path = '/api/v1/console/notifications/publish'
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(token)), false)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(token), mode), true)
  assert.equal(allowedConsoleRequest('POST', path, JSON.stringify({ channels: ['in_app'] })), false)
  assert.equal(allowedConsoleRequest('POST', path, JSON.stringify({ channels: ['in_app'] }), mode), true)
  for (const body of [
    '{}', '{', '[]', JSON.stringify({ channels: ['wecom'] }),
    JSON.stringify({ channels: ['in_app', 'wecom'] }),
    JSON.stringify({ channels: ['in_app', 'dingtalk'] })
  ]) assert.equal(allowedConsoleRequest('POST', path, body, mode), false)
  for (const changed of [
    { audience: 'console' }, { audience: 'data-runtime' }, { scope: 'notifications:send' },
    { scope: 'notifications:publish notifications:read' }, { client_id: 'codocs.runtime' },
    { app_code: 'codocs' }, { source_binding: 'untrusted' }
  ]) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...token, ...changed }), mode), false)
  assert.equal(allowedConsoleRequest('POST', '/v1/notifications/send', JSON.stringify({ channel: 'wecom' }), mode), false)
})

test('local Workflow actionable lifecycle needs both switches, exact service identity and fixed body', async () => {
  const path = '/api/v1/console/notifications/actionable-lifecycle'
  const claims = {
    token_use: 'service', sub: 'client:workflow.runtime', client_id: 'workflow.runtime',
    source_app: 'workflow', target_app: 'notifications', aud: 'notifications',
    scope: 'notifications:publish', tenant: 'C000001', deployment: 'C000001-test-workflow-local',
    hzy: { appCode: 'workflow' }
  }
  const bearer = value => `Bearer a.${Buffer.from(JSON.stringify(value)).toString('base64url')}.sig`
  const body = JSON.stringify({ sourceAppCode: 'workflow', actionableKey: 'task:1',
    expectedVersion: '1', nextVersion: '2', state: 'resolved', recipients: ['test'] })
  const mode = { workflowLocal: true, notificationsInAppOnly: true, authorization: bearer(claims) }
  assert.equal(allowedConsoleRequest('POST', path, body, mode), true)
  assert.equal(allowedConsoleRequest('POST', path, body, { ...mode, workflowLocal: false }), false)
  assert.equal(allowedConsoleRequest('POST', path, body, { ...mode, notificationsInAppOnly: false }), false)
  assert.equal(allowedConsoleRequest('GET', path, body, mode), false)
  assert.equal(allowedConsoleRequest('POST', path + '/', body, mode), false)
  for (const changed of [{ client_id: 'enterprise.runtime' }, { source_app: 'enterprise' },
    { deployment: 'other' }, { aud: 'console' }, { scope: 'notifications:send' }]) {
    assert.equal(allowedConsoleRequest('POST', path, body, { ...mode, authorization: bearer({ ...claims, ...changed }) }), false)
  }
  for (const changed of [{ sourceAppCode: 'enterprise' }, { state: 'published' }, { recipients: [] },
    { channels: ['wecom'] }, { nextVersion: '1' }]) {
    assert.equal(allowedConsoleRequest('POST', path, JSON.stringify({ ...JSON.parse(body), ...changed }), mode), false)
  }
  const calls = []
  const server = createConsoleEgress({ localSecret: 'local-fixture', remoteSecret: 'remote-fixture',
    workflowLocal: true, notificationsInAppOnly: true,
    fetchImpl: async (url) => {
      calls.push(url.pathname)
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { authorization: mode.authorization, 'x-hzy0-egress-token': 'local-fixture',
        'content-type': 'application/json' }, body
    })
    assert.equal(response.status, 200)
    assert.deepEqual(calls, [path])
  } finally { server.close() }
})

test('hzy0 notification egress never forwards an external-channel publish', async () => {
  const calls = []
  const server = createConsoleEgress({
    localSecret: 'local-fixture', remoteSecret: 'remote-fixture', notificationsInAppOnly: true,
    fetchImpl: async (url, init) => {
      calls.push({ path: url.pathname, body: init.body })
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (path, body) => fetch(base + path, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hzy0-egress-token': 'local-fixture' },
    body: JSON.stringify(body) })
  try {
    const path = '/api/v1/console/notifications/publish'
    assert.equal((await post(path, { channels: ['in_app', 'wecom'] })).status, 403)
    assert.equal((await post(path, { channels: ['in_app', 'dingtalk'] })).status, 403)
    assert.equal(calls.length, 0)
    assert.equal((await post(path, { channels: ['in_app'] })).status, 200)
    assert.deepEqual(calls, [{ path, body: JSON.stringify({ channels: ['in_app'] }) }])
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('authenticated loopback transport pins remote origin/context', async () => {
  const calls = []
  const server = createConsoleEgress({ localSecret: 'local-fixture', remoteSecret: 'remote-fixture', fetchImpl: async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ access_token: 'fixture-access' }), { headers: { 'content-type': 'application/json' } })
  } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const call = (path, key, body = JSON.stringify(tokenBody)) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'x-hzy0-egress-token': key, 'x-hzy-tenant': 'forged', 'x-hzy-gateway-token': 'forged', 'x-forwarded-host': 'evil.test', 'x-request-id': 'safe_trace_1' } }, res => {
      let body = ''; res.on('data', c => { body += c }); res.on('end', () => resolve({ status: res.statusCode, body }))
    }); req.on('error', reject); req.end(body)
  })
  try {
    for (const key of ['', 'wrong']) assert.equal((await call('/oauth/token', key)).status, 401)
    for (const path of ['https://evil.test/oauth/token', '//evil.test/oauth/token', '/api/v1/console/vault', '/%6fauth/token']) assert.equal((await call(path, 'local-fixture')).status, 403)
    assert.equal(calls.length, 0)
    assert.equal((await call('/oauth/token', 'local-fixture')).status, 200)
    assert.equal(calls[0].url.origin, 'https://hzy-test.huizhi.yun')
    assert.equal(calls[0].init.redirect, 'error')
    assert.equal(calls[0].init.headers.get('x-hzy-gateway-token'), 'remote-fixture')
    assert.equal(calls[0].init.headers.get('x-hzy-tenant'), 'C000001')
    assert.equal(calls[0].init.headers.has('x-hzy0-egress-token'), false)
    assert.equal(calls[0].init.headers.has('x-forwarded-host'), false)
    assert.equal(calls[0].init.headers.get('x-request-id'), 'safe_trace_1')
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('upstream diagnostic bodies and headers are never relayed', async () => {
  const server = createConsoleEgress({ localSecret: 'local-fixture', remoteSecret: 'remote-fixture', fetchImpl: async () =>
    new Response('remote-fixture', { status: 403, headers: { 'x-secret': 'remote-fixture' } }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/oauth/userinfo`, { headers: { 'x-hzy0-egress-token': 'local-fixture' } })
    assert.equal(response.status, 403)
    assert.equal(response.headers.has('x-secret'), false)
    assert.doesNotMatch(await response.text(), /remote-fixture/)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('local allowlist denials return a stable safe code and correlation id', async () => {
  const server = createConsoleEgress({ localSecret: 'local-fixture', remoteSecret: 'remote-fixture', fetchImpl: async () => { throw Error('must not forward') } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hzy0-egress-token': 'local-fixture' },
      body: JSON.stringify({ ...tokenBody, scope: 'credential_vault:*' })
    })
    const body = await response.json()
    assert.equal(response.status, 403)
    assert.equal(body.code, 'hzy0_console_egress_denied')
    assert.match(body.correlationId, /^[0-9a-f-]{36}$/i)
    assert.equal(response.headers.get('x-request-id'), body.correlationId)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('allowlist denial logs underscore scopes but never wildcard scopes', async () => {
  const server = createConsoleEgress({ localSecret: 'local-fixture', remoteSecret: 'remote-fixture', fetchImpl: async () => { throw Error('must not forward') } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const logged = []
  const originalError = console.error
  console.error = (line) => { logged.push(JSON.parse(line)) }
  try {
    for (const scope of ['workflow:integration_operation:execute', 'credential_vault:*']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/oauth/token`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-hzy0-egress-token': 'local-fixture' },
        body: JSON.stringify({ ...tokenBody, client_id: 'workflow.runtime', app_code: 'workflow', scope })
      })
      assert.equal(response.status, 403)
      await response.body?.cancel()
    }
  } finally {
    console.error = originalError
    await new Promise(resolve => server.close(resolve))
  }
  const denials = logged.filter(entry => entry.stage === 'allowlist')
  assert.equal(denials.length, 2)
  assert.equal(denials[0].scope, 'workflow:integration_operation:execute')
  assert.equal(denials[0].audience, 'data-runtime')
  assert.equal('scope' in denials[1], false)
})

test('user application list is a read-only egress path', () => {
  for (const path of ['/api/v1/console/user/applications', '/api/user/applications']) {
    assert.equal(allowedConsoleRequest('GET', path, ''), true)
    assert.equal(allowedConsoleRequest('POST', path, '{}'), false)
  }
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/user/applications/admin', ''), false)
})

test('Enterprise may request exact local Aims project-document tokens only with local Aims', () => {
  const scopes = ['aims:project-documents:read', 'aims:project-documents:write', 'aims:project-documents:download',
    'aims:project-document-sources:read', 'aims:project-document-access:read', 'aims:project-document-access:manage']
  const request = (changes, options = { workflowLocal: true }) => allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({
    grant_type: 'client_credentials', client_id: 'enterprise.runtime', app_code: 'enterprise', audience: 'aims',
    source_binding: 'trusted-gateway', ...changes
  }), options)
  for (const scope of scopes) {
    assert.equal(request({ scope }), true)
    assert.equal(request({ scope }, {}), false)
    assert.equal(request({ scope, audience: 'data-runtime' }), false)
    assert.equal(request({ scope, client_id: 'workflow.runtime', app_code: 'workflow' }), false)
  }
  for (const scope of ['aims:projects:admin', 'aims:project-documents:delete', 'aims:read']) assert.equal(request({ scope }), false)
})


test('local Aims document subject authorization stays exact and gated', () => {
  const path = '/api/v1/console/service/authorization/subject-scoped'
  const request = { subjectUid: 'person-a', purpose: 'enterprise_accessible_project_documents_list' }
  assert.equal(allowedConsoleRequest('POST', path, JSON.stringify(request), { workflowLocal: true }), true)
  assert.equal(allowedConsoleRequest('POST', path, JSON.stringify(request)), false)
  for (const changed of [{ purpose: 'task_approve' }, { purpose: 'unknown' }, { subjectUid: '@all' }, { subjectUid: 'system' }, { action: 'admin' }]) {
    assert.equal(allowedConsoleRequest('POST', path, JSON.stringify({ ...request, ...changed }), { workflowLocal: true }), false)
  }
  assert.equal(allowedConsoleRequest('GET', path, '', { workflowLocal: true }), false)
  const token = { grant_type: 'client_credentials', client_id: 'aims.runtime', app_code: 'aims', audience: 'console', scope: 'console:subject-authorization:read', source_binding: 'trusted-gateway' }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(token), { workflowLocal: true }), true)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(token)), false)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...token, scope: 'console:subject-authorization:admin' }), { workflowLocal: true }), false)
})

test('user notification writes forward a well-formed idempotency key on POST only', async () => {
  const seen = []
  const server = createConsoleEgress({ localSecret: 'local-fixture', remoteSecret: 'remote-fixture',
    fetchImpl: async (url, init) => {
      seen.push({ path: url.pathname, key: new Headers(init.headers).get('idempotency-key') })
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const send = (path, method, key) => fetch(base + path, { method,
    headers: { 'x-hzy0-egress-token': 'local-fixture', 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}) })
  try {
    const read = '/api/v1/console/notifications/notif_1/read'
    assert.equal((await send(read, 'POST', 'foundation:notification:1b2c-3d')).status, 200)
    assert.equal((await send('/api/v1/console/notifications/read-all', 'POST', 'notification:read-all:9')).status, 200)
    assert.equal((await send(read, 'POST', 'bad key with spaces')).status, 200)
    assert.equal((await send('/api/v1/console/notifications', 'GET', 'foundation:notification:x')).status, 200)
    assert.deepEqual(seen.map(item => item.key), ['foundation:notification:1b2c-3d', 'notification:read-all:9', null, null])
  } finally { await new Promise(resolve => server.close(resolve)) }
})


test('local Aims project-document facts accept only the two exact read audience pairs', () => {
  const pairs = [['console:directory-users:read', 'console'], ['data-runtime:aims:read', 'data-runtime']]
  for (const [scope, audience] of pairs) {
    const token = { grant_type: 'client_credentials', client_id: 'aims.runtime', app_code: 'aims', audience, scope, source_binding: 'trusted-gateway' }
    const send = (changes = {}, options = { workflowLocal: true }) => allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...token, ...changes }), options)
    assert.equal(send(), true)
    assert.equal(send({ source_binding: 'service-client-policy' }), true)
    assert.equal(send({}, {}), false)
    assert.equal(send({}, { workflowLocal: false }), false)
    for (const client_id of ['other.runtime', 'assets.runtime', 'enterprise.runtime']) assert.equal(send({ client_id }), false)
    for (const app_code of ['enterprise', 'assets', 'workflow']) assert.equal(send({ app_code }), false)
    for (const other of ['console', 'data-runtime', 'tenant-runtime', 'aims', 'codocs', 'notifications'].filter(value => value !== audience)) assert.equal(send({ audience: other }), false)
    assert.equal(send({ scope: scope.replace(/:read$/, ':write') }), false)
    assert.equal(send({ scope: scope + ' extra' }), false)
    assert.equal(send({ source_binding: 'arbitrary' }), false)
  }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, audience: 'data-runtime', scope: 'data-runtime:aims:read' }), { workflowLocal: true }), false, 'new legacy Aims read does not expand Enterprise identity')
})


test('local Aims document reads retain exact combined capability and fixed admin projection purpose', () => {
  const scope = 'data-runtime:aims:project-documents:read data-runtime:aims:read'
  const body = { grant_type: 'client_credentials', client_id: 'aims.runtime', app_code: 'aims', audience: 'data-runtime', scope, source_binding: 'service-client-policy' }
  const send = (changes = {}, flags = { workflowLocal: true }) => allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...body, ...changes }), flags)
  assert.equal(send(), true)
  assert.equal(send({}, {}), false)
  for (const changes of [{ scope: 'data-runtime:aims:project-documents:read' }, { scope: scope + ' extra' },
    { scope: scope.replace('project-documents:read', 'project-documents:write') },
    { scope: 'data-runtime:aims:read data-runtime:aims:project-documents:read' },
    { audience: 'tenant-runtime' }, { audience: 'console' }, { client_id: 'enterprise.runtime' },
    { client_id: 'workflow.runtime' }, { app_code: 'enterprise' }]) assert.equal(send(changes), false)
  // The base read was separately approved for project relationship facts.
  assert.equal(send({ scope: 'data-runtime:aims:read' }), true)
  const path = '/api/v1/console/service/authorization/subject-scoped'
  const purpose = { subjectUid: 'person-a', purpose: 'enterprise_project_admin' }
  assert.equal(allowedConsoleRequest('POST', path, JSON.stringify(purpose), { workflowLocal: true }), true)
  assert.equal(allowedConsoleRequest('POST', path, JSON.stringify(purpose)), false)
  for (const change of [{ action: 'admin' }, { resourceCode: 'projects' }, { purpose: 'enterprise_project_admin_all' }]) assert.equal(allowedConsoleRequest('POST', path, JSON.stringify({ ...purpose, ...change }), { workflowLocal: true }), false)
})

test('native accessible read uses exact projected Enterprise Runtime scope without broadening Aims service scopes', () => {
  const base = { grant_type: 'client_credentials', client_id: 'enterprise.runtime', app_code: 'enterprise', audience: 'data-runtime', scope: 'aims:enterprise-host:execute', source_binding: 'service-client-policy' }
  const issue = (body, options = {}) => allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(body), options)
  assert.equal(issue(base), true)
  assert.equal(issue({ ...base, audience: 'aims' }), false)
  assert.equal(issue({ ...base, audience: 'aims' }, { workflowLocal: true }), false)
  for (const changed of [{ audience: 'tenant-runtime' }, { audience: 'codocs' }, { client_id: 'aims.runtime', app_code: 'aims' }, { scope: 'aims:project-documents:write' }, { scope: 'aims:project-document-access:manage' }]) {
    assert.equal(issue({ ...base, ...changed }, { workflowLocal: true }), false)
  }
})

test('registered Console user APIs pass the egress; unregistered paths and methods do not', () => {
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/notifications/todos', ''), true)
  assert.equal(allowedConsoleRequest('POST', '/api/v1/console/notifications/todos', '{}'), false)
  // Console administration is no longer composed into the Host (ADR-018a D8).
  for (const path of ['/api/v1/console/profile', '/api/v1/console/work-calendars', '/api/v1/console/directory/sync-jobs']) assert.equal(allowedConsoleRequest('GET', path, ''), false)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/profile/secrets', ''), false)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/vault/secrets', ''), false)
  assert.equal(allowedConsoleRequest('PUT', '/api/v1/console/directory/departments/D1', ''), false)
})


test('APF service channels match registries and reject broad or mismatched grants', () => {
  assert.deepEqual(apfServiceChannels, projectedChannels())
  assert.equal(apfServiceChannels.length, 24)
  const allowed = data => allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(data), { workflowLocal: true })
  for (const channel of apfServiceChannels) {
    assert.match(channel.scope, /^[a-z]+:[a-z-]+:[a-z-]+$|^workflow:proxy$/)
    assert.ok(!channel.scope.includes('*'))
    const body = { ...tokenBody, client_id: channel.clientId, app_code: channel.app, audience: channel.audience, scope: channel.scope }
    assert.equal(allowed(body), true, JSON.stringify(channel))
    for (const patch of [{ client_id: 'foreign.runtime' }, { app_code: 'foreign' }, { audience: 'foreign' }, { scope: `${channel.app}:*` }, { scope: channel.app }, { source_binding: 'browser' }, { scope: `${channel.scope} foreign:write` }]) {
      assert.equal(allowed({ ...body, ...patch }), false, JSON.stringify(patch))
    }
    if (channel.workflowLocal) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(body)), false)
  }
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    assert.equal(allowed({ ...tokenBody, audience, scope: 'altoc:enterprise-host:execute finance:enterprise-host:execute people:enterprise-host:execute' }), true)
    assert.equal(allowed({ ...tokenBody, audience, scope: 'finance:enterprise-host:execute finance:scheduler:execute' }), false)
    assert.equal(allowed({ ...tokenBody, audience, scope: 'finance:scheduler:execute finance:scheduler:execute' }), false)
    assert.equal(allowed({ ...tokenBody, audience, scope: 'finance:enterprise-host:*' }), false)
  }
})


test('People recovery egress registers only exact read-only lifecycle probes', () => {
  for (const endpoint of ['employment-status', 'lifecycle-command-status']) {
    const path = `/api/v1/console/service/directory/onboarding/${endpoint}`
    assert.equal(allowedConsoleRequest('GET', path), true)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(allowedConsoleRequest(method, path, '{}'), false)
    for (const extra of ['/child', '-replay', '/..']) assert.equal(allowedConsoleRequest('GET', path + extra), false)
  }
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/service/directory/onboarding'), false)
})

test('Aims Host scheduler egress is exact, dual-audience and cannot borrow identity or broaden scope', () => {
  const rows = projectedAimsHostChannels()
  assert.equal(rows.length, 13)
  for (const row of rows) {
    const body = { grant_type: 'client_credentials', client_id: row.clientId, app_code: row.app, audience: row.audience, scope: row.scope, source_binding: 'service-client-policy' }
    const allow = value => allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(value), { workflowLocal: true, notificationsInAppOnly: true })
    assert.equal(allow(body), true, JSON.stringify(row))
    assert.equal(allow({ ...body, app_code: 'people', client_id: 'people.runtime' }), false)
    assert.equal(allow({ ...body, audience: 'wrong' }), false)
    assert.equal(allow({ ...body, scope: row.scope + ' aims:write' }), false)
    assert.equal(allow({ ...body, scope: 'aims:scheduler:execute' }), ['data-runtime', 'tenant-runtime'].includes(row.audience))
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(body), { workflowLocal: false }), false)
    assert.equal(allow({ ...body, scope: 'aims:*' }), false)
  }
})

test('feedback Console U permits only the reviewed Enterprise tenant-runtime tuple', () => {
  const body = { grant_type: 'client_credentials', client_id: 'enterprise.runtime', app_code: 'enterprise', audience: 'tenant-runtime', scope: 'console:enterprise-host:execute', source_binding: 'service-client-policy' }
  const allowed = (value, features = { workflowLocal: true }) => allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(value), features)
  assert.equal(allowed(body), true)
  assert.equal(allowed(body, { workflowLocal: false }), false)
  for (const change of [{ client_id: 'console.runtime' }, { app_code: 'console' }, { audience: 'console' }, { scope: 'assets:enterprise-host:execute' }, { source_binding: 'unknown' }, { grant_type: 'password' }, { deployment: 'forged' }]) assert.equal(allowed({ ...body, ...change }), false)
  assert.equal(allowed({ ...body, audience: 'data-runtime' }), true)
})
