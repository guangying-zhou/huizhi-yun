import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { weeklyDraftTotals, weeklyDraftWorkload, isWeeklyPeriodPage } from '../app/utils/projectWeeklyReportPagination'
import { timeEntryReadQuery } from '../../foundation/shared/utils/timeEntryReadQuery'

test('complete initialization and keyed draft deltas retain hidden-page rows and full denominator', () => {
  const baseline = Array.from({ length: 107 }, (_, i) => ({ uid: `U${i}`, hours: 8, actualHours: 4, allocationPercent: 100 }))
  const draft = baseline.map(r => ({ ...r })); draft[100]!.hours = 3; draft[100]!.allocationPercent = 37.5
  const totals = weeklyDraftTotals(baseline, draft)
  assert.equal(totals.hours, 851); assert.equal(totals.actual, 428); assert.equal(totals.memberCount, 107)
  assert.equal(totals.averagePercent, 99.42)
  assert.equal(draft.slice(0, 20).length, 20)
  assert.equal(draft.map(r => ({ uid: r.uid, hours: r.hours })).length, 107)
  const work = Array.from({ length: 105 }, (_, i) => ({ id: i + 1, workloadDays: 1 }))
  const changed = work.filter(w => w.id !== 101).map(w => ({ ...w })); changed[0]!.workloadDays = 3
  changed.push({ id: 0, workloadDays: 4 })
  assert.equal(weeklyDraftWorkload(105, work, changed), 110)
  assert.equal(changed.length, 105)
})
test('period page validates bounded member/work identities and independent full facts', () => {
  const raw = { periodKey: '2026-W01', editableByCurrentUser: false, report: null, baseline: null, summary: { persistedWorkloadDays: 0 }, history: {}, entriesPage: { items: ['U1'], total: 107, page: 2, pageSize: 20 }, workItemsPage: { items: [101], total: 105, page: 2, pageSize: 20 } }
  assert.equal(isWeeklyPeriodPage(raw, 2, 20), true)
  assert.equal(isWeeklyPeriodPage(raw, 1, 20), false)
  assert.equal(isWeeklyPeriodPage({ ...raw, workItemsPage: { ...raw.workItemsPage, items: [-1] } }, 2, 20), false)
})
test('UID actual hours require paged project read, never a weekly-report authorization flag', () => {
  assert.equal(timeEntryReadQuery({ page: '1', includeUidHours: '1' }, 'project').includeUidHours, '1')
  for (const q of [{ includeUidHours: '1' }, { page: '1', includeUidHours: '0' }, { page: '1', includeUidHours: ['1', '1'] }]) assert.throws(() => timeEntryReadQuery(q, 'project'))
  assert.throws(() => timeEntryReadQuery({ page: '1', includeUidHours: '1' }, 'user'))
})
test('project view requests real pages while replacement writes serialize complete draft', () => {
  const s = readFileSync(new URL('../app/pages/projects/[id]/weekly-reports.vue', import.meta.url), 'utf8')
  assert.match(s, /includeBaseline: '1'/)
  assert.match(s, /includeUidHours: '1'/)
  assert.match(s, /page: 1, pageSize: 1/)
  assert.match(s, /v-model:page="periodListPage"/)
  assert.match(s, /v-model:page="entriesPage"/)
  assert.match(s, /v-model:page="workPage"/)
  assert.match(s, /entries: allocationRows.value.map/)
  assert.match(s, /workItems: workItems.value/)
  assert.doesNotMatch(s, /entries: visibleAllocations|workItems: visibleWorkItems/)
  assert.match(s, /weeklyDraftTotals\(allocationBaseline.value, allocationRows.value\)/)
  assert.match(s, /weeklyDraftWorkload\(workloadBaselineTotal.value/)
  assert.match(s, /res.data.calendar/)
  assert.match(s, /history.value\?\.cumulativeLaborCost/)
  assert.doesNotMatch(s, /function previousReports/)
  assert.match(s, /summaryRead|initialRead.fingerprint/)
  assert.match(s, /completeBaselineReady.value && !draftFactsChanged.value/)
})

test('actual page functions retain second-page edits and serialize all 107/105 rows', async () => {
  const ts = (await import('typescript')).default
  const { runInNewContext } = await import('node:vm')
  const page = readFileSync(new URL('../app/pages/projects/[id]/weekly-reports.vue', import.meta.url), 'utf8')
  const script = page.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
  const ast = ts.createSourceFile('page.ts', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['saveReport', 'readDetailPage'].includes(node.name?.text || '')).map(node => node.getText(ast)).join('\n')
  const exports: Record<string, () => Promise<void>> = {}
  const rows = Array.from({ length: 107 }, (_, i) => ({ uid: `U${i}`, hours: i === 100 ? 3 : 8, allocationPercent: 100 }))
  const work = Array.from({ length: 105 }, (_, i) => ({ id: i + 1, taskSummary: `Work${i}`, workloadDays: i === 100 ? 5 : 1 }))
  let body: { entries: typeof rows, workItems: typeof work } | undefined
  const identityPages = { periodKey: '2026-W01', report: null, entriesPage: { items: ['U100'], total: 107 }, workItemsPage: { items: [101], total: 105 } }
  const saving = { value: false }, entries = { value: ['U1'] }, workIDs = { value: [1] }
  const code = ts.transpileModule(`${functions}\nexports.save = saveReport; exports.page = () => readDetailPage('entries')`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, {
    exports, saving, canSave: { value: true }, completeBaselineReady: { value: true }, projectId: { value: 1 }, selectedPeriodKey: { value: '2026-W01' },
    mainWork: { value: 'complete' }, overallProgress: { value: '' }, summaryFields: {}, allocationRows: { value: rows }, allocationBaseline: { value: rows }, workItems: { value: work },
    entryUIDs: entries, workIDs, entriesPage: { value: 2 }, workPage: { value: 1 }, detailPageSize: 20,
    memberRead: { read: async () => identityPages }, workRead: { read: async () => identityPages }, selectedReport: { value: null }, draftFactsChanged: { value: false },
    moduleUrl: (s: string) => s, roundHours: (n: number) => n, $fetch: async (_path: string, options: { body: typeof body }) => { body = options.body; return { code: 1 } },
    toast: { add: () => assert.fail('unexpected error') }, console
  })
  await exports.page!()
  assert.equal(entries.value[0], 'U100')
  assert.equal(rows.length, 107); assert.equal(rows[100]!.hours, 3)
  await exports.save!()
  assert.equal(body!.entries.length, 107); assert.equal(body!.entries[100]!.hours, 3)
  assert.equal(body!.workItems.length, 105); assert.equal(body!.workItems[100]!.workloadDays, 5)
  assert.equal(saving.value, false)
})

test('weekly summary and project weekly report Vue templates compile', async () => {
  const { parse, compileTemplate } = await import('vue/compiler-sfc')
  for (const path of ['../app/pages/weekly-reports.vue', '../app/pages/projects/[id]/weekly-reports.vue']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    const parsed = parse(source, { filename: path })
    assert.deepEqual(parsed.errors, [])
    const template = compileTemplate({ source: parsed.descriptor.template!.content, filename: path, id: path })
    assert.deepEqual(template.errors, [], path)
  }
})

test('actual-hour initialization ignores a late response for the same period', async () => {
  const ts = (await import('typescript')).default
  const { runInNewContext } = await import('node:vm')
  const s = readFileSync(new URL('../app/pages/projects/[id]/weekly-reports.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1]!.split('</script>')[0]!
  const ast = ts.createSourceFile('page.ts', s, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'fetchActualHours')!.getText(ast)
  const exports: Record<string, () => Promise<void>> = {}, pending: ((value: unknown) => void)[] = []
  const actual = { value: new Map<string, number>() }
  const context = { exports, selectedGeneration: 1, projectId: { value: 1 }, selectedPeriodKey: { value: '2026-W01' }, selectedWeekYear: { value: 2026 }, selectedWeek: { value: 1 }, initialRead: { fingerprint: { value: 'verified' } }, actualHoursByUid: actual, getWeekRange: () => ({ start: new Date(), end: new Date() }), formatDate: () => '2026-01-01', moduleUrl: (s: string) => s, roundHours: (n: number) => n, $fetch: () => new Promise(resolve => pending.push(resolve)) }
  runInNewContext(ts.transpileModule(`${fn}\nexports.read = fetchActualHours`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const old = exports.read!(); context.selectedGeneration = 2; const latest = exports.read!()
  pending[1]!({ code: 0, data: { summary: { uidHours: [{ uid: 'U1', hours: 2 }] } } }); await latest
  pending[0]!({ code: 0, data: { summary: { uidHours: [{ uid: 'U1', hours: 9 }] } } }); await old
  assert.equal(actual.value.get('U1'), 2)
})
