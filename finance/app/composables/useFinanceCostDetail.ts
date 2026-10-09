import { useFinanceModule } from '../../layer/useFinanceModule'
import { createCostCommand, costErrorStatus, costReadMessage, costWriteMessage, type CostPreview, type CostRow, type CostPage, type CostAction } from '../utils/hostFinanceCost'

export function useFinanceCostDetail(project: Ref<string>, month: Ref<string>, allowed: Ref<boolean>, admin: Ref<boolean>) {
  const { apiUrl, sessionScope } = useFinanceModule()
  const toast = useToast(), { confirm } = useConfirm()
  const summary = ref<CostRow | null>(null), preview = ref<CostPreview | null>(null), period = ref<CostRow | null>(null)
  const pending = ref(false), saving = ref(false), error = ref(''), previewError = ref(''), historyError = ref('')
  const history = ref<CostRow[]>([]), historyTotal = ref(0), historyPage = ref(1), historyPending = ref(false), historyPageSize = 20
  const selected = ref<string[]>([]), compared = ref<CostRow[]>([]), compareError = ref(''), comparePending = ref(false)
  const command = createCostCommand()
  const frozen = ref<ReturnType<typeof command.current>>(null), conflict = ref(false)
  let generation = 0, historyGeneration = 0, compareGeneration = 0
  const base = () => `/project-accounting/${encodeURIComponent(project.value)}`
  async function refresh() {
    const epoch = ++generation
    error.value = ''
    previewError.value = ''
    pending.value = false
    summary.value = null
    period.value = null
    preview.value = null
    if (!allowed.value)
      return
    pending.value = true
    const query = { periodMonth: month.value }
    try {
      const [s, p] = await Promise.all([$fetch<{
        data: CostRow | null
      }>(apiUrl(base()), { query, retry: 0 }), $fetch<{
        data: CostRow | null
      }>(apiUrl(`${base()}/period`), { query, retry: 0 })])
      if (epoch !== generation || !allowed.value)
        return
      summary.value = s.data
      period.value = p.data
    } catch (failure) {
      if (epoch === generation)
        error.value = costReadMessage(failure)
    }
    if (admin.value && epoch === generation) {
      try {
        const response = await $fetch<{
          data: CostPreview
        }>(apiUrl(`${base()}/preview`), { query, retry: 0 })
        if (epoch === generation && allowed.value && admin.value)
          preview.value = response.data
      } catch (failure) {
        if (epoch === generation)
          previewError.value = costReadMessage(failure)
      }
    }
    if (epoch === generation)
      pending.value = false
  }
  async function loadHistory() {
    const epoch = ++historyGeneration
    history.value = []
    historyTotal.value = 0
    historyError.value = ''
    historyPending.value = false
    if (!allowed.value)
      return
    historyPending.value = true
    try {
      const response = await $fetch<CostPage>(apiUrl(`${base()}/history`), { query: { periodMonth: month.value, page: historyPage.value, pageSize: historyPageSize }, retry: 0 })
      if (epoch !== historyGeneration || !allowed.value)
        return
      if (!Array.isArray(response.data) || response.page !== historyPage.value || response.pageSize !== historyPageSize || !Number.isSafeInteger(response.total))
        throw new Error('Invalid history page')
      history.value = response.data
      historyTotal.value = response.total
    } catch (failure) {
      if (epoch === historyGeneration)
        historyError.value = costReadMessage(failure)
    } finally {
      if (epoch === historyGeneration)
        historyPending.value = false
    }
  }
  function choose(code: string) {
    selected.value = selected.value.includes(code) ? selected.value.filter(c => c !== code) : [...selected.value.slice(-1), code]
  }
  async function compare() {
    const epoch = ++compareGeneration
    compareError.value = ''
    compared.value = []
    if (!allowed.value || selected.value.length !== 2)
      return
    comparePending.value = true
    const codes = [...selected.value]
    try {
      const rows = await Promise.all(codes.map(code => $fetch<{
        data: CostRow | null
      }>(apiUrl(`${base()}/history/${encodeURIComponent(code)}`), { query: { periodMonth: month.value }, retry: 0 })))
      if (epoch !== compareGeneration || !allowed.value || JSON.stringify(codes) !== JSON.stringify(selected.value))
        return
      if (rows.some(r => !r.data))
        throw new Error('Missing history')
      compared.value = rows.map(r => r.data!)
    } catch (failure) {
      if (epoch === compareGeneration)
        compareError.value = costReadMessage(failure)
    } finally {
      if (epoch === compareGeneration)
        comparePending.value = false
    }
  }
  watch(selected, () => {
    compareGeneration++
    compared.value = []
    compareError.value = ''
    comparePending.value = false
  })
  async function adoptLatest() {
    if (!conflict.value || !preview.value || saving.value)
      return
    if (!(await confirm({ tone: 'warning', title: '采用最新预览', message: `项目「${project.value}」${month.value}：放弃已拒绝的旧版本请求，按当前预览重新确认操作。` })))
      return
    command.reset()
    frozen.value = null
    conflict.value = false
  }
  async function execute(action: CostAction) {
    if (!admin.value || saving.value || pending.value || conflict.value || !preview.value)
      return
    if (frozen.value && frozen.value.action !== action)
      return
    const labels = { 'recalculate': '重算项目成本', 'confirm-zero': '确认零投入', 'close': '关闭成本核算期' }
    const candidate = frozen.value?.preview || preview.value
    const context = JSON.stringify([project.value, month.value, sessionScope?.value])
    const consequences = { 'recalculate': '完整替换本月托管人力分摊，保留其它来源；缺少输入时撤销旧人力分摊并清空毛利。历史批次保留。', 'confirm-zero': '确认该项目本月没有工时；新增工时会使此确认失效。', 'close': '冻结当前成本期，此后不能确认零投入或重算，不能直接重新开放。' }
    if (!(await confirm({ tone: 'warning', title: labels[action], message: `项目「${project.value}」${month.value}：${consequences[action]}\n预览人力成本：${candidate.laborCostAmount ?? '未就绪'} ${candidate.currency || ''}` })))
      return
    if (!allowed.value || !admin.value || context !== JSON.stringify([project.value, month.value, sessionScope?.value])) return
    const request = command.freeze(action, candidate)
    frozen.value = request
    saving.value = true
    try {
      await $fetch(apiUrl(`/project-accounting/${encodeURIComponent(request.preview.projectCode)}/${request.action}`), { method: 'POST', query: { periodMonth: request.preview.periodMonth }, body: request.body, headers: { 'Idempotency-Key': request.key }, retry: 0 })
      if (context !== JSON.stringify([project.value, month.value, sessionScope?.value])) return
      command.reset()
      frozen.value = null
      conflict.value = false
      toast.add({ title: `${labels[action]}成功`, color: 'success' })
      await Promise.all([refresh(), loadHistory()])
    } catch (failure) {
      if (context !== JSON.stringify([project.value, month.value, sessionScope?.value])) return
      toast.add({ title: costWriteMessage(failure), color: 'error' })
      if (costErrorStatus(failure) === 409) {
        conflict.value = true
        // Retain original request, project/month and selected history codes.
        await Promise.all([refresh(), loadHistory()])
        if (selected.value.length === 2)
          await compare()
      }
    } finally {
      saving.value = false
    }
  }
  watch(() => [project.value, month.value, sessionScope?.value, allowed.value, admin.value], () => {
    command.reset()
    frozen.value = null
    conflict.value = false
    selected.value = []
    compared.value = []
    historyPage.value = 1
    void refresh()
  }, { immediate: true })
  watch(() => [allowed.value, project.value, month.value, historyPage.value, sessionScope?.value], () => {
    void loadHistory()
  }, { immediate: true })
  onScopeDispose(() => {
    generation++
    historyGeneration++
    compareGeneration++
  })
  return { summary, preview, period, pending, saving, error, previewError, history, historyTotal, historyPage, historyPageSize, historyPending, historyError, selected, compared, comparePending, compareError, frozen, conflict, refresh, loadHistory, choose, compare, adoptLatest, execute }
}
