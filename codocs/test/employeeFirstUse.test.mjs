import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('personal space does not confuse a directory read failure with an empty first-use state', () => {
  const source = readFileSync(new URL('../app/pages/mydocs/index.vue', import.meta.url), 'utf8')
  assert.match(source, /v-else-if="rootFolderError \|\| rootDocumentError"/)
  assert.match(source, /documentLoadErrorMessage\(rootFolderError \|\| rootDocumentError\)/)
  assert.match(source, /hasPermission\('documents', 'create'\)/)
  assert.equal((source.match(/v-if="canCreateDocument"/g) || []).length, 4)
  assert.match(source, /从文档内共享给同事协同编辑/)
})

test('recent and favorite read failures cannot render an empty success table', () => {
  for (const name of ['recently', 'favorites']) {
    const source = readFileSync(new URL(`../app/pages/mydocs/${name}.vue`, import.meta.url), 'utf8')
    assert.match(source, /error: loadError/)
    assert.match(source, /CommonEmptyState v-if="loadError"/)
    assert.match(source, /<UTable\s+v-else/)
  }
})

test('personal tree and document menus use explicit manifest actions instead of writable defaults', () => {
  const source = readFileSync(new URL('../app/pages/mydocs/index.vue', import.meta.url), 'utf8')
  assert.match(source, /:can-mutate="canEditDocument"/)
  assert.match(source, /:can-delete="canDeleteDocument"/)
  for (const action of ['edit', 'delete', 'export']) assert.ok(source.includes(`hasPermission('documents', '${action}')`))
  assert.match(source, /v-if="documentMenuItems.length"/)
  const editor = readFileSync(new URL('../app/pages/documents/[uuid].vue', import.meta.url), 'utf8')
  assert.match(editor, /canManageShares = computed\(\(\) => canViewShares.value && !docState.value.readonly_flag && isDocumentOwner.value\)/)
  assert.match(editor, /canManageShares \? \[/)
})

test('the Host personal space can open its directory before selecting a document', () => {
  const source = readFileSync(new URL('../app/pages/mydocs/index.vue', import.meta.url), 'utf8')
  const header = source.slice(source.indexOf('<MyDocumentSpaceHeader'), source.indexOf('</MyDocumentSpaceHeader>'))
  assert.match(header, /aria-label="打开文档目录"/)
  assert.match(header, /@click="openDirectoryPanel"/)
  assert.match(source, /function openDirectoryPanel\(\) \{\s*panelCollapsed.value = false\s*showMobileSidebar.value = true/)
})

test('recycle failures, mobile preview navigation and restore permission remain distinct', () => {
  const source = readFileSync(new URL('../app/pages/mydocs/recycle.vue', import.meta.url), 'utf8')
  assert.match(source, /CommonEmptyState\s+v-else-if="trashError"/)
  assert.match(source, /CommonEmptyState\s+v-else-if="previewError"/)
  assert.match(source, /selectedDoc \? 'hidden md:flex' : 'flex'/)
  assert.match(source, /aria-label="返回回收站列表"/)
  assert.match(source, /:class="hosted \? 'min-h-0' : ''"/)
  assert.match(source, /<button\s+v-for="doc in trashDocuments"\s+:key="doc.uuid \|\| doc.id"\s+type="button"/)
  assert.match(source, /hasPermission\('documents', 'edit'\)/)
  assert.match(source, /v-if="canRestore"/)
  assert.match(source, /if \(!canRestore.value \|\| !selectedDoc.value\) return/)
  const shared = readFileSync(new URL('../app/pages/mydocs/shared.vue', import.meta.url), 'utf8')
  assert.match(shared, /previewError.value = documentLoadErrorMessage\(error\)/)
  assert.doesNotMatch(shared, /previewError.value = err\./)
})
