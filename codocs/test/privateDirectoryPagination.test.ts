import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileTemplate } from 'vue/compiler-sfc'

for (const file of ['pages/mydocs/index.vue', 'components/FileTreeItem.vue', 'components/MoveFolderModal.vue']) {
  test(`${file} compiles as a complete SFC`, () => {
    const filename = new URL(`../app/${file}`, import.meta.url)
    const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname })
    assert.deepEqual(errors, [])
    assert.ok(descriptor.template)
    assert.deepEqual(compileTemplate({ filename: filename.pathname, source: descriptor.template.content, id: file }).errors, [])
  })
}

test('private tree uses independent direct-child pages and a separate move picker', () => {
  const page = readFileSync(new URL('../app/pages/mydocs/index.vue', import.meta.url), 'utf8')
  assert.match(page, /parent_id: parentId === null \? 'null'/)
  assert.match(page, /folder_id: parentId === null \? 'null'/)
  assert.match(page, /childRequestIds\.get\(parentId\) !== request/)
  assert.match(page, /:load-page="fetchFolderPage"/)
  assert.doesNotMatch(page, /fetchAllFolders|fetchAllDocuments|allFolders\.value|allDocuments\.value/)
})
