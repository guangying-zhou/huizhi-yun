import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { isTimeEntryReviewVersionConflict, timeEntryReviewErrorMessage } from '../app/utils/timeEntryReviewError'

const page = readFileSync(new URL('../app/pages/projects/[id]/timesheet.vue', import.meta.url), 'utf8')
const script = page.split('<script setup lang="ts">')[1]!.split('</script>')[0]!
const ast = ts.createSourceFile('page.ts', script, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const funcs = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['openReviewConfirmation', 'submitReviewDecision'].includes(node.name?.text || '')).map(node => node.getText(ast)).join('\n')

test('Host review requires approve and submits the selected row versions with a stable intent key', async () => {
  const calls: Array<{ body: unknown, headers: unknown }> = []
  const exports: Record<string, (...args: unknown[]) => unknown> = {}
  const canDecideTimesheet = { value: false }, reviewModalOpen = { value: false }, reviewAction = { value: 'approve' }, reviewReason = { value: '' }
  const selectedReviewEntryIds = { value: [7] }, selectedReviewCount = { value: 1 }, reviewSubmitting = { value: false }
  const code = ts.transpileModule(`${funcs}\nexports.open = openReviewConfirmation; exports.submit = submitReviewDecision`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  let completed = 0
  runInNewContext(code, { exports, hosted: true, canDecideTimesheet, reviewModalOpen, reviewAction, reviewReason, selectedReviewEntryIds, selectedReviewCount, reviewSubmitting,
    reviewEntries: { value: [{ id: 7, rowVersion: 3, reviewStatus: 'submitted' }] }, projectId: { value: 12 },
    moduleUrl: (path: string) => path, workTimeIntents: {}, reviewIntents: { headers: () => ({ 'Idempotency-Key': 'stable-1' }), complete: () => completed++ },
    $fetch: async (_path: string, options: { body: unknown, headers: unknown }) => {
      calls.push(options)
      return {}
    },
    toast: { add: () => {} }, loadReviewQueue: async () => {}, loadEntries: async () => {}, console, Promise })
  exports.open!('approve')
  await exports.submit!()
  assert.equal(calls.length, 0)
  canDecideTimesheet.value = true
  exports.open!('approve')
  assert.equal(reviewModalOpen.value, true)
  await exports.submit!()
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0]!.body)), { action: 'approve', entries: [{ id: 7, rowVersion: 3 }], reason: '' })
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0]!.headers)), { 'Idempotency-Key': 'stable-1' })
  assert.equal(completed, 1)
  assert.match(page, /v-if="canDecideTimesheet"\s+v-model:open="reviewModalOpen"/)
  assert.doesNotMatch(page, /工时审核暂不可用/)
})

test('a review version conflict clears selection and refreshes the queue and current entries', async () => {
  const exports: Record<string, () => Promise<void>> = {}
  const selectedReviewEntryIds = { value: [7] }, reviewModalOpen = { value: true }, reviewSubmitting = { value: false }
  const messages: string[] = [], reads: string[] = []
  const error = { statusCode: 409, data: { data: { code: 'time_entry_review_version_conflict' } } }
  const code = ts.transpileModule(`${funcs}\nexports.submit = submitReviewDecision`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(code, {
    exports, hosted: true, canDecideTimesheet: { value: true }, reviewModalOpen,
    reviewAction: { value: 'approve' }, reviewReason: { value: '' }, selectedReviewEntryIds,
    selectedReviewCount: { value: 1 }, reviewSubmitting,
    reviewEntries: { value: [{ id: 7, rowVersion: 3, reviewStatus: 'submitted' }] }, projectId: { value: 12 },
    moduleUrl: (path: string) => path,
    reviewIntents: { headers: () => ({ 'Idempotency-Key': 'stable-1' }), complete: () => {} },
    $fetch: async () => { throw error },
    timeEntryReviewErrorMessage, isTimeEntryReviewVersionConflict,
    toast: { add: ({ title }: { title: string }) => messages.push(title) },
    loadReviewQueue: async () => { reads.push('queue') },
    loadEntries: async () => { reads.push('entries') },
    console: { error: () => {} }, Promise
  })
  await exports.submit!()
  assert.deepEqual(messages, ['所选工时已被他人处理或已变更，列表已刷新，请重新确认'])
  assert.equal(reviewModalOpen.value, false)
  assert.equal(selectedReviewEntryIds.value.length, 0)
  assert.deepEqual(reads, ['queue', 'entries'])
  assert.equal(reviewSubmitting.value, false)
})
