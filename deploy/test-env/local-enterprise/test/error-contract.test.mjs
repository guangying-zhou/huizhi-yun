import test from 'node:test'
import assert from 'node:assert/strict'
import { safeError, safeErrorHeaders, safeCorrelationId, wantsNavigationHtml, navigationErrorHtml } from '../error-contract.mjs'
test('reviewed protocol fields survive while diagnostic material is discarded', () => {
  for (const [status, code] of [[401,'invalid_token'],[403,'insufficient_scope'],[409,'enterprise_directory_changed'],[503,'enterprise_catalog_unavailable']]) {
    const result = safeError(status, 'application/json', JSON.stringify({ data: { code, currentVersion: 3, token: 'SECRET' }, message: 'SECRET', stack: 'SECRET' }))
    assert.equal(result.data.code, code)
    assert.ok(!JSON.stringify(result).includes('SECRET'))
    if (status === 409) assert.equal(result.data.currentVersion, 3)
  }
  for (const [type, body] of [['text/html','<html>SECRET</html>'],['application/json','{"code":"unknown_secret"}'],['application/json','x'.repeat(65537)]]) assert.equal(safeError(409,type,body).code,'hzy0_upstream_error')
})
test('only bounded retry intervals and host-only known cookie deletion survive', () => {
  const headers = safeErrorHeaders(409, { 'retry-after':'2', 'set-cookie':['hzy_access_token=; Max-Age=0; Path=/; HttpOnly; Secure','hzy_uid=SECRET; Path=/','hzy_uid=; Max-Age=0; Domain=isme.dev'] }, {allowCookieClear:true})
  assert.equal(headers['retry-after'],'2')
  assert.equal(headers['set-cookie'].length,1)
  assert.equal(safeErrorHeaders(503, {'retry-after':'9999'})['retry-after'],undefined)
  assert.equal(safeErrorHeaders(401, {'set-cookie':'hzy_uid=; Max-Age=0'})['set-cookie'],undefined)
})

test('registered product write errors preserve codes without diagnostic payloads', () => {
  for (const [status, code] of [[409, 'idempotency_payload_mismatch'], [409, 'assets_product_conflict'], [503, 'enterprise_assets_unavailable']]) {
    const body = JSON.stringify({ data: { code, sql: 'SECRET' }, message: 'SECRET', stack: 'SECRET' })
    assert.equal(safeError(status, 'application/json', body).code, code)
    assert.doesNotMatch(JSON.stringify(safeError(status, 'application/json', body)), /SECRET/)
    assert.equal(safeError(400, 'application/json', body).code, 'hzy0_upstream_error')
  }
})

test('readiness, document dependency and local egress layers keep distinct safe codes', () => {
  for (const [status, code] of [
    [503, 'enterprise_module_runtime_not_ready'],
    [503, 'enterprise_document_storage_unavailable'],
    [503, 'enterprise_document_access_record_unavailable'],
    [403, 'hzy0_console_egress_denied']
  ]) {
    const correlationId = '123e4567-e89b-12d3-a456-426614174000'
    const result = safeError(status, 'application/json', JSON.stringify({ statusCode: status, code, correlationId, message: 'SECRET' }))
    assert.equal(result.code, code)
    assert.equal(result.data.correlationId, correlationId)
    assert.doesNotMatch(JSON.stringify(result), /SECRET/)
  }
})

