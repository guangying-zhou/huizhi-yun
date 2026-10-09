import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { ref, computed, reactive, watch, nextTick } from 'vue'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'
import * as receivables from '../app/utils/financeReceivables.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { allocationPayload, receivableMessage, receivableReadMessage, receivableStatusLabel, type ReceivableFact } from '../app/utils/financeReceivables.ts'

test('allocation preserves versions and selected targets across pages, rejects malformed amounts', () => {
  const candidates = [{ code: 'BS1', contract_code: 'CT1', name: '第一行', outstanding_amount: '60.00', row_version: 3 }, { code: 'BS2', contract_code: 'CT2', name: '第二行', outstanding_amount: '40.00', row_version: 4 }]
  assert.deepEqual(allocationPayload(9, candidates, { BS1: '60.00', BS2: '40.00' }), { receiptVersion: 9, items: [{ contractCode: 'CT1', billingScheduleCode: 'BS1', scheduleVersion: 3, amount: '60.00' }, { contractCode: 'CT2', billingScheduleCode: 'BS2', scheduleVersion: 4, amount: '40.00' }] })
  assert.throws(() => allocationPayload(9, candidates, {}))
  assert.throws(() => allocationPayload(9, candidates, { BS1: '0.123' }))
})
test('continuation and separation failures are explicit and drafts remain visible', () => {
  assert.match(receivableMessage({ data: { code: 'finance_before_opening_cutoff' } }), /历史回款不参与/)
  assert.match(receivableMessage({ data: { code: 'finance_adjustment_self_confirmation_denied' } }), /录入人不能/)
  assert.match(receivableMessage({ statusCode: 409 }), /保留/)
  const source = readFileSync(new URL('../app/components/host/FinanceReceivablesPage.vue', import.meta.url), 'utf8')
  for (const token of ['CommonEmptyState', ':loading="pending"', '#empty', 'useDebouncedSearch', 'useConfirm', 'Idempotency-Key', 'receivableMessage(failure)', '共 {{ total }} 条']) assert.ok(source.includes(token), token)
})
test('sensitive adjustment permissions have separate manifest roles and no admin implication', () => {
  const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8'))
  const admin = manifest.recommendedRoles.find((role: { code: string }) => role.code === 'finance:admin')
  const manager = manifest.recommendedRoles.find((role: { code: string }) => role.code === 'finance:manager')
  assert.ok(admin.suggestedPermissions.includes('finance:receivable_adjustments:edit'))
  assert.ok(!admin.suggestedPermissions.includes('finance:receivable_adjustments:confirm'))
  assert.ok(manager.suggestedPermissions.includes('finance:receivable_adjustments:confirm'))
  assert.ok(!manager.suggestedPermissions.includes('finance:receivable_adjustments:edit'))
})

test('unexpected transport errors never leak raw English paths as local validation', () => {
  assert.equal(receivableMessage(new TypeError('fetch failed /private/internal/path')), '保存结果未确认，可能已提交，重试将沿用同一请求安全续行；草稿已保留')
})

test('all receivable fact states have Chinese labels', () => {
  for (const state of ['draft', 'confirmed', 'active', 'reversed']) assert.notEqual(receivableStatusLabel(state), '未知状态')
  assert.equal(receivableStatusLabel('active'), '有效')
})

test('read failures never imply an uncertain save, and use the business error code', () => {
  assert.equal(receivableReadMessage({ status: 404, data: { data: { code: 'finance_object_not_found' } } }), '未找到此合同的保全映射')
  assert.match(receivableReadMessage({ status: 409, data: { data: { code: 'finance_opening_evidence_changed' } } }), /净期初证据/)
  assert.equal(receivableReadMessage(new TypeError('fetch failed /private')), '读取失败，请重试')
})

