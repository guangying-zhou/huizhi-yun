import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ref, shallowRef, computed, watch, effectScope, onScopeDispose } from 'vue'
import type { useTimeEntryPage } from '../app/composables/useTimeEntryPage'
import { isTimeEntryPage } from '../app/utils/timeEntryPagination'

const code = ts.transpileModule(readFileSync(new URL('../app/composables/useTimeEntryPage.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

test('time-entry reads discard superseded, revoked and disposed responses; failure has no editing baseline', async () => {
  const identity = ref('U1'), verified = ref('scope1')
  const pending: Array<{ resolve: (value: unknown) => void, reject: (err: Error) => void, signal: AbortSignal }> = []
  const exports: Record<string, typeof useTimeEntryPage> = {}
  const scope = effectScope()
  runInNewContext(code, { exports, ref, shallowRef, computed, watch, AbortController,
    onScopeDispose,
    useNotifications: () => ({ cacheFingerprint: identity }), useState: () => verified,
    $fetch: (_path: string, options: { signal: AbortSignal }) => new Promise((resolve, reject) => pending.push({ resolve, reject, signal: options.signal })),
    require: (name: string) => name.includes('timeEntryPagination') ? { isTimeEntryPage } : { useAimsModule: () => ({ hosted: true }) }
  })
  const controller = scope.run(() => exports.useTimeEntryPage!())!
  const response = (total: number) => ({ code: 0, data: { items: [], page: 1, pageSize: 20, total, summary: { totalHours: total, monthHours: total, todayHours: 0, weekHours: 0, positiveDays: 0, monthPositiveDays: 0, monthMissingDays: 0, dailyHours: [], dailyProjectHours: [], baseDailyProjectHours: [], weeklyHours: [], projectHours: [], weekStatusCounts: { draft: 0, submitted: 0, returned: 0, approved: 0 } } } })
  const first = controller.read('/entries', { page: 1, pageSize: 20 })
  const second = controller.read('/entries', { page: 1, pageSize: 20 })
  assert.equal(pending[0]!.signal.aborted, true)
  pending[1]!.resolve(response(110))
  await second
  pending[0]!.resolve(response(999))
  await first
  assert.equal(controller.data.value.total, 110)
  const revoked = controller.read('/entries', { page: 1 })
  verified.value = 'scope2'
  assert.equal(controller.data.value, null)
  assert.equal(pending[2]!.signal.aborted, true)
  pending[2]!.resolve(response(999))
  await revoked
  assert.equal(controller.data.value, null)
  const failed = controller.read('/entries', { page: 1 })
  pending[3]!.reject(new Error('503'))
  await failed
  assert.equal(controller.error.value, true)
  assert.equal(controller.data.value, null)
  const disposed = controller.read('/entries', { page: 1 })
  scope.stop()
  pending[4]!.resolve(response(999))
  await disposed
  assert.equal(controller.data.value, null)
  identity.value = ''
  await controller.read('/entries', { page: 1 })
  assert.equal(pending.length, 5)
})