test('policy and session dependency failures keep distinct safe codes', () => {
  for (const [status, code, payload] of [
    [401, 'enterprise_policy_version_changed', { data: { code: 'enterprise_policy_version_changed' } }],
    [410, 'codocs_version_expired', { data: { code: 'codocs_version_expired' } }],
    [409, 'snapshot_generation_conflict', { data: { code: 'snapshot_generation_conflict' } }],
    [409, 'document_on_snapshot_v2', { data: { code: 'document_on_snapshot_v2' } }],
    [503, 'enterprise_policy_reader_unavailable', { data: { code: 'enterprise_policy_reader_unavailable' } }],
    [503, 'enterprise_policy_invalid_or_expired', { data: { code: 'enterprise_policy_invalid_or_expired' } }],
    [503, 'enterprise_policy_deployment_required', { data: { code: 'enterprise_policy_deployment_required' } }],
    [503, 'console_session_runtime_unavailable', { data: { code: 'console_session_runtime_unavailable' } }],
    [503, 'console_session_verification_unavailable', { code: 'console_session_verification_unavailable' }],
    [503, 'verified_console_policy_receipt_invalid', { data: { code: 'verified_console_policy_receipt_invalid' } }],
    [503, 'verified_console_policy_unavailable', { data: { code: 'verified_console_policy_unavailable' } }],
    [503, 'local_console_policy_unavailable', { data: { code: 'local_console_policy_unavailable' } }],
    [503, 'enterprise_policy_persistence_required', { data: { code: 'enterprise_policy_persistence_required' } }],
    [503, 'policy_delivery_prepared_unavailable', { code: 'policy_delivery_prepared_unavailable' }],
    [502, 'hzy0_console_egress_failed', { code: 'hzy0_console_egress_failed' }]
  ]) {
    const result = safeError(status, 'application/json', JSON.stringify({ statusCode: status, message: 'SECRET', ...payload }))
    assert.equal(result.code, code, code)
    assert.equal(result.statusCode, status, code)
    assert.doesNotMatch(JSON.stringify(result), /SECRET/, code)
  }
  assert.equal(safeError(503, 'application/json', JSON.stringify({ statusCode: 503, message: 'Verified policy is invalid or expired' })).code, 'hzy0_upstream_error')
})

test('only document navigation negotiates the static HTML error page', () => {
  for (const path of ['/aims/projects', '/enterprise/login', '/codocs/embed/editor/doc_1']) {
    assert.equal(wantsNavigationHtml('GET', path, { 'sec-fetch-mode': 'navigate' }), true)
    assert.equal(wantsNavigationHtml('HEAD', path, { accept: 'text/html,application/xhtml+xml' }), true)
  }
  for (const path of ['/enterprise/api/navigation', '/codocs/api/documents/1', '/enterprise/_nuxt/app.js', '/codocs/_nuxt/app.js', '/console/_nuxt/app.css', '/console/oauth/userinfo', '/console/.well-known/openid-configuration', '/__vite_ws', '/enterprise/logo.svg']) {
    assert.equal(wantsNavigationHtml('GET', path, { 'sec-fetch-mode': 'navigate', accept: 'text/html' }), false, path)
  }
  assert.equal(wantsNavigationHtml('POST', '/aims/projects', { accept: 'text/html' }), false)
  assert.equal(wantsNavigationHtml('GET', '/aims/projects', { accept: 'application/json,text/html' }), false)
  assert.equal(wantsNavigationHtml('GET', '/aims/projects', { accept: 'text/html;q=0,application/json' }), false)
  const id = '123e4567-e89b-12d3-a456-426614174000'
  assert.equal(safeCorrelationId('application/json', JSON.stringify({ correlationId: id, code: 'unreviewed' })), id)
  assert.equal(safeCorrelationId('text/html', `<script>${id}</script>`), undefined)
  for (const [status, phrase] of [[401, '请登录'], [403, '没有访问'], [409, '状态已变化'], [503, '暂时不可用'], [418, '暂时无法完成']]) {
    const html = navigationErrorHtml(status, id)
    assert.match(html, new RegExp(phrase))
    assert.match(html, /prefers-color-scheme:dark/)
    assert.match(html, /location\.reload\(\)/)
    assert.ok(html.includes(id))
    assert.doesNotMatch(html, /https?:\/\//)
  }
  assert.doesNotMatch(navigationErrorHtml(503, '<script>'), /<script>/)
})
