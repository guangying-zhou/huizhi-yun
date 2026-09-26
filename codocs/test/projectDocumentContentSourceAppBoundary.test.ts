import test from 'node:test'
import assert from 'node:assert/strict'
import manifest from '../app.manifest.json' with { type: 'json' }
import {
  AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH,
  ENTERPRISE_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH,
  requireCodocsServiceAuth
} from '../server/lib/serviceAuthPolicy.ts'

// ADR-018 §3.2：统一企业宿主身份由正式契约覆盖，且不得通过放宽既有校验兼容。
// 两条要求共享同一 capability，差别只在 allowedApps / allowedClientCodes，
// 所以这里逐条验「错来源应用」这一格。
const scope = 'codocs:project-document:content:read'
const base = { authenticated: true, tokenUse: 'service', subjectType: 'service', scopes: [scope] }
const aims = { ...base, appCode: 'aims', clientCode: 'aims.runtime' }
const enterprise = { ...base, appCode: 'enterprise', clientCode: 'enterprise.runtime' }

test('project document content capability is declared once and required exactly', () => {
  const [, resource, ...rest] = scope.split(':')
  assert.ok(manifest.resources.some(entry => entry.code === resource && entry.actions.includes(rest.join(':'))))
  for (const requirement of [AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH, ENTERPRISE_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH]) {
    assert.equal(requirement.scope, scope)
    assert.equal(requirement.exactScope, true)
  }
  // 宿主没有换来更宽的入口：两条的 capability 完全相同。
  assert.equal(ENTERPRISE_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH.scope, AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH.scope)
})

test('each source app is accepted only by its own requirement', () => {
  assert.doesNotThrow(() => requireCodocsServiceAuth(aims, AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH))
  assert.doesNotThrow(() => requireCodocsServiceAuth(enterprise, ENTERPRISE_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH))
  // 错来源应用：交叉两个方向都必须 403，而不是因为 capability 相同就放行。
  assert.throws(() => requireCodocsServiceAuth(aims, ENTERPRISE_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH), { statusCode: 403 })
  assert.throws(() => requireCodocsServiceAuth(enterprise, AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH), { statusCode: 403 })
})

test('source app and source client must agree, and no third party is admitted', () => {
  for (const requirement of [AIMS_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH, ENTERPRISE_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH]) {
    // 借另一方的客户端标识：sourceApp 过关也要被 allowedClientCodes 拦住。
    assert.throws(() => requireCodocsServiceAuth({ ...aims, clientCode: 'enterprise.runtime' }, requirement), { statusCode: 403 })
    assert.throws(() => requireCodocsServiceAuth({ ...enterprise, clientCode: 'aims.runtime' }, requirement), { statusCode: 403 })
    // 裸 app 名不是 runtime 客户端。
    assert.throws(() => requireCodocsServiceAuth({ ...enterprise, clientCode: 'enterprise' }, requirement), { statusCode: 403 })
    for (const appCode of ['assets', 'altoc', 'console', 'workflow', '']) {
      assert.throws(() => requireCodocsServiceAuth({ ...base, appCode, clientCode: `${appCode}.runtime` }, requirement), { statusCode: 403 })
    }
    // 宽 scope 不能替代精确 capability；用户令牌和 introspection 故障各归其位。
    for (const scopes of [[], ['codocs:*'], ['codocs:admin'], ['codocs:product-document:read']]) {
      assert.throws(() => requireCodocsServiceAuth({ ...enterprise, scopes }, requirement), { statusCode: 403 })
    }
    assert.throws(() => requireCodocsServiceAuth({ ...enterprise, tokenUse: 'user' }, requirement), { statusCode: 401 })
    assert.throws(() => requireCodocsServiceAuth({ ...enterprise, authenticated: false, reason: 'service_token_introspection_unavailable' }, requirement), { statusCode: 503 })
  }
})
