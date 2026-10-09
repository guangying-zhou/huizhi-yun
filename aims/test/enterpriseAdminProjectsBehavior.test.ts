import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { projectNameError } from '../shared/projectName'

type RequestOptions = { query: { page: number }, headers: Record<string, string>, body: { year: number } }

function pageHarness(fetcher: (url: string, options: RequestOptions) => Promise<unknown>, path = '../layer/pages/enterprise-admin-projects.vue', route = reactive({ query: { returnTo: 'admin', editId: '' } })) {
  const filename = new URL(path, import.meta.url).pathname
  const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
  const script = compileScript(descriptor, { id: 'admin-behavior' })
  let js = ts.transpileModule(script.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  js = js.replace(/^import[^\n]*\n/gm, '').replace('export default', 'return')
  const navigations: string[] = []
  const loaded = ref(true)
  const scope = effectScope()
  const mocks: Record<string, unknown> = { _defineComponent: (x: unknown) => x, ref, computed, watch, reactive, useRoute: () => route, useRouter: () => ({ push: async (path: string) => {
    navigations.push(path)
  } }), projectNameError, methodologyOptions: [], selectableProjectCategoryOptions: [], ProjectAccessControlFields: {}, onMounted: () => {}, definePageMeta: () => {},
  useAimsModule: () => ({ moduleUrl: (x: string) => `/aims${x}` }), useToast: () => ({ add: () => {} }), useConfirm: () => ({ confirm: async () => true }),
  usePermissions: () => ({ loaded, error: ref(null), loadPermissions: async () => {}, hasPermission: () => true }),
  useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush: () => {} }), useState: () => ref(''), $fetch: fetcher,
  projectCategoryOptions: [], projectStatusOptions: [], projectCategoryConfig: {}, projectConfidentialityLevelConfig: {}, projectSecurityLevelConfig: {}, projectStatusConfig: {},
  ContentPageHeader: {}, CommonEmptyState: {}, ProjectPortfolioSelect: {}, UserTreeSelector: {}
  }
  const component = new Function(...Object.keys(mocks), js)(...Object.values(mocks))
  const state = scope.run(() => component.setup({}, { expose: () => {} }))
  return { state, loaded, navigations, route, stop: () => scope.stop() }
}
const response = (page: number, id: number) => ({ code: 0, data: { items: [{ id, name: `项目${id}` }], total: 60, page, pageSize: 20 } })

test('administrator list discards a stale response and makes no read while permission is unavailable', async () => {
  const requests: { options: RequestOptions, resolve: (x: unknown) => void }[] = []
  const harness = pageHarness(async (_url, options) => await new Promise(resolve => requests.push({ options, resolve })))
  try {
    assert.equal(requests.length, 1)
    harness.state.page.value = 2
    await nextTick()
    assert.equal(requests.length, 2)
    requests[1]!.resolve(response(2, 22))
    await nextTick()
    requests[0]!.resolve(response(1, 11))
    await nextTick()
    assert.equal(harness.state.roots.value[0].id, 22)
    assert.equal(harness.state.total.value, 60)
    harness.loaded.value = false
    await nextTick()
    assert.equal(requests.length, 2)
    assert.deepEqual(harness.state.roots.value, [])
  } finally { harness.stop() }
})
test('uncertain batch keeps the original intent/year and a receipt-only replay is successful', async () => {
  const writes: RequestOptions[] = []
  const harness = pageHarness(async (url, options) => {
    if (!url.endsWith('/batch-create-routine')) return response(options.query.page, 1)
    writes.push(options)
    if (writes.length === 1) throw Object.assign(new Error('lost response'), { statusCode: 503 })
    return { code: 0, data: { receiptId: 'same', idempotent: true, result: null } }
  })
  try {
    await nextTick()
    harness.state.batchYear.value = 2037
    await harness.state.createBatch()
    const original = harness.state.pendingBatch.value
    assert.ok(original)
    harness.state.batchYear.value = 2038
    await harness.state.createBatch()
    assert.equal(writes[0].headers['Idempotency-Key'], writes[1].headers['Idempotency-Key'])
    assert.equal(writes[1].body.year, 2037)
    assert.equal(harness.state.pendingBatch.value, null)
    assert.equal(harness.state.batchOpen.value, false)
    assert.equal(harness.state.batchSaving.value, false)
  } finally { harness.stop() }
})