test('continuation is a paginated list to detail, and each detail SFC compiles', () => {
  const file = 'FinanceReceivablesPage.vue'
  const source = readFileSync(new URL(`../app/components/host/${file}`, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename: file })
  const script = compileScript(descriptor, { id: file })
  assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: file, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  assert.match(source, /Promise\.allSettled/)
  assert.match(source, /watch\(code/)
  assert.match(source, /row\.value = null/)
  assert.match(source, /history\.value = \[\]/)
  assert.match(source, /objectCode !== code\.value/)
  assert.match(source, /待核验[\s\S]*pending/)
  assert.match(source, /opening_amount.*净期初/)
  assert.match(source, /cutoff_date.*快照日/)
  const entry = readFileSync(new URL('../layer/entry.mjs', import.meta.url), 'utf8')
  assert.match(entry, /historical-finance\/:code/)
})

function continuationHarness() {
  const route = reactive({ params: { code: 'CT1' } })
  let historyFailure = false
  const waiting = new Map<string, (value: unknown) => void>()
  let delay = false
  const requests: string[] = []
  const source = parse(readFileSync(new URL('../app/components/host/FinanceReceivablesPage.vue', import.meta.url), 'utf8')).descriptor.scriptSetup!.content
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const context = {
    exports: {}, require: (path: string) => path.includes('financeReceivables') ? receivables : path.includes('hostFinanceForms') ? { createFinanceIntent: () => ({ key: () => 'key', reset: () => {} }) } : { useFinanceModule: () => ({ hosted: true, moduleUrl: (p: string) => p, apiUrl: (p: string) => p }) },
    defineEmits: () => () => {}, defineExpose: () => {}, useAuth: () => ({ user: ref('reviewer') }),
    defineProps: () => ({ mode: 'continuation' }), useRoute: () => route,
    ref, reactive, computed, watch, onMounted: () => {}, onScopeDispose: () => {},
    usePermissions: () => ({ loaded: ref(true), error: ref(''), hasPermission: () => true, loadPermissions: () => {} }),
    useConfirm: () => ({ confirm: async () => true }), useToast: () => ({ add: () => {} }),
    useDebouncedSearch: () => ({ search: ref(''), debounced: ref(''), flush: () => {} }),
    $fetch: async (url: string) => {
      requests.push(url)
      if (url.endsWith('/history')) {
        if (historyFailure) throw { status: 404 }
        return { data: { items: [], total: 0 } }
      }
      if (delay) return await new Promise(resolve => waiting.set(url, resolve))
      return { data: { code: url.split('/').at(-1), opening_amount: '100.00', evidence_sha256: 'evidence', row_version: 1 } }
    },
    state: undefined as unknown as { row: { value: ReceivableFact | null }, error: { value: string }, historyError: { value: string }, load: () => Promise<void> }
  }
  runInNewContext(`${js}\nstate = { row, error, historyError, load };`, context)
  return { route, state: context.state, requests, waiting, failHistory: () => {
    historyFailure = true
  }, delay: () => {
    delay = true
  } }
}
test('failed preserved history does not hide opening overview or claim a write failure', async () => {
  const h = continuationHarness()
  h.failHistory()
  await h.state.load()
  assert.equal(h.state.row.value?.opening_amount, '100.00')
  assert.equal(h.state.error.value, '')
  assert.equal(h.state.historyError.value, '读取失败，请重试')
  assert.ok(h.requests.every(url => !url.endsWith('/activate')))
})
test('switching contracts clears prior detail and ignores late responses from the previous contract', async () => {
  const h = continuationHarness()
  await h.state.load()
  h.delay()
  const old = h.state.load()
  h.route.params.code = 'CT2'
  assert.equal(h.state.row.value, null)
  await nextTick()
  h.waiting.get('/historical-finance/CT2')!({ data: { code: 'CT2', opening_amount: '200.00' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  h.waiting.get('/historical-finance/CT1')!({ data: { code: 'CT1', opening_amount: '100.00' } })
  await old
  assert.equal(h.state.row.value?.code, 'CT2')
})
