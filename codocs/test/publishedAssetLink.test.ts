import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePublishedAssetPath, publishedAssetPagePath } from '../shared/utils/publishedAssetLink.ts'

test('published links preserve nested historical OSS files and special characters', () => {
  for (const path of [
    'codocs/company/rules/2026/人事制度 V2 #1 100%?.md',
    'codocs/company/notices/通知&公告.pdf',
    'codocs/departments/GMO/rules/部门制度.md',
    'codocs/departments/GMO/outsides/来函.md'
  ]) {
    const pagePath = publishedAssetPagePath(path)
    const url = new URL(`/codocs${pagePath}`, 'https://tenant.example.test')
    assert.equal(url.searchParams.get('path'), path)
    assert.equal(url.hash, '')
    assert.equal(url.origin, 'https://tenant.example.test')
    assert.equal(url.pathname, `/codocs/${path.split('/')[1]}/document`)
    assert.equal(url.searchParams.has('token'), false)
    assert.equal(parsePublishedAssetPath(path)?.name, path.split('/').at(-1))
  }
})

test('invalid paths and unpublished namespaces never produce a document link', () => {
  for (const path of [
    '', 'https://example.com/file.md', 'codocs/company/rules/../secret.md',
    'codocs/company//rules/x.md', 'codocs/company/rules/a\\b.md',
    'codocs/company/rules/a\nb.md', 'codocs/company/rules/',
    'codocs/archives/company/rules/a.md', 'codocs/documents/draft.md',
    'codocs/departments/GMO/drafts/a.md', 'codocs/company/drafts/a.md',
    'codocs/company/rules/' + 'x'.repeat(801)
  ]) {
    assert.equal(parsePublishedAssetPath(path), null, path)
    assert.equal(publishedAssetPagePath(path), '', path)
  }
  assert.equal(parsePublishedAssetPath(['codocs/company/rules/a.md']), null)
  assert.equal(parsePublishedAssetPath(null), null)
})

test('company and department reading pages accept only their own namespace', () => {
  assert.equal(parsePublishedAssetPath('codocs/company/rules/a.md', 'departments'), null)
  assert.equal(parsePublishedAssetPath('codocs/departments/GMO/rules/a.md', 'company'), null)
  assert.ok(parsePublishedAssetPath('codocs/company/rules/a.md', 'company'))
  assert.ok(parsePublishedAssetPath('codocs/departments/GMO/rules/a.md', 'departments'))
})
