import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileTemplate } from 'vue/compiler-sfc'
import { isProjectProjection, projectOverviewReadPageSize, readAllProjectPages } from '../app/utils/projectOverviewPagination'

test('overview and timesheet complete Vue templates compile', () => {
  for (const file of ['projects/index.vue', 'timesheet.vue']) {
    const filename = new URL(`../app/pages/${file}`, import.meta.url)
    const { descriptor, errors } = parse(readFileSync(filename, 'utf8'))
    assert.deepEqual(errors, [])
    const compiled = compileTemplate({ filename: filename.pathname, source: descriptor.template!.content, id: file })
    assert.deepEqual(compiled.errors, [])
  }
})
test('project projection validates exact pages, bounded items and independent summary', () => {
  const page = { items: [], total: 107, page: 9, pageSize: 20, summary: { projectCount: 106, portfolioCounts: {}, statusCounts: {}, yearCounts: {}, latestByLine: {} } }
  assert.equal(isProjectProjection(page, 9, 20), true)
  assert.equal(isProjectProjection(page, 8, 20), false)
  assert.equal(isProjectProjection({ ...page, items: Array(21) }, 9, 20), false)
  assert.equal(isProjectProjection({ ...page, summary: undefined }, 9, 20), false)
})
test('Host root and group pages preserve independent reads, server deletion decision and scope invalidation', () => {
  const source = readFileSync(new URL('../app/pages/projects/index.vue', import.meta.url), 'utf8')
  assert.ok(source.includes('projection: \'portfolios\''))
  assert.ok(source.includes('projection: \'projects\''))
  assert.ok(source.includes('currentEditingPortfolio.value?.canDelete === true'))
  assert.ok(source.includes('groupReadPool'))
  assert.ok(source.includes('epoch !== overviewGeneration'))
  assert.ok(source.includes('read.errorStatus.value'))
  assert.ok(source.includes('latestByLine'))
  assert.ok(source.includes('groupTotals'))
  const candidate = readFileSync(new URL('../app/pages/timesheet.vue', import.meta.url), 'utf8')
  assert.ok(candidate.includes('projection: \'candidates\''))
  assert.ok(candidate.includes('pinnedProject'))
  assert.ok(candidate.includes('candidateSearchDebounced'))
  assert.ok(candidate.includes('candidateRead.errorStatus.value'))
})

test('project switcher template compiles', () => {
  const filename = new URL('../app/components/project/ProjectNavbar.vue', import.meta.url)
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'))
  assert.deepEqual(errors, [])
  assert.deepEqual(compileTemplate({ filename: filename.pathname, source: descriptor.template!.content, id: 'navbar' }).errors, [])
})

test('actual group read ignores an obsolete root generation and clears on denial', async () => {
  const ts = (await import('typescript')).default
  const { runInNewContext } = await import('node:vm')
  const source = readFileSync(new URL('../app/pages/projects/index.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1]!.split('</script>')[0]!
  const ast = ts.createSourceFile('overview.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readGroup')!.getText(ast)
  let finish: (value: unknown) => void = () => {}
  const data = { value: {} as Record<string, unknown> }
  const read = { read: () => new Promise((resolve) => {
    finish = resolve
  }), error: { value: false }, errorStatus: { value: 0 } }
  let clears = 0
  const exports: { read?: (id: number) => Promise<void> } = {}
  const context = { exports, readAllProjectPages, projectOverviewReadPageSize, overviewGeneration: 1, groupReads: new Map([[1, read]]), groupData: data, filterPortfolio: { value: 'all' }, groupTotals: { value: {} }, groupErrors: { value: {} }, moduleUrl: (s: string) => s, overviewQuery: () => ({}), projectStore: { normalizeProject: (s: unknown) => s }, rootRead: { clear: () => {
    clears++
  }, error: { value: false }, errorStatus: { value: 0 } }, clearOverview: () => {
    data.value = {}
    clears++
  } }
  runInNewContext(ts.transpileModule(`${fn}\nexports.read=readGroup`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const pending = exports.read!(1)
  context.overviewGeneration = 2
  finish({ items: [{ id: 9 }], total: 1 })
  await pending
  assert.equal(Object.keys(data.value).length, 0)
  const denied = exports.read!(1)
  read.error.value = true
  read.errorStatus.value = 403
  finish(null)
  await denied
  assert.equal(clears, 2)
  assert.equal(Object.keys(data.value).length, 0)
})

test('project overview reads every page sequentially and stops on failure or the page cap', async () => {
  const calls: number[] = []
  const all = await readAllProjectPages(async (page) => {
    calls.push(page)
    return { items: Array.from({ length: page < 3 ? 100 : 7 }, (_, i) => page * 1000 + i), total: 207, page, pageSize: 100 }
  })
  assert.deepEqual(calls, [1, 2, 3])
  assert.equal(all!.items.length, 207)
  assert.equal(await readAllProjectPages(async page => page === 1 ? { items: [1], total: 5, page, pageSize: 1 } : null), null)
  const capped: number[] = []
  await readAllProjectPages(async (page) => {
    capped.push(page)
    return { items: [page], total: 1_000_000, page, pageSize: 1 }
  }, 3)
  assert.deepEqual(capped, [1, 2, 3])
})
