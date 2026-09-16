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
})
