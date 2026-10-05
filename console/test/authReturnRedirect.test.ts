import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizeConsoleAuthReturnRedirect } from '../server/utils/authReturnRedirect.ts'

describe('Console upstream auth return redirect', () => {
  test('preserves safe local paths', () => {
    assert.equal(normalizeConsoleAuthReturnRedirect('/admin?tab=auth#sessions'), '/admin?tab=auth#sessions')
    assert.equal(normalizeConsoleAuthReturnRedirect('/'), '/')
  })

  test('fails closed for external or parser-confusing redirect values', () => {
    for (const value of [
      'https://evil.example.test/',
      'http://evil.example.test/',
      '//evil.example.test/',
      '///evil.example.test/',
      '/\\evil.example.test/',
      '/%2fevil.example.test/',
      '/%252fevil.example.test/',
      '/%5cevil.example.test/',
      '/%2e%2e/admin',
      '/%00admin',
      '/safe\nSet-Cookie: forged',
      'https://user:pass@console.example.test/'
    ]) {
      assert.equal(normalizeConsoleAuthReturnRedirect(value), '/', value)
    }
  })

  test('keeps encoded URLs in the query but still rejects encoded separators in the path', () => {
    const authorize = '/console/oauth/authorize?response_type=code&client_id=enterprise&redirect_uri=https%3A%2F%2Fsite.example.test%2Fenterprise%2Fapi%2Fauth%2Foidc-callback'
    assert.equal(normalizeConsoleAuthReturnRedirect(authorize), authorize)
    for (const value of ['/%2fevil.example.test/?a=1', '/%2e%2e/admin?next=%2F', '/ok?x=\\evil']) {
      assert.equal(normalizeConsoleAuthReturnRedirect(value), '/', value)
    }
  })

  test('reduces only an absolute URL on the verified Gateway host to its site path', () => {
    const trusted = { trustedHost: 'Site.Example.Test:443' }
    assert.equal(normalizeConsoleAuthReturnRedirect('https://site.example.test/enterprise', trusted), '/enterprise')
    assert.equal(
      normalizeConsoleAuthReturnRedirect('https://site.example.test/console/oauth/authorize?client_id=enterprise&redirect_uri=https%3A%2F%2Fsite.example.test%2Fcb#f', trusted),
      '/console/oauth/authorize?client_id=enterprise&redirect_uri=https%3A%2F%2Fsite.example.test%2Fcb#f'
    )
    for (const value of [
      'https://evil.example.test/enterprise',
      'https://site.example.test.evil.test/enterprise',
      'https://user:pass@site.example.test/enterprise',
      'javascript://site.example.test/%0aalert(1)',
      'https://site.example.test/%2fevil.example.test/'
    ]) {
      assert.equal(normalizeConsoleAuthReturnRedirect(value, trusted), '/', value)
    }
    assert.equal(normalizeConsoleAuthReturnRedirect('https://site.example.test/enterprise'), '/')
    assert.equal(normalizeConsoleAuthReturnRedirect('https://site.example.test/enterprise', { trustedHost: '' }), '/')
  })
})
