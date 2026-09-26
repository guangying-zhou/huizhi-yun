import test from 'node:test'
import assert from 'node:assert/strict'
import { safeError, safeErrorHeaders } from '../error-contract.mjs'
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
