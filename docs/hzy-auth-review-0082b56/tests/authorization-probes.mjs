import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createConsoleEgress, allowedConsoleRequest } from '../source/deploy/test-env/local-enterprise/console-egress.mjs'
import { safeError } from '../source/deploy/test-env/local-enterprise/error-contract.mjs'

// No live credentials, IdP, Runtime, database, or user environment is accessed.
// The real egress is bound to an ephemeral loopback port. A deterministic fake
// Console lets us distinguish locally rejected requests from forwarded requests.
const actualUpstreamCalls = []
const server = createConsoleEgress({
  localSecret: 'local-review-fixture', remoteSecret: 'remote-review-fixture',
  fetchImpl: async (_url, init) => {
    actualUpstreamCalls.push(JSON.parse(init.body).scope)
    return new Response(JSON.stringify({ access_token: 'not-a-real-token', token_type: 'Bearer' }), { headers: { 'content-type': 'application/json' } })
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const rows = []
try {
  const scopes = [
    ['aims:products:view', true, '产品列表'],
    ['aims:products:authorization-object', false, '产品对象授权事实（详情/权限前置）'],
    ['aims:product-versions:read', true, '版本读取（仍有前置授权依赖）'],
    ['codocs:personal-documents:read', true, '个人文档元数据'],
    ['integration_config:view', false, '对象存储集成配置'],
    ['credential_vault:resolve', false, '对象存储凭据解析'],
    ['codocs:personal-documents:export', false, '文档下载'],
    ['codocs:document-access-records:record', false, '公司文档访问审计'],
    ['assets:product:edit', true, '获准产品编辑例外'],
    ['codocs:personal-documents:create', false, '未获准文档创建']
  ]
  for (const [scope, expected, purpose] of scopes) {
    const body = { grant_type: 'client_credentials', client_id: 'enterprise.runtime', app_code: 'enterprise', audience: 'data-runtime', scope, source_binding: 'service-client-policy' }
    assert.equal(allowedConsoleRequest('POST', '/oauth/token', JSON.stringify(body)), expected)
    const before = actualUpstreamCalls.length
    const response = await fetch(`http://127.0.0.1:${server.address().port}/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-hzy0-egress-token': 'local-review-fixture' }, body: JSON.stringify(body)
    })
    const payload = await response.json()
    assert.equal(response.status, expected ? 200 : 403)
    assert.equal(actualUpstreamCalls.length - before, expected ? 1 : 0)
    rows.push({ scope, purpose, localAllowed: expected, status: response.status, forwardedToFakeConsole: actualUpstreamCalls.length > before, errorCode: expected ? null : payload.code ?? null })
  }
} finally { await new Promise(resolve => server.close(resolve)) }
const errors = [
  [403, { statusCode: 403, message: 'Console egress request failed' }],
  [503, { statusCode: 503, data: { code: 'enterprise_module_runtime_not_ready' } }],
  [503, { statusCode: 503, message: '文档存储暂不可用' }],
  [403, { error: 'insufficient_scope' }]
].map(([status, body]) => ({ input: body, output: safeError(status, 'application/json', JSON.stringify(body)) }))
const result = { node: process.version, scope: 'isolated real egress HTTP with fake upstream; no actual grant/role/deployment validation', rows, errors }
await writeFile(new URL('../results/authorization-probes.json', import.meta.url), JSON.stringify(result, null, 2)+'\n')
console.log(JSON.stringify(result,null,2))
