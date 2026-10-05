import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../app/pages/weekly-reports.vue', import.meta.url), 'utf8').split('<script setup lang="ts">')[1]!.split('</script>')[0]!
const ast = ts.createSourceFile('weekly-reports.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const funcs = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['loadDirectorWorkbench', 'loadDirectorWorkbenchOnce', 'selectWeek', 'nextWeek'].includes(node.name?.text || '')).map(node => node.getText(ast)).join('\n')

test('four overlapping week reads issue one director workbench request and a new week issues another', async () => {
  let count = 0
  const periodKey = { value: '2026-W40' }, fingerprint = { value: 'user-v1' }
  const exports: Record<string, () => Promise<void>> = {}
  const code = ts.transpileModule(`let workbenchRequestSeq=0, directorWorkbenchInFlight=null, directorWorkbenchLoadedKey=''; ${funcs}; exports.load=loadDirectorWorkbench`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, { exports, periodKey, summaryRead: { fingerprint }, canReviewWeeklyReports: { value: true }, directorWorkbenchItems: { value: [] }, directorPeriodReady: { value: false }, directorWorkbenchLoading: { value: false }, moduleUrl: (p: string) => p,
    $fetch: async () => {
      count++
      await new Promise(resolve => setTimeout(resolve, 5))
      return { data: { items: [] } }
    }, Promise })
  await Promise.all(Array.from({ length: 4 }, () => exports.load!()))
  assert.equal(count, 1)
  await exports.load!()
  assert.equal(count, 1)
  periodKey.value = '2026-W41'
  await exports.load!()
  assert.equal(count, 2)
})

test('right-arrow week change reads an ungenerated director period only once despite a second same-week read', async () => {
  let count = 0
  const selectedYear = { value: 2026 }, selectedWeek = { value: 39 }
  const yearInput = { value: '2026' }, weekInput = { value: '39' }
  const periodKey = {
    get value() {
      return `${selectedYear.value}-W${String(selectedWeek.value).padStart(2, '0')}`
    }
  }
  const exports: Record<string, () => Promise<void> | void> = {}
  const code = ts.transpileModule(`let workbenchRequestSeq=0, directorWorkbenchInFlight=null, directorWorkbenchLoadedKey=''; ${funcs}; exports.load=loadDirectorWorkbench; exports.next=nextWeek`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, {
    exports, selectedYear, selectedWeek, yearInput, weekInput, periodKey,
    summaryRead: { fingerprint: { value: 'user-v1' } }, canReviewWeeklyReports: { value: true },
    directorWorkbenchItems: { value: [] }, directorPeriodReady: { value: true }, directorWorkbenchLoading: { value: false },
    shiftIsoWeek: (year: number, week: number) => ({ year, week: week + 1 }),
    moduleUrl: (path: string) => path, isWeeklyPeriodNotReady: () => true,
    $fetch: async () => {
      count++
      throw { statusCode: 409 }
    }, Promise
  })
  exports.next!()
  assert.equal(periodKey.value, '2026-W40')
  await exports.load!()
  await exports.load!() // 同周另一处读取或输入框去抖回放，不得重发已知的 409。
  assert.equal(count, 1)
  exports.next!()
  await exports.load!()
  assert.equal(count, 2)
  assert.match(source, /String\(yearInput\.value\) === String\(selectedYear\.value\) && String\(weekInput\.value\) === String\(selectedWeek\.value\)/)
  assert.match(source, /directorWorkbenchLoadedKey = ''\n\s*await loadReports\(\)/)
})
