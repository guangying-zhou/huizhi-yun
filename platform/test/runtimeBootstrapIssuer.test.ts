import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeBootstrapIssuer } from '../server/utils/runtimeBootstrapIssuer.ts'

test('development and production keep distinct configured bootstrap issuers', () => {
  assert.equal(runtimeBootstrapIssuer('https://huizhi.yun/'), 'https://huizhi.yun')
  assert.equal(runtimeBootstrapIssuer('https://platform-dev.wiztek.cn/'), 'https://platform-dev.wiztek.cn')
  assert.notEqual(runtimeBootstrapIssuer('https://huizhi.yun'), runtimeBootstrapIssuer('https://platform-dev.wiztek.cn'))
  assert.equal(runtimeBootstrapIssuer('http://127.0.0.1:3011/'), 'http://127.0.0.1:3011')
})

test('missing or unsafe configured identity never falls back to the production issuer', () => {
  for (const value of [undefined, '', 'not-a-url', 'https://user:secret@example.invalid', 'https://example.invalid?iss=x', 'https://example.invalid#fragment', 'http://example.invalid', 'ftp://example.invalid']) {
    assert.throws(() => runtimeBootstrapIssuer(value))
  }
})