test('project registration also accepts receipt-only replay without inventing a new project identifier', async () => {
  const writes: RequestOptions[] = []
  const harness = pageHarness(async (_url, options) => {
    writes.push(options)
    if (writes.length === 1) throw Object.assign(new Error('lost response'), { statusCode: 503 })
    return { code: 0, data: { receiptId: 'original-create', idempotent: true, result: null } }
  }, '../layer/pages/enterprise-project-new.vue')
  try {
    Object.assign(harness.state.form, { projectCode: 'SYNTHETIC', name: '合成项目', shortName: '合成', leaderUid: 'U1' })
    await harness.state.submit()
    assert.ok(harness.state.pending.value)
    await harness.state.submit()
    assert.equal(writes[0]!.headers['Idempotency-Key'], writes[1]!.headers['Idempotency-Key'])
    assert.equal(harness.state.pending.value, null)
    assert.deepEqual(harness.navigations, ['/aims/admin/projects'])
  } finally { harness.stop() }
})

test('tree roots and children paginate independently and collapsed stale child reads are discarded', async () => {
  const calls: RequestOptions[] = []
  let complete: ((value: unknown) => void) | undefined
  const harness = pageHarness(async (_url, options) => {
    calls.push(options)
    if ((options.query as Record<string, unknown>).tree) return response(options.query.page, 7)
    return await new Promise((resolve) => {
      complete = resolve
    })
  })
  try {
    await nextTick()
    const root = { id: 7, code: 'PF7', name: '项目集7' }
    harness.state.toggleRoot(root)
    assert.equal(harness.state.expanded.value.has(7), true)
    assert.equal((calls[1]!.query as Record<string, unknown>).portfolioId, '7')
    harness.state.toggleRoot(root)
    complete!({ code: 0, data: { items: [{ id: 99 }], total: 1 } })
    await nextTick()
    assert.equal(harness.state.children.value[7], undefined)
    assert.equal(harness.state.page.value, 1)
  } finally { harness.stop() }
})

test('portfolio editor loads immediately with loaded permissions and reacts to edit navigation, then PUTs its version', async () => {
  const writes: { url: string, options: RequestOptions }[] = []
  const route = reactive({ query: { returnTo: 'admin', editId: '' } })
  const harness = pageHarness(async (url, options) => {
    if (url.endsWith('/admin/projects')) return { code: 0, data: { items: [{ id: Number(route.query.editId), code: 'PF7', name: '现有项目集', description: '当前值', ownerUid: '', deptCode: '', domainCode: '', gitGroup: '', defaultCategory: 'delivery', displayOrder: 2, editVersion: 'a'.repeat(64) }] } }
    writes.push({ url, options })
    return { code: 0 }
  }, '../layer/pages/enterprise-portfolio-new.vue', route)
  try {
    await nextTick()
    assert.equal(harness.state.editId.value, '')
    route.query.editId = '7'
    await nextTick()
    await nextTick()
    assert.equal(harness.state.editId.value, '7')
    assert.equal(harness.state.form.name, '现有项目集')
    assert.equal(harness.state.form.description, '当前值')
    await harness.state.save()
    assert.equal(writes[0]!.url, '/aims/api/v1/portfolios/7')
    assert.equal((writes[0]!.options as unknown as { method: string }).method, 'PUT')
    assert.equal((writes[0]!.options.body as unknown as { expectedVersion: string }).expectedVersion, 'a'.repeat(64))
    route.query.editId = '8'
    await nextTick()
    await nextTick()
    assert.equal(harness.state.editId.value, '8')
    assert.equal(harness.state.form.name, '现有项目集')
  } finally { harness.stop() }
})
