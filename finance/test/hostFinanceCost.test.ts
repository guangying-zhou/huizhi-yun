import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { ref, computed } from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import type { useFinanceCostDetail } from '../app/composables/useFinanceCostDetail.ts'
import * as cost from '../app/utils/hostFinanceCost.ts'

const preview: cost.CostPreview = { projectCode: 'P1', periodMonth: '2026-10', expectedVersion: 2, inputHash: 'a'.repeat(64), currency: 'CNY', laborCostAmount: '75.00', readiness: 'ready', missingInputs: [], batchCode: 'batch-1', closed: false }
test('cost requests freeze exact CAS and key, and only explicit adoption creates a fresh intent', () => {
  let n = 0
  const command = cost.createCostCommand(() => `key-${++n}`)
  const first = command.freeze('recalculate', preview)
  const retry = command.freeze('recalculate', { ...preview, expectedVersion: 99, inputHash: 'b'.repeat(64) })
  assert.equal(retry, first)
  assert.deepEqual(retry.body, { expectedVersion: 2, expectedInputHash: 'a'.repeat(64) })
  assert.equal(retry.key, 'key-1')
  command.reset()
  assert.equal(command.freeze('recalculate', { ...preview, expectedVersion: 99 }).key, 'key-2')
  assert.match(cost.costWriteMessage({ statusCode: 409 }), /刷新最新预览.*选择已保留/)
  assert.match(cost.costWriteMessage(new Error('fetch /internal')), /结果未确认.*同一请求/)
  assert.deepEqual(cost.costReasons(['missing_aims_time_entries']), ['尚无工时，需确认零投入'])
  assert.equal(cost.costMoney(null), '—')
  assert.equal(cost.costPercent('0.1234'), '12.34%')
  assert.equal(cost.costPercent('-1.0625'), '-106.25%')
})
function detailHarness() {
  const exports: { useFinanceCostDetail?: (...args: Parameters<typeof useFinanceCostDetail>) => ReturnType<typeof useFinanceCostDetail> } = {}
  const source = readFileSync(new URL('../app/composables/useFinanceCostDetail.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const requests: Array<{ url: string, body: unknown, headers: unknown }> = []
  const messages: string[] = []
  const confirmations: string[] = []
  let failure = 0, version = 2, confirmed = true
  runInNewContext(js, {
    exports, require: (path: string) => path.includes('useFinanceModule') ? { useFinanceModule: () => ({ apiUrl: (p: string) => `/finance/api/v1${p}`, sessionScope: ref('actor-1') }) } : cost,
    ref, computed, watch: () => {}, onScopeDispose: () => {},
    useToast: () => ({ add: (m: { title: string }) => messages.push(m.title) }),
    useConfirm: () => ({ confirm: async (options: { message: string }) => {
      confirmations.push(options.message)
      return confirmed
    } }),
    $fetch: async (url: string, options: { method?: string, body?: unknown, headers?: unknown }) => {
      if (options.method === 'POST') {
        requests.push({ url, body: structuredClone(options.body), headers: structuredClone(options.headers) })
        if (failure) throw { statusCode: failure }
        return {}
      }
      if (url.endsWith('/preview')) return { data: { ...preview, expectedVersion: version, inputHash: (version === 2 ? 'a' : 'b').repeat(64) } }
      if (url.endsWith('/history')) return { data: [], total: 0, page: 1, pageSize: 20 }
      if (url.includes('/history/')) return { data: { code: url.split('/').at(-1), labor_cost_amount: '75.00' } }
      return { data: { row_version: version } }
    }
  })
  const project = ref('P1'), month = ref('2026-10'), allowed = ref(true), admin = ref(true)
  return { state: exports.useFinanceCostDetail!(project, month, allowed, admin), requests, messages, confirmations, project, month, admin, fail: (status: number) => {
    failure = status
  }, version: (value: number) => {
    version = value
  }, confirm: (value: boolean) => {
    confirmed = value
  } }
}
test('409 refreshes comparison while preserving period, original CAS and selected historical batches', async () => {
  const h = detailHarness(), s = h.state
  await s.refresh()
  s.choose('old-1')
  s.choose('old-2')
  h.version(3)
  h.fail(409)
  await s.execute('recalculate')
  assert.equal(s.conflict.value, true)
  assert.equal(s.preview.value.expectedVersion, 3)
  assert.equal(s.frozen.value.body.expectedVersion, 2)
  assert.deepEqual([...s.selected.value], ['old-1', 'old-2'])
  assert.equal(s.compared.value.length, 2)
  assert.equal(h.month.value, '2026-10')
  assert.equal(h.project.value, 'P1')
  assert.equal(s.saving.value, false)
  await s.execute('recalculate')
  assert.equal(h.requests.length, 1, 'conflict cannot silently retry new inputs')
  h.confirm(false)
  await s.adoptLatest()
  assert.equal(s.conflict.value, true)
  h.confirm(true)
  await s.adoptLatest()
  h.fail(0)
  await s.execute('recalculate')
  assert.deepEqual(h.requests[1]!.body, { expectedVersion: 3, expectedInputHash: 'b'.repeat(64) })
  assert.notDeepEqual(h.requests[0]!.headers, h.requests[1]!.headers)
  assert.equal(s.frozen.value, null)
  assert.match(h.confirmations[0]!, /项目「P1」2026-10.*完整替换/)
})
test('uncertain response retries original payload/key, cancellation and missing admin cannot write', async () => {
  const h = detailHarness(), s = h.state
  await s.refresh()
  h.confirm(false)
  await s.execute('recalculate')
  assert.equal(h.requests.length, 0)
  h.confirm(true)
  h.fail(503)
  await s.execute('recalculate')
  h.version(99)
  await s.refresh()
  h.fail(0)
  await s.execute('recalculate')
  assert.deepEqual(h.requests[0]!.body, h.requests[1]!.body)
  assert.deepEqual(h.requests[0]!.headers, h.requests[1]!.headers)
  h.admin.value = false
  await s.execute('close')
  assert.equal(h.requests.length, 2)
})
test('all cost SFCs compile with mobile cards, explicit states and no native confirmation', () => {
  for (const name of ['FinanceCostList', 'FinanceCostDetail', 'FinanceCostRecord']) {
    const filename = `${name}.vue`
    const source = readFileSync(new URL(`../app/components/host/${filename}`, import.meta.url), 'utf8')
    const { descriptor } = parse(source, { filename })
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    assert.match(source, /权限加载失败/)
    assert.match(source, /无权限/)
    assert.match(source, /CommonEmptyState/)
    assert.doesNotMatch(source, /window\.(confirm|alert)\(/)
  }
  for (const filename of ['project-accounting', 'project-accounting-detail', 'cost-allocations', 'cost-allocation-detail', 'employee-costs', 'employee-cost-detail']) {
    const source = readFileSync(new URL(`../layer/pages/${filename}.vue`, import.meta.url), 'utf8')
    const { descriptor } = parse(source)
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  }
  const list = readFileSync(new URL('../app/components/host/FinanceCostList.vue', import.meta.url), 'utf8')
  assert.match(list, /:loading="pending"/)
  assert.match(list, /#empty/)
  assert.match(list, /UPagination/)
  assert.match(list, /共.*total.*条/)
  assert.match(list, /sm:hidden/)
})

test('cost permission state distinguishes loading, load failure and denied joint salary access', async () => {
  const source = readFileSync(new URL('../app/composables/useFinanceCostAccess.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  async function access(sensitive: boolean, financeAdmin: boolean, peopleView: boolean, failed = false, loaded = true) {
    const exports: { useFinanceCostAccess?: (sensitive: boolean) => { allowed: { value: boolean }, permissionLoaded: { value: boolean }, permissionError: { value: boolean } } } = {}
    const calls: string[] = []
    runInNewContext(js, {
      exports, ref, computed,
      require: (path: string) => path.includes('useFinanceModule') ? { useFinanceModule: () => ({ hosted: true, sessionScope: ref('person') }) } : path.includes('authorizationSnapshotSource') ? { parseAuthorizationSnapshotResponse: (raw: unknown) => raw } : { authorizationResourcesAllow: () => peopleView },
      usePermissions: () => ({ loaded: ref(loaded), error: ref(!loaded && failed), hasPermission: (_r: string, a: string) => a === 'admin' ? financeAdmin : true, loadPermissions: async () => {} }),
      watch: (_source: unknown, callback: () => void, options?: { immediate?: boolean }) => { if (options?.immediate) callback() },
      onMounted: () => {}, onScopeDispose: () => {},
      $fetch: async (url: string) => {
        calls.push(url)
        if (failed) throw new Error('dependency')
        return { resources: {}, actionPolicies: {} }
      }
    })
    const state = exports.useFinanceCostAccess!(sensitive)
    await new Promise(resolve => setImmediate(resolve))
    return { state, calls }
  }
  const waiting = await access(false, false, false, false, false)
  assert.equal(waiting.state.permissionLoaded.value, false)
  assert.equal(waiting.state.allowed.value, false)
  const loadFailure = await access(false, false, false, true, false)
  assert.equal(loadFailure.state.permissionError.value, true)
  const denied = await access(true, false, true)
  assert.equal(denied.state.allowed.value, false)
  assert.equal(denied.calls.length, 0, 'no salary snapshot before Finance admin')
  const noPeople = await access(true, true, false)
  assert.equal(noPeople.state.allowed.value, false)
  assert.equal(noPeople.state.permissionError.value, false, 'denied is not a load failure')
  const unavailable = await access(true, true, true, true)
  assert.equal(unavailable.state.permissionError.value, true)
  assert.equal(unavailable.state.allowed.value, false)
  const joint = await access(true, true, true)
  assert.equal(joint.state.allowed.value, true)
  assert.deepEqual(joint.calls, ['/enterprise/api/auth/permissions'])
  const publicOnly = await access(false, false, false)
  assert.equal(publicOnly.state.allowed.value, true)
  assert.equal(publicOnly.calls.length, 0)
})
