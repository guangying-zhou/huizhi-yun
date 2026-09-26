import assert from 'node:assert/strict'
import test from 'node:test'
import { codocsDocumentPath, modulePath } from '../layer/modulePath.mjs'

test('keeps standalone Codocs paths relative', () => {
  assert.equal(modulePath('codocs', false, '/documents/abc'), '/documents/abc')
  assert.equal(modulePath('codocs', false, '/documents/abc?title=..#section'), '/documents/abc?title=..#section')
})

test('adds an idempotent Codocs prefix for hosted paths', () => {
  assert.equal(modulePath('codocs', true, '/documents/abc'), '/codocs/documents/abc')
  assert.equal(modulePath('codocs', true, '/codocs/documents/abc?x=1#top'), '/codocs/documents/abc?x=1#top')
})

test('builds validated standalone and Host document routes', () => {
  assert.equal(codocsDocumentPath(false, '550e8400-e29b-41d4-a716-446655440000'), '/documents/550e8400-e29b-41d4-a716-446655440000')
  assert.equal(codocsDocumentPath(true, 'doc_123'), '/codocs/documents/doc_123')
  for (const value of ['', '../secret', 'doc/child', '文档', 'a'.repeat(65)]) {
    assert.throws(() => codocsDocumentPath(true, value), /Invalid Codocs document UUID/)
  }
})

test('rejects external, ambiguous, traversal, and cross-module paths', () => {
  for (const path of [
    'https://example.com/documents/abc',
    '//example.com/documents/abc',
    '/documents//abc',
    '/documents\\abc',
    '/../documents/abc',
    '/documents/%2e%2e/secret',
    '/codocs/../documents/abc',
    '/aims/projects',
    '/aims?x=1',
    '/%61ims/x',
    '/assets/files',
    '/%61ssets/x'
  ]) {
    assert.throws(() => modulePath('codocs', true, path), /local module path|Cross-module/)
  }

  assert.throws(() => modulePath('aims', true, '/projects'), /Codocs module path/)
})
