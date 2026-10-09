import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

test('recycle page keeps server total, repairs an empty last page and rejects stale identity responses', async () => {
  const source = readFileSync(new URL('../app/pages/mydocs/recycle.vue', import.meta.url), 'utf8')
  assert.match(source, /<UPagination[\s\S]*?:total="total"/)
  assert.match(source, /共 {{ total }} 条/)
  const script = stripTypeScriptTypes(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, ''))
  const watches = [], calls = [], mounted = [], disposed = []
  const user = { value: 'alice' }
  let scope = 'alice-policy-1'
  let editable = false
  const ref = value => ({ value })
  const fetchTrash = (query, signal) => new Promise((resolve, reject) => calls.push({ query, signal, resolve, reject }))
  const run = new Function('env', `with (env) { ${script}; return { page, total, trashDocuments, loadTrashDocuments, selectedDoc, previewContent, trashError, canRestore, openRestore, showRestoreModal }; }`)
  const page = run({
    ref, computed: fn => ({ get value() {
      return fn()
    } }), definePageMeta() {}, usePageTitle() {},
    usePermissions: () => ({ hasPermission: (resource, action) => resource === 'documents' && action === 'edit' && editable }),
    documentLoadErrorMessage: () => '你没有查看此文档正文的权限，请返回文档列表',
    useAuth: () => ({ user }), useToast: () => ({ add() {} }),
    useCodocsModule: () => ({ hosted: true, moduleUrl: x => x, cacheKey: () => scope }),
    useRecycleBin: () => ({ fetchTrashPage: fetchTrash, formatDeletedAt() {}, formatDocLocation() {} }),
    watch: (target, fn) => watches.push({ target, fn }), onMounted: fn => mounted.push(fn), onScopeDispose: fn => disposed.push(fn), AbortController
  })
  page.selectedDoc.value = { uuid: 'restore-document', title: '合成文档' }
  page.openRestore()
  assert.equal(page.showRestoreModal.value, false)
  editable = true
  page.openRestore()
  assert.equal(page.showRestoreModal.value, true)
  const denied = page.loadTrashDocuments()
  calls[0].reject({ statusCode: 403 })
  await denied
  assert.match(page.trashError.value, /没有查看/)
  calls.shift()
  const first = page.loadTrashDocuments()
  assert.equal(page.trashError.value, '')
  page.page.value = 2
  const second = page.loadTrashDocuments()
  assert.equal(calls[0].signal.aborted, true)
  calls[1].resolve({ items: [{ uuid: 'second' }], total: 21, page: 2, pageSize: 20 })
  await second
  calls[0].resolve({ items: [{ uuid: 'stale' }], total: 999, page: 1, pageSize: 20 })
  await first
  assert.equal(page.total.value, 21)
  assert.equal(page.trashDocuments.value[0].uuid, 'second')
  const reduced = page.loadTrashDocuments()
  calls[2].resolve({ items: [], total: 20, page: 2, pageSize: 20 })
  await reduced
  assert.equal(page.page.value, 1)
  const pending = page.loadTrashDocuments()
  user.value = null
  scope = 'signed-out'
  watches.find(w => typeof w.target === 'function').fn()
  assert.equal(calls[3].signal.aborted, true)
  calls[3].resolve({ items: [{ uuid: 'secret' }], total: 1, page: 1, pageSize: 20 })
  await pending
  assert.equal(page.total.value, 0)
  assert.deepEqual(page.trashDocuments.value, [])
  await page.loadTrashDocuments()
  assert.equal(calls.length, 4)
  disposed.forEach(fn => fn())
})
