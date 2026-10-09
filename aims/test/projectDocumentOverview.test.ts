import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { projectPageFailure } from '../app/utils/projectPageFailure'
import { createProjectDocumentReader, loadProjectDocumentCounts } from '../app/utils/projectDocumentOverview'

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')
for (const file of ['../app/pages/project-documents.vue', '../app/components/project/ProjectDocumentReadonlyNode.vue']) test(`project documents complete SFC: ${file}`, () => {
  const { descriptor, errors } = parse(read(file))
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'pd' })
  const template = compileTemplate({ id: 'pd', filename: file, source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  if (file.includes('ReadonlyNode')) assert.match(template.code, /resolveComponent\("ProjectDocumentReadonlyNode", true\)/, 'Vue resolves recursion to the component itself without a global auto import')
})

test('ACL counts use owning total; concurrent selection/count reads share one request without retaining a stale ACL cache', async () => {
  let calls = 0
  let resolve!: (value: { code: number, data: { items: { isFolder: boolean }[], total: number } }) => void
  const reader = createProjectDocumentReader(() => {
    calls++
    return new Promise<typeof value>((done) => {
      resolve = done
    })
  })
  const value = { code: 0, data: { items: [{ isFolder: true }, { isFolder: false }], total: 1 } }
  const first = reader(257)
  const second = reader(257)
  assert.equal(first, second)
  await Promise.resolve()
  resolve(value)
  assert.equal((await first).total, 1)
  assert.equal(calls, 1)
  const fresh = reader(257)
  await Promise.resolve()
  resolve(value)
  await fresh
  assert.equal(calls, 2)
})

test('invalid or failed ACL response never becomes a zero count and failed flights can retry', async () => {
  let calls = 0
  const reader = createProjectDocumentReader(async () => {
    if (++calls === 1) return { code: 503, data: { items: [], total: 0 } }
    return { code: 0, data: { items: [], total: 0 } }
  })
  await assert.rejects(reader(1))
  assert.equal((await reader(1)).total, 0)
  const counts = new Map<number, number | null>()
  await loadProjectDocumentCounts([1, 2], async (id) => {
    if (id === 2) throw new Error('503')
    return { items: [], total: 4 }
  }, (id, count) => counts.set(id, count), () => true)
  assert.equal(counts.get(1), 4)
  assert.equal(counts.get(2), null)
})

test('counts have at most three in-flight reads, deduplicate projects and discard results after page change', async () => {
  let inFlight = 0
  let maximum = 0
  let active = true
  const seen: number[] = []
  const counts = new Map<number, number | null>()
  await loadProjectDocumentCounts([1, 1, 2, 3, 4], async (id) => {
    seen.push(id)
    maximum = Math.max(maximum, ++inFlight)
    await new Promise(resolve => setTimeout(resolve, 1))
    inFlight--
    return { items: [], total: id }
  }, (id, total) => counts.set(id, total), () => active)
  assert.equal(maximum, 3)
  assert.deepEqual(seen.sort(), [1, 2, 3, 4])
  await loadProjectDocumentCounts([7], async () => {
    active = false
    return { items: [], total: 99 }
  }, (id, total) => counts.set(id, total), () => active)
  assert.equal(counts.has(7), false)
})

function setup(fetch: (path: string, options?: Record<string, unknown>) => Promise<unknown>) {
  const source = parse(read('../app/pages/project-documents.vue')).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const ref = (value: unknown) => ({ value })
  const watchers: (() => void)[] = []
  const normalizeProject = (raw: unknown) => raw
  const context = vm.createContext({
    definePageMeta: () => {}, useAimsModule: () => ({ hosted: true, moduleUrl: (path: string) => `/aims${path}` }),
    useProjectStore: () => ({ normalizeProject }), usePortfolioStore: () => ({ portfolios: [], normalizePortfolio: (raw: unknown) => raw }),
    ref, computed: (get: () => unknown) => ({ get value() { return get() } }), onMounted: () => {}, onBeforeUnmount: () => {}, watch: (_ref: unknown, fn: () => void) => watchers.push(fn),
    useRoute: () => ({ query: { projectId: '257' } }), useRouter: () => ({ replace: async () => {} }), useToast: () => ({ add: () => {} }), useRuntimeConfig: () => ({ app: { baseURL: '/' } }), $fetch: fetch,
    createProjectDocumentReader, loadProjectDocumentCounts, projectPageFailure
  })
  vm.runInContext(ts.transpileModule(`${source}\nglobalThis.state={ loadDocuments, selectedProjectId, projects, documents, documentTotal, documentError, projectDocumentCount, downloadUrl, loadProjectPage, projectPage };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context.state
}

test('rapid project selection discards late document response; errors retain failure state rather than false empty success', async () => {
  const responses = new Map<number, (value: unknown) => void>()
  const state = setup(async (_path, options) => new Promise((resolve) => {
    responses.set((options!.params as { projectId: number }).projectId, resolve)
  }))
  state.projects.value = [{ id: 257, name: 'First' }, { id: 258, name: 'Second' }]
  const first = state.loadDocuments(257)
  await Promise.resolve()
  state.selectedProjectId.value = 258
  const second = state.loadDocuments(258)
  await Promise.resolve()
  responses.get(258)!({ code: 0, data: { items: [{ id: 2 }], total: 1 } })
  await second
  responses.get(257)!({ code: 0, data: { items: [{ id: 1 }], total: 7 } })
  await first
  assert.equal(state.documents.value[0].id, 2)
  assert.equal(state.documentTotal.value, 1)
  assert.equal(state.projectDocumentCount({ id: 257, documentCount: 900 }), '—', 'unfiltered aggregate must never be used')
  const failure = state.loadDocuments(258)
  await Promise.resolve()
  responses.get(258)!({ code: 503, data: { items: [], total: 0 } })
  await failure
  assert.ok(state.documentError.value)
  assert.equal(state.documents.value.length, 0)
  assert.equal(state.projectDocumentCount({ id: 258 }), '—')
  assert.equal(state.downloadUrl({ id: 12, projectId: 258 }), '/aims/api/v1/projects/258/documents/12/download')
})

test('project pagination sends actual page/pageSize and all requests and project links use moduleUrl', async () => {
  const calls: { path: string, options?: Record<string, unknown> }[] = []
  const state = setup(async (path, options) => {
    calls.push({ path, options })
    return { code: 0, data: { items: [], total: 0 } }
  })
  state.projectPage.value = 3
  await state.loadProjectPage()
  assert.equal(calls[0]!.path, '/aims/api/v1/projects')
  assert.equal((calls[0]!.options!.params as { page: number }).page, 3)
  assert.equal((calls[0]!.options!.params as { pageSize: number }).pageSize, 20)
  const page = read('../app/pages/project-documents.vue')
  assert.match(page, /UPagination\s+v-model:page="projectPage"/)
  assert.match(page, /共 {{ projectTotal }} 条/)
  assert.match(page, /:to="moduleUrl\(`/)
  assert.match(page, /CommonEmptyState/)
  assert.doesNotMatch(page, /pageSize: 500|project\.documentCount \|\|/)
})
