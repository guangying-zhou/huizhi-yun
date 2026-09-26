import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicCodocsEditorShell, isTrustedCodocsEditorMessage, resolveCodocsEditorTarget } from '../app/utils/codocsEditorBoundary.ts'

test('only the marked, document-bound editor shell skips its own app login', () => {
  assert.equal(isPublicCodocsEditorShell('/embed/editor/doc_1', true), true)
  assert.equal(isPublicCodocsEditorShell('/codocs/embed/editor/doc_1', true), true)
  for (const [path, marker] of [
    ['/embed/editor/doc_1', false], ['/embed/editor/../admin', true],
    ['/codocs/api/documents/doc_1', true], ['/codocs/embed/editor/', true]
  ] as const) assert.equal(isPublicCodocsEditorShell(path, marker), false)
})

test('Codocs editor target is explicit, canonical and document-bound', () => {
  assert.deepEqual(resolveCodocsEditorTarget('https://codocs.example.test/', 'doc_1', { readonly: true, showTitle: false }), {
    origin: 'https://codocs.example.test',
    src: 'https://codocs.example.test/embed/editor/doc_1?readonly=1&title=0'
  })
  assert.deepEqual(resolveCodocsEditorTarget('https://hzy0.isme.dev/codocs', 'doc_1'), {
    origin: 'https://hzy0.isme.dev',
    src: 'https://hzy0.isme.dev/codocs/embed/editor/doc_1'
  })
  for (const base of ['', 'javascript:alert(1)', 'https://user:secret@example.test', 'https://example.test/path', 'https://example.test?x=1']) {
    assert.equal(resolveCodocsEditorTarget(base, 'doc-1'), null)
  }
  for (const uuid of ['', '../secret', 'doc/child', 'a'.repeat(65)]) assert.equal(resolveCodocsEditorTarget('https://example.test', uuid), null)
})

test('Codocs editor content accepts only the configured origin and iframe window', () => {
  const source = {} as Window
  const valid = { origin: 'https://codocs.example.test', source, data: { type: 'codocs:content', content: '# body' } }
  assert.equal(isTrustedCodocsEditorMessage(valid, valid.origin, source), true)
  assert.equal(isTrustedCodocsEditorMessage({ ...valid, origin: 'https://evil.test' }, valid.origin, source), false)
  assert.equal(isTrustedCodocsEditorMessage({ ...valid, source: {} as Window }, valid.origin, source), false)
  assert.equal(isTrustedCodocsEditorMessage({ ...valid, data: { type: 'codocs:content', content: 1 } }, valid.origin, source), false)
})
