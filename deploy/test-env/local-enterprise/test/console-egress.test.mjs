import assert from 'node:assert/strict'
import test from 'node:test'
import { request } from 'node:http'
import { createConsoleEgress, allowedConsoleRequest, internalHostRuntimeScopes } from '../console-egress.mjs'
import { generatedSource, projectedScopes } from '../generate-console-egress-scopes.mjs'
import { hostRuntimeOperations, hostRuntimeScopes } from '../console-egress-scopes.generated.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test('Foundation Host operation projection is current and grants exactly exposed data-runtime scopes', () => {
  assert.equal(readFileSync(fileURLToPath(new URL('../console-egress-scopes.generated.mjs', import.meta.url)), 'utf8'), generatedSource())
  const { operations, scopes, registry } = projectedScopes()
  assert.deepEqual(hostRuntimeOperations, operations)
  assert.deepEqual(hostRuntimeScopes, scopes)
  for (const operation of ['codocs.document-share-create', 'codocs.document-share-mark-read', 'codocs.document-share-delete', 'aims.project-create', 'codocs.collab-document-list', 'codocs.collab-document-list-admin', 'assets.ip-assets-link-product']) {
    assert.ok(operations.includes(operation), operation)
  }
  for (const scope of ['codocs:collab-documents:read', 'codocs:collab-documents:review-admin']) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), true, scope)
  }
  assert.ok(!operations.includes('codocs.personal-document-collaboration-open'))
  for (const scope of scopes) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), true, scope)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope: 'assets:ip-asset:link-product', audience: 'tenant-runtime' })), false)
  const navigationRoute = readFileSync(fileURLToPath(new URL('../../../../enterprise/server/routes/enterprise/api/navigation.get.ts', import.meta.url)), 'utf8')
  const policyGate = readFileSync(fileURLToPath(new URL('../../../../enterprise/server/utils/enterprisePolicyGate.ts', import.meta.url)), 'utf8')
  const policyReader = readFileSync(fileURLToPath(new URL('../../../../foundation/server/utils/enterprisePolicyReader.ts', import.meta.url)), 'utf8')
  assert.match(navigationRoute, /requireCurrentEnterprisePolicy\(event, user\)/)
  assert.match(policyGate, /readEnterprisePolicySnapshot\(event,/)
  const internalScopes = [...policyReader.matchAll(/scope: '([^']+)'/g)].map(match => match[1])
  assert.deepEqual([...internalHostRuntimeScopes].sort(), internalScopes.sort())
  assert.ok(operations.includes('console.directory-self-departments'))
  assert.ok(operations.includes('console.directory-self-projects'))
  assert.ok(scopes.includes('console:directory-self:read'))
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope: 'console:directory-user:view' })), false)
  for (const scope of internalHostRuntimeScopes) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), true, scope)
  const notExposed = [...new Set([...registry.entries()].filter(([operation]) => !operations.includes(operation)).map(([, scope]) => scope))]
    .filter(scope => !scopes.includes(scope))
  for (const scope of notExposed) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), false, scope)
  for (const scope of ['unknown:object:read', 'aims:products:*', 'aims:projects:view aims:projects:edit']) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), false, scope)
  }
})

const tokenBody = { grant_type: 'client_credentials', client_id: 'enterprise.runtime', app_code: 'enterprise', audience: 'data-runtime', scope: 'aims:products:view', source_binding: 'service-client-policy' }
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
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(aims)), false)
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...worker, scope: 'notifications:publish', audience: 'notifications' }), { workflowLocal: true, notificationsInAppOnly: true }), true)
  assert.equal(issue({ ...worker, scope: 'notifications:publish', audience: 'notifications' }), false)
  for (const changed of [{ app_code: 'enterprise' }, { client_id: 'enterprise.runtime' }, { scope: 'workflow:admin' }, { audience: 'notifications' }, { source_binding: 'untrusted' }]) {
    assert.equal(issue({ ...worker, ...changed }), false)
  }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(worker)), false)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/runtime/apps/workflow/config', '', { workflowLocal: true }), true)
  assert.equal(allowedConsoleRequest('GET', '/api/v1/console/runtime/apps/workflow/config'), false)
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
  for (const changed of [{ client_id: 'console.runtime' }, { app_code: 'aims' }, { scope: 'aims:products:edit' }, { audience: 'tenant-runtime' }, { deployment: 'other' }, { scope: 'aims:products:view aims:projects:view' }]) {
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
  const approved = { ...tokenBody, scope: 'assets:product:edit' }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true)
  for (const changed of [
    { audience: 'console' }, { audience: 'tenant-runtime' },
    { scope: 'assets:product:admin' }, { scope: 'codocs:personal-documents:admin' },
    { scope: 'assets:product:edit assets:product:read' },
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
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), true, scope)
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope, audience: 'console' })), false, `${scope} audience`)
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope, client_id: 'aims.runtime' })), false, `${scope} client`)
  }
  for (const scope of ['aims:product-requests:delete', 'aims:product-priorities:admin']) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), false, scope)
  }
})

test('follow-up 7 association scopes require exact Enterprise identity and data-runtime audience', () => {
  for (const scope of ['aims:product-documents:create', 'aims:project-products:read', 'aims:project-products:create']) {
    const approved = { ...tokenBody, scope }
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true, scope)
    for (const changed of [
      { audience: 'console' }, { audience: 'tenant-runtime' }, { client_id: 'aims.runtime' },
      { app_code: 'aims' }, { scope: `${scope} aims:projects:view` }, { scope: 'aims:project-products:*' }
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
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), true, scope)
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope, audience: 'console' })), false, `${scope} audience`)
  }
  for (const scope of ['aims:products:*', 'credential_vault:*', 'integration_config:edit', 'codocs:document-access-records:record']) {
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...tokenBody, scope })), false, scope)
  }
})

test('Codocs owner share creation permits only the existing exact Runtime capability', () => {
  const approved = { ...tokenBody, scope: 'codocs:document-shares:create' }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true)
  for (const changed of [
    { audience: 'console' }, { client_id: 'codocs.runtime' }, { app_code: 'codocs' },
    { scope: 'codocs:document-shares:*' }, { scope: 'codocs:document-shares:create codocs:document-shares:read' }
  ]) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, ...changed })), false)
})

test('Codocs recipient mark-read permits only the exact data-runtime capability', () => {
  const approved = { ...tokenBody, scope: 'codocs:document-shares:mark-read' }
  assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true)
  for (const changed of [
    { audience: 'console' }, { client_id: 'codocs.runtime' }, { app_code: 'codocs' },
    { scope: 'codocs:document-shares:admin' },
    { scope: 'codocs:document-shares:*' }, { scope: 'codocs:document-shares:mark-read codocs:document-shares:create' }
  ]) assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify({ ...approved, ...changed })), false)
})

test('Codocs owner cleanup permits exact share and personal document delete scopes only', () => {
  for (const scope of ['codocs:document-shares:delete', 'codocs:personal-documents:delete']) {
    const approved = { ...tokenBody, scope }
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(approved)), true, scope)
    for (const changed of [
      { audience: 'console' }, { client_id: 'codocs.runtime' }, { app_code: 'codocs' },
      { scope: `${scope} codocs:personal-documents:edit` }, { scope: 'codocs:document-shares:*' }
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
