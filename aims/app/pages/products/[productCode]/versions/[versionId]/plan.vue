<script setup lang="ts">
import { useAimsModule } from '../../../../../../layer/useAimsModule'
import ProductsComponentPicker from '../../../../../components/products/ComponentPicker.vue'
import type { ProductRequestRecord } from '../../../../../types/productRequest'

const { moduleUrl, hosted, cacheKey } = useAimsModule()

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '版本计划工作区', layoutHeaderProjectSwitcher: false })

type PlanStatus = 'draft' | 'confirmed' | 'stale'
interface PlanSummary { selectedCount: number, estimatedPersonDays: string | null, unknownEstimateCount: number, remainingPersonDays: string | null, issues: string[] }
interface Plan {
  planningMode: 'simple' | 'cycle'
  planStatus: PlanStatus
  goal: string | null
  startsOn: string | null
  plannedReleaseDate: string | null
  availablePersonDays: string | null
  reservePersonDays: string | null
  workspaceRevision: number
  versionRevision: number
  planRevision: number
  scopeRevision: number
  confirmation: { confirmedAt?: string, confirmedBy?: string } | null
  summary: PlanSummary
  permissions: { canEditPlan: boolean, canCreateScope: boolean, canConfirmPlan: boolean, canDecideRequests: boolean, canHandoff: boolean }
}
interface ScopeItem {
  id: number
  bizId: string
  versionId: number
  planningItemBizId: string | null
  requestBizId: string
  requestTitle: string
  componentId: number | null
  componentName: string | null
  scopeSummary: string
  estimatePersonDays: string | null
  acceptanceCriteria: string | null
  sortOrder: number
  status: string
  revision: number
  handoffCount: number
}
interface ScopePage { items: ScopeItem[], total: number, page: number, pageSize: number, workspaceRevision: number, versionRevision: number, planRevision: number, scopeRevision: number }

const route = useRoute()
const versionPerspectiveQuery = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const code = computed(() => String(route.params.productCode || ''))
const versionId = computed(() => String(route.params.versionId || ''))
const base = computed(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/versions/${encodeURIComponent(versionId.value)}`))
interface VersionSummary { id: number, product_code: string, version_code: string, name: string | null, status: 'planning' | 'developing' | 'released' | 'archived' }
const { data: version } = await useFetch(() => base.value, { ...(hosted ? { key: computed(() => cacheKey('aims/app/pages/products/[productCode]/versions/[versionId]/plan.vue:0' + ':' + String(toValue(() => base.value)))) } : {}),
  server: false,
  transform: (response: { code: number, data: VersionSummary }) => {
    const value = response.data
    return response.code === 0 && value?.product_code === code.value && String(value.id) === versionId.value && ['planning', 'developing', 'released', 'archived'].includes(value.status) ? value : null
  }
})
const scopePage = ref(1)
const scopePageSize = 20
const candidatePage = ref(1)
const candidatePageSize = 10
const candidateComponentId = ref<number | null>(null)
const candidateComponentName = ref('')
const candidateIncludeDescendants = ref(true)
const candidateComponentOpen = ref(false)
const { search: candidateSearch, debounced: candidateKeyword, flush: flushCandidateSearch } = useDebouncedSearch({
  onChange: () => { candidatePage.value = 1 }
})

const planQuery = computed(() => `${base.value}/plan`)
const { data: plan, status: planStatus, error: planError, refresh: refreshPlan } = await useFetch(planQuery, { ...(hosted ? { key: computed(() => cacheKey('aims/app/pages/products/[productCode]/versions/[versionId]/plan.vue:1' + ':' + String(toValue(planQuery)))) } : {}),
  server: false,
  transform: (response: { code: number, data: Plan }) => {
    const value = response.data
    if (response.code !== 0 || !value || !['simple', 'cycle'].includes(value.planningMode) || !['draft', 'confirmed', 'stale'].includes(value.planStatus) || !Number.isSafeInteger(value.workspaceRevision) || value.workspaceRevision < 1 || !Number.isSafeInteger(value.versionRevision) || value.versionRevision < 1 || !Number.isSafeInteger(value.planRevision) || value.planRevision < 1 || !Number.isSafeInteger(value.scopeRevision) || value.scopeRevision < 1 || !value.summary || !Number.isSafeInteger(value.summary.selectedCount) || value.summary.selectedCount < 0 || !Number.isSafeInteger(value.summary.unknownEstimateCount) || value.summary.unknownEstimateCount < 0 || !Array.isArray(value.summary.issues) || !value.permissions || Object.values(value.permissions).some(permission => typeof permission !== 'boolean')) throw new Error('计划工作区响应不完整')
    return value
  }
})
const scopeQuery = computed(() => ({ page: scopePage.value, pageSize: scopePageSize }))
const { data: scopes, status: scopesStatus, error: scopesError, refresh: refreshScopes } = await useFetch(() => `${base.value}/plan/items`, { ...(hosted ? { key: computed(() => cacheKey('aims/app/pages/products/[productCode]/versions/[versionId]/plan.vue:2' + ':' + String(toValue(() => `${base.value}/plan/items`)))) } : {}),
  server: false,
  query: scopeQuery,
  transform: (response: { code: number, data: ScopePage }) => {
    const value = response.data
    if (response.code !== 0 || !value || !Array.isArray(value.items) || !Number.isSafeInteger(value.total) || value.total < 0 || value.page !== scopePage.value || value.pageSize !== scopePageSize || value.items.some(item => !Number.isSafeInteger(item.id) || item.id < 1 || !item.bizId || typeof item.requestBizId !== 'string' || !item.requestBizId || typeof item.requestTitle !== 'string' || typeof item.scopeSummary !== 'string' || !Number.isInteger(item.sortOrder) || !Number.isSafeInteger(item.revision) || item.revision < 1 || !Number.isSafeInteger(item.handoffCount) || item.handoffCount < 0)) throw new Error('版本范围响应不完整')
    return value
  }
})
const candidateQuery = computed(() => ({
  page: candidatePage.value,
  pageSize: candidatePageSize,
  keyword: candidateKeyword.value || undefined,
  componentId: candidateComponentId.value ?? undefined,
  includeDescendants: candidateComponentId.value && candidateIncludeDescendants.value ? 'true' : undefined
}))
const { data: candidates, status: candidatesStatus, error: candidatesError, refresh: refreshCandidates } = await useFetch(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/requests`), { ...(hosted ? { key: computed(() => cacheKey('aims/app/pages/products/[productCode]/versions/[versionId]/plan.vue:3' + ':' + String(toValue(() => moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/requests`))))) } : {}),
  server: false,
  query: candidateQuery,
  transform: (response: { code: number, data: { items: ProductRequestRecord[], total: number } }) => {
    if (response.code !== 0 || !Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < 0 || response.data.items.some(item => item.product_code !== code.value || !item.biz_id || !Number.isSafeInteger(item.revision) || item.revision < 1)) throw new Error('候选需求响应不完整')
    return response.data
  }
})
const planAlert = useApiErrorAlert(planError, { fallbackTitle: '计划工作区加载失败' })
const scopeAlert = useApiErrorAlert(scopesError, { fallbackTitle: '版本范围加载失败' })
const candidateAlert = useApiErrorAlert(candidatesError, { fallbackTitle: '候选需求加载失败' })
const toast = useToast()
const busy = ref(false)
const mutationError = ref<Error | null>(null)
const mutationAlert = useApiErrorAlert(mutationError, { fallbackTitle: '计划保存失败' })
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined

const planDraft = reactive({ goal: '', startsOn: '', plannedReleaseDate: '', availablePersonDays: '', reservePersonDays: '', reason: '' })
const editingPlan = ref(false)
const selectedScope = ref<ScopeItem | null>(null)
const scopeDraft = reactive({ scopeSummary: '', estimatePersonDays: '', acceptanceCriteria: '', sortOrder: 0, reason: '' })
const addingRequest = ref<ProductRequestRecord | null>(null)
const addDraft = reactive({ scopeSummary: '', estimatePersonDays: '', acceptanceCriteria: '', sortOrder: 0, reason: '', adoptRequest: false })
const removing = ref<ScopeItem | null>(null)
const removeReason = ref('')
const addRequestFromLink = computed(() => typeof route.query.addRequest === 'string' ? route.query.addRequest : '')

const isSimple = computed(() => plan.value?.planningMode === 'simple')
const planWritable = computed(() => isSimple.value && ['planning', 'developing'].includes(version.value?.status || ''))
const issueLabels: Record<string, string> = {
  available_person_days_required: '请填写可用人日。',
  reserve_person_days_required: '请填写预留人日。',
  reserve_exceeds_available: '预留人日不能大于可用人日。',
  capacity_exceeded: '范围总投入超过可安排容量，请调整预算、预留或范围。',
  scope_required: '至少选择一条版本范围。',
  estimate_required: '每条范围都需要大于 0 的粗估人日。',
  acceptance_criteria_required: '每条范围都需要验收标准。',
  source_request_not_accepted: '来源需求尚未采纳，请先作出产品决定。',
  scope_unavailable: '范围或其来源事项已顺延、取消或合并，无法继续作为当前版本交付范围。',
  scope_summary_required: '请为每条范围填写本次要交付的内容。',
  dependency_blocked: '存在尚未满足的前置依赖，请调整范围或顺序。'
}
const issueText = computed(() => (plan.value?.summary.issues || []).map(issue => issueLabels[issue] || '计划存在需要处理的校验问题。'))
const capacityText = computed(() => {
  const current = plan.value
  if (!current || current.availablePersonDays === null || current.reservePersonDays === null) return '待填写预算'
  return `${Number(current.availablePersonDays) - Number(current.reservePersonDays)} 人日`
})
const budgetBalanceText = computed(() => {
  const remaining = plan.value?.summary.remainingPersonDays
  if (remaining === null || remaining === undefined) return '待填写预算'
  const value = Number(remaining)
  return value < 0 ? `超出 ${Math.abs(value)} 人日` : `剩余 ${value} 人日`
})
function decimal(value: string | null | undefined) {
  return value === null || value === undefined || value === '' ? '—' : `${value} 人日`
}
function friendlyPlanError(cause: unknown, fallback: string) {
  const details = cause && typeof cause === 'object' ? (cause as { data?: { message?: unknown, statusMessage?: unknown } }).data : undefined
  const raw = [details?.message, details?.statusMessage, cause instanceof Error ? cause.message : ''].filter(value => typeof value === 'string').join(' ')
  const matched = Object.keys(issueLabels).find(code => raw.includes(code))
  if (matched) return new Error(issueLabels[matched])
  if (typeof details?.message === 'string' && details.message.trim()) return new Error(details.message)
  return new Error(fallback)
}
const requestStateText: Record<string, string> = { accepted: '已采纳', submitted: '待评估', evaluating: '评估中', deferred: '暂缓', rejected: '已拒绝', merged: '已合并' }
function canAddRequest(request: ProductRequestRecord) {
  if (request.decision_status === 'accepted') return plan.value?.permissions.canCreateScope === true
  return ['submitted', 'evaluating'].includes(request.decision_status) && plan.value?.permissions.canCreateScope === true && plan.value.permissions.canDecideRequests === true
}
function openPlanEditor() {
  if (!plan.value || busy.value || !planWritable.value) return
  Object.assign(planDraft, {
    goal: plan.value.goal || '', startsOn: plan.value.startsOn || '', plannedReleaseDate: plan.value.plannedReleaseDate || '',
    availablePersonDays: plan.value.availablePersonDays || '', reservePersonDays: plan.value.reservePersonDays || '', reason: ''
  })
  mutationError.value = null
  retry = undefined
  editingPlan.value = true
}
function openAdd(request: ProductRequestRecord) {
  if (!planWritable.value || busy.value || !canAddRequest(request)) return
  addingRequest.value = request
  Object.assign(addDraft, { scopeSummary: request.problem_statement || '', estimatePersonDays: '', acceptanceCriteria: '', sortOrder: (plan.value?.summary.selectedCount || 0) + 1, reason: '', adoptRequest: false })
  mutationError.value = null
  retry = undefined
}
function openScopeEditor(item: ScopeItem) {
  if (!planWritable.value || busy.value) return
  selectedScope.value = item
  Object.assign(scopeDraft, { scopeSummary: item.scopeSummary, estimatePersonDays: item.estimatePersonDays || '', acceptanceCriteria: item.acceptanceCriteria || '', sortOrder: item.sortOrder, reason: '' })
  mutationError.value = null
  retry = undefined
}
async function refreshAll(force = false) {
  if (busy.value && !force) return
  await Promise.all([refreshPlan(), refreshScopes(), refreshCandidates()])
}
function mutationKey(body: unknown) {
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  return retry.key
}
async function savePlan() {
  if (!plan.value || busy.value || !planWritable.value) return
  const body = {
    goal: planDraft.goal || null, startsOn: planDraft.startsOn || null, plannedReleaseDate: planDraft.plannedReleaseDate || null,
    availablePersonDays: planDraft.availablePersonDays || null, reservePersonDays: planDraft.reservePersonDays || null,
    expectedRevision: plan.value.workspaceRevision, expectedVersionRevision: plan.value.versionRevision, expectedPlanRevision: plan.value.planRevision,
    ...(plan.value.planStatus === 'confirmed' || plan.value.planStatus === 'stale' ? { reason: planDraft.reason } : {})
  }
  busy.value = true
  mutationError.value = null
  try {
    const response = await $fetch<{ code: number }>(`${base.value}/plan`, { method: 'PATCH', body, headers: { 'Idempotency-Key': mutationKey(body) } })
    if (response.code !== 0) throw new Error('计划保存结果不完整，请重试')
    editingPlan.value = false
    toast.add({ title: '计划信息已保存', color: 'success' })
    await refreshAll(true)
  } catch (cause) {
    mutationError.value = friendlyPlanError(cause, '计划保存失败')
  } finally {
    busy.value = false
  }
}
async function addScope() {
  if (!plan.value || !addingRequest.value || busy.value || !planWritable.value) return
  if (addingRequest.value.decision_status !== 'accepted' && !['submitted', 'evaluating'].includes(addingRequest.value.decision_status)) {
    mutationError.value = new Error('只有待评估或评估中的需求可以在此明确采纳')
    return
  }
  if (addingRequest.value.decision_status !== 'accepted' && (!plan.value.permissions.canDecideRequests || !addDraft.adoptRequest)) {
    mutationError.value = new Error('请明确勾选采纳需求后再排入版本')
    return
  }
  if (plan.value.planStatus !== 'draft' && !addDraft.reason.trim()) {
    mutationError.value = new Error('已确认计划新增范围需要填写原因')
    return
  }
  const body = {
    requestBizId: addingRequest.value.biz_id, expectedRequestRevision: addingRequest.value.revision,
    scopeSummary: addDraft.scopeSummary, estimatePersonDays: addDraft.estimatePersonDays || null, acceptanceCriteria: addDraft.acceptanceCriteria || null, sortOrder: Number(addDraft.sortOrder),
    expectedRevision: plan.value.workspaceRevision, expectedVersionRevision: plan.value.versionRevision, expectedPlanRevision: plan.value.planRevision,
    adoptRequest: addDraft.adoptRequest,
    ...(plan.value.planStatus === 'draft' ? {} : { reason: addDraft.reason })
  }
  busy.value = true
  mutationError.value = null
  try {
    const response = await $fetch<{ code: number }>(`${base.value}/plan/items`, { method: 'POST', body, headers: { 'Idempotency-Key': mutationKey(body) } })
    if (response.code !== 0) throw new Error('排入版本结果不完整，请重试')
    addingRequest.value = null
    toast.add({ title: '需求已排入版本', color: 'success' })
    await refreshAll(true)
  } catch (cause) {
    mutationError.value = friendlyPlanError(cause, '排入版本失败')
  } finally {
    busy.value = false
  }
}
async function saveScope() {
  if (!plan.value || !selectedScope.value || busy.value || !planWritable.value) return
  const body = {
    scopeSummary: scopeDraft.scopeSummary, estimatePersonDays: scopeDraft.estimatePersonDays || null, acceptanceCriteria: scopeDraft.acceptanceCriteria || null, sortOrder: Number(scopeDraft.sortOrder),
    expectedRevision: plan.value.workspaceRevision, expectedVersionRevision: plan.value.versionRevision, expectedPlanRevision: plan.value.planRevision, expectedScopeRevision: plan.value.scopeRevision,
    ...(plan.value.planStatus === 'draft' ? {} : { reason: scopeDraft.reason })
  }
  busy.value = true
  mutationError.value = null
  try {
    const response = await $fetch<{ code: number }>(`${base.value}/plan/items/${selectedScope.value.id}`, { method: 'PATCH', body, headers: { 'Idempotency-Key': mutationKey(body) } })
    if (response.code !== 0) throw new Error('范围保存结果不完整，请重试')
    selectedScope.value = null
    toast.add({ title: '版本范围已更新', color: 'success' })
    await refreshAll(true)
  } catch (cause) {
    mutationError.value = friendlyPlanError(cause, '范围保存失败')
  } finally {
    busy.value = false
  }
}
async function removeScope() {
  if (!plan.value || !removing.value || busy.value || !planWritable.value) return
  const item = removing.value
  const body = { expectedRevision: plan.value.workspaceRevision, expectedVersionRevision: plan.value.versionRevision, expectedPlanRevision: plan.value.planRevision, expectedScopeRevision: plan.value.scopeRevision, reason: removeReason.value }
  if (!removeReason.value.trim()) {
    mutationError.value = new Error('移出范围需要填写原因')
    return
  }
  busy.value = true
  mutationError.value = null
  try {
    if (!await confirm({ title: '移出版本范围', message: `将“${item.requestTitle}”移出当前版本。已有研发或发布引用时系统会拒绝此操作，并提示后续处理方式。`, tone: 'warning', confirmLabel: '确认移出' })) return
    const response = await $fetch<{ code: number }>(`${base.value}/plan/items/${item.id}`, { method: 'DELETE', body, headers: { 'Idempotency-Key': mutationKey(body) } })
    if (response.code !== 0) throw new Error('移出范围结果不完整，请重试')
    removing.value = null
    removeReason.value = ''
    if (scopes.value?.items.length === 1 && scopePage.value > 1) scopePage.value--
    toast.add({ title: '范围已移出版本', color: 'success' })
    await refreshAll(true)
  } catch (cause) {
    mutationError.value = friendlyPlanError(cause, '移出范围失败')
  } finally {
    busy.value = false
  }
}
async function confirmPlan() {
  if (!plan.value || busy.value || !planWritable.value || !plan.value.permissions.canConfirmPlan) return
  const body = { expectedRevision: plan.value.workspaceRevision, expectedVersionRevision: plan.value.versionRevision, expectedPlanRevision: plan.value.planRevision, expectedScopeRevision: plan.value.scopeRevision }
  busy.value = true
  mutationError.value = null
  try {
    const response = await $fetch<{ code: number }>(`${base.value}/plan/confirm`, { method: 'POST', body, headers: { 'Idempotency-Key': mutationKey(body) } })
    if (response.code !== 0) throw new Error('计划确认结果不完整，请重试')
    toast.add({ title: '计划已确认，可进入研发交付', color: 'success' })
    await refreshAll(true)
  } catch (cause) {
    mutationError.value = friendlyPlanError(cause, '计划确认失败')
  } finally {
    busy.value = false
  }
}
watch(addRequestFromLink, async (requestBizId) => {
  if (!requestBizId || addingRequest.value || busy.value) return
  try {
    const response = await $fetch<{ code: number, data: ProductRequestRecord }>(moduleUrl(`/api/v1/products/${encodeURIComponent(code.value)}/requests/${encodeURIComponent(requestBizId)}`))
    if (response.code !== 0 || response.data?.product_code !== code.value || response.data.biz_id !== requestBizId) throw new Error('需求详情响应不完整')
    openAdd(response.data)
  } catch (cause) {
    mutationError.value = cause instanceof Error ? cause : new Error('无法打开待排入的需求')
  }
}, { immediate: true })
watch([code, versionId], () => {
  editingPlan.value = false
  selectedScope.value = null
  addingRequest.value = null
  removing.value = null
  scopePage.value = 1
  candidatePage.value = 1
})
watch([() => route.hash, planStatus], async () => {
  if (planStatus.value !== 'success' || !['#version-goal', '#version-scope', '#version-confirmation'].includes(route.hash)) return
  await nextTick()
  document.getElementById(route.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}, { immediate: true })
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-7xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <UButton
        color="neutral"
        variant="outline"
        :loading="planStatus === 'pending'"
        :disabled="busy"
        @click="() => refreshAll()"
      >
        重新读取
      </UButton>
    </div>
    <UAlert v-if="planAlert" v-bind="planAlert" />
    <UAlert v-if="scopeAlert" v-bind="scopeAlert" />
    <UAlert v-if="candidateAlert" v-bind="candidateAlert" />
    <UAlert v-if="mutationAlert" v-bind="mutationAlert" />
    <p v-if="planStatus === 'pending'" role="status" class="text-sm text-muted">
      正在加载版本计划…
    </p>
    <template v-else-if="plan">
      <section class="rounded-lg border border-default p-4">
        <p class="text-sm text-muted">
          当前版本
        </p>
        <h1 class="mt-1 break-words text-lg font-semibold">
          {{ version?.version_code || `版本 #${versionId}` }}{{ version?.name ? ` · ${version.name}` : '' }}
        </h1>
      </section>
      <UAlert
        v-if="!isSimple"
        color="info"
        title="这是保留的高级周期规划版本"
        description="轻量计划工作区只适用于新建的简单计划版本；该版本继续使用原有规划入口。"
      />
      <div v-if="!isSimple" class="flex flex-wrap gap-2">
        <UButton :to="moduleUrl(`/products/${encodeURIComponent(code)}/cycles`)" color="neutral" variant="outline">
          规划周期与评分选入
        </UButton>
        <UButton :to="{ path: moduleUrl(`/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(versionId)}/features`), query: versionPerspectiveQuery }">
          查看版本范围与交付
        </UButton>
      </div>
      <UAlert
        v-if="isSimple && version && !planWritable"
        color="neutral"
        variant="subtle"
        title="此版本仅供查看"
        :description="version.status === 'released' ? '版本已发布，计划、范围与确认记录保留供追溯。' : '版本已归档，计划、范围与确认记录保留供追溯。'"
      />
      <section v-if="isSimple" id="version-goal" class="scroll-mt-4 rounded-lg border border-default p-4">
        <h2 class="mb-3 font-semibold">
          1. 目标与投入
        </h2>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm text-muted">
              计划状态
            </p>
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <UBadge :color="plan.planStatus === 'confirmed' ? 'success' : plan.planStatus === 'stale' ? 'warning' : 'neutral'" variant="subtle">
                {{ plan.planStatus === 'confirmed' ? '已确认' : plan.planStatus === 'stale' ? '需重新确认' : '草案' }}
              </UBadge>
              <span class="text-sm text-muted">{{ plan.planStatus === 'draft' ? '草案可保留未知投入和待补信息。' : plan.planStatus === 'stale' ? '范围、日期或预算已变化，请重新确认。' : '确认快照已冻结；后续修改会使确认失效。' }}</span>
            </div>
          </div>
          <UButton v-if="isSimple" :disabled="busy || !planWritable || !plan.permissions.canEditPlan" @click="openPlanEditor">
            编辑计划信息
          </UButton>
        </div>
        <dl class="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt class="text-muted">
              计划目标
            </dt><dd class="mt-1 break-words">
              {{ plan.goal || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              计划日期
            </dt><dd class="mt-1">
              {{ plan.startsOn || '—' }} 至 {{ plan.plannedReleaseDate || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              可用 / 预留
            </dt><dd class="mt-1">
              {{ decimal(plan.availablePersonDays) }} / {{ decimal(plan.reservePersonDays) }}
            </dd>
          </div>
          <div>
            <dt class="text-muted">
              可安排容量
            </dt><dd class="mt-1 font-medium">
              {{ capacityText }}
            </dd>
          </div>
        </dl>
      </section>
      <UAlert
        v-if="issueText.length"
        color="warning"
        variant="subtle"
        title="确认前需要补齐"
      >
        <template #description>
          <ul class="list-disc space-y-1 pl-5">
            <li v-for="issue in issueText" :key="issue">
              {{ issue }}
            </li>
          </ul>
        </template>
      </UAlert>
      <section v-if="isSimple" id="version-scope" class="scroll-mt-4 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-5">
        <div class="min-w-0 space-y-3 xl:col-span-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-semibold">
              2. 需求范围
            </h2><span class="text-sm text-muted">完整范围共 {{ plan.summary.selectedCount }} 项，不受当前页影响</span>
          </div>
          <p class="text-sm text-muted">
            每项记录来源需求、模块、估算和验收标准。未知投入不是 0，确认前必须补齐。
          </p>
          <dl class="grid grid-cols-1 gap-2 rounded-lg border border-default p-3 text-sm sm:grid-cols-3">
            <div>
              <dt class="text-muted">
                已估算总投入
              </dt><dd class="mt-1 font-medium">
                {{ decimal(plan.summary.estimatedPersonDays) }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                待估算范围
              </dt><dd class="mt-1 font-medium">
                {{ plan.summary.unknownEstimateCount }} 项
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                预算余额
              </dt><dd class="mt-1 font-medium">
                {{ budgetBalanceText }}
              </dd>
            </div>
          </dl>
          <p v-if="scopesStatus === 'pending'" role="status" class="text-sm text-muted">
            正在加载已选范围…
          </p>
          <CommonEmptyState
            v-else-if="scopes && !scopes.items.length"
            icon="i-lucide-list-checks"
            title="尚未选择版本范围"
            description="从候选需求中选择本次要交付的范围。"
          />
          <article v-for="item in scopes?.items || []" :key="item.id" class="min-w-0 space-y-3 rounded-lg border border-default p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <h3 class="break-words font-medium">
                  {{ item.requestTitle }}
                </h3><p class="mt-1 text-sm text-muted">
                  {{ item.componentName || '未分类' }} · {{ item.status === 'planned' ? '待交付' : item.status }}
                </p>
              </div><UBadge color="neutral" variant="subtle">
                顺序 {{ item.sortOrder }}
              </UBadge>
            </div>
            <p class="whitespace-pre-wrap break-words text-sm">
              {{ item.scopeSummary || '沿用来源需求说明' }}
            </p>
            <dl class="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt class="text-muted">
                  粗估投入
                </dt><dd>{{ decimal(item.estimatePersonDays) }}</dd>
              </div><div class="sm:col-span-2">
                <dt class="text-muted">
                  验收标准
                </dt><dd class="whitespace-pre-wrap break-words">
                  {{ item.acceptanceCriteria || '待补充' }}
                </dd>
              </div>
            </dl>
            <div class="flex flex-wrap gap-2">
              <UButton
                size="sm"
                color="neutral"
                variant="outline"
                :disabled="busy || !planWritable || !plan.permissions.canEditPlan"
                @click="openScopeEditor(item)"
              >
                编辑范围
              </UButton><UButton
                size="sm"
                color="neutral"
                variant="outline"
                :to="{ path: moduleUrl(`/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(versionId)}/features`), query: versionPerspectiveQuery }"
              >
                研发交付
              </UButton><UButton
                v-if="planWritable && plan.planStatus === 'confirmed' && plan.permissions.canHandoff && item.planningItemBizId"
                size="sm"
                color="neutral"
                variant="outline"
                :to="{ path: moduleUrl(`/products/${encodeURIComponent(code)}/planning-items/${item.planningItemBizId}/handoff`), query: { versionId, scopeId: item.id } }"
              >
                转交项目
              </UButton><span v-else-if="planWritable && item.planningItemBizId" class="text-sm text-muted">确认后可转交</span><UButton
                size="sm"
                color="error"
                variant="ghost"
                :disabled="busy || !planWritable || !plan.permissions.canEditPlan"
                @click="removing = item; removeReason = ''"
              >
                移出
              </UButton>
            </div>
          </article>
          <UPagination
            v-if="scopes && scopes.total > scopePageSize"
            v-model:page="scopePage"
            :total="scopes.total"
            :items-per-page="scopePageSize"
            :sibling-count="0"
            :disabled="busy"
          />
          <div id="version-confirmation" class="scroll-mt-4 space-y-3 rounded-lg border border-default p-3">
            <h2 class="font-semibold">
              3. 确认计划
            </h2>
            <p v-if="plan.planStatus === 'confirmed'" class="text-sm text-muted">
              计划已确认。下一步进入研发交付，按范围安排承接项目并跟踪交付。
            </p>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="text-sm text-muted">{{ plan.planStatus === 'confirmed' ? '确认人和时间已写入冻结快照。' : '确认会校验完整范围、日期、预算、依赖和验收标准。' }}</span><UButton :loading="busy" :disabled="!planWritable || !plan.permissions.canConfirmPlan" @click="confirmPlan">
                {{ plan.planStatus === 'confirmed' ? '重新确认计划' : '确认计划' }}
              </UButton>
            </div>
            <UButton v-if="plan.planStatus === 'confirmed'" :to="{ path: moduleUrl(`/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(versionId)}/features`), query: versionPerspectiveQuery }" icon="i-lucide-arrow-right">
              进入研发交付
            </UButton>
          </div>
        </div>
        <aside class="min-w-0 space-y-3 rounded-lg border border-default p-4 xl:col-span-2">
          <div>
            <h2 class="font-semibold">
              候选需求
            </h2><p class="mt-1 text-sm text-muted">
              仅安排当前产品需求；有决定权限时可在排入时明确采纳。
            </p>
          </div>
          <form @submit.prevent="flushCandidateSearch">
            <UFormField label="搜索候选需求">
              <UInput v-model="candidateSearch" class="w-full" placeholder="标题或问题说明" />
            </UFormField>
          </form>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-muted">模块：{{ candidateComponentName || '全部模块' }}</span><UButton
              size="sm"
              color="neutral"
              variant="outline"
              @click="candidateComponentOpen = true"
            >
              筛选模块
            </UButton><UCheckbox
              v-if="candidateComponentId"
              v-model="candidateIncludeDescendants"
              label="包含子模块"
              @update:model-value="candidatePage = 1"
            />
          </div>
          <UButton
            v-if="candidateComponentId"
            size="sm"
            color="neutral"
            variant="ghost"
            @click="candidateComponentId = null; candidateComponentName = ''; candidatePage = 1"
          >
            清除模块筛选
          </UButton>
          <p v-if="candidatesStatus === 'pending'" role="status" class="text-sm text-muted">
            正在加载候选需求…
          </p>
          <CommonEmptyState
            v-else-if="candidates && !candidates.items.length"
            icon="i-lucide-search"
            title="没有符合条件的需求"
            description="调整关键词或模块筛选。"
          />
          <article v-for="request in candidates?.items || []" :key="request.biz_id" class="min-w-0 space-y-2 border-b border-default pb-3">
            <p class="break-words font-medium">
              {{ request.title }}
            </p><p class="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted">
              {{ request.problem_statement || '暂无说明' }}
            </p><div class="flex flex-wrap items-center gap-2">
              <UBadge color="neutral" variant="subtle">
                {{ request.component_name || '未分类' }}
              </UBadge><UBadge color="neutral" variant="subtle">
                {{ requestStateText[request.decision_status] || request.decision_status }}
              </UBadge><UButton size="sm" :disabled="busy || !planWritable || !canAddRequest(request)" @click="openAdd(request)">
                排入版本
              </UButton>
            </div>
          </article>
          <p class="text-sm text-muted">
            共 {{ candidates?.total || 0 }} 条候选需求
          </p><UPagination
            v-if="candidates && candidates.total > candidatePageSize"
            v-model:page="candidatePage"
            :total="candidates.total"
            :items-per-page="candidatePageSize"
            :sibling-count="0"
            :disabled="busy"
          />
        </aside>
      </section>
    </template>
    <UModal
      v-model:open="editingPlan"
      title="计划目标与容量"
      description="可用人日由负责人扣除其他承诺后填写；预留人日从可用人日中扣除一次。"
      :dismissible="!busy"
      :close="!busy"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="savePlan">
          <UAlert v-if="mutationAlert" v-bind="mutationAlert" /><UFormField label="计划目标">
            <UTextarea
              v-model="planDraft.goal"
              :rows="3"
              :maxlength="2000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField><div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="计划开始日期">
              <UInput
                v-model="planDraft.startsOn"
                type="date"
                :disabled="busy"
                class="w-full"
              />
            </UFormField><UFormField label="计划发布日期">
              <UInput
                v-model="planDraft.plannedReleaseDate"
                type="date"
                :disabled="busy"
                class="w-full"
              />
            </UFormField><UFormField label="可用人日">
              <UInput
                v-model="planDraft.availablePersonDays"
                inputmode="decimal"
                placeholder="例如 18.5"
                :disabled="busy"
                class="w-full"
              />
            </UFormField><UFormField label="预留人日">
              <UInput
                v-model="planDraft.reservePersonDays"
                inputmode="decimal"
                placeholder="例如 2"
                :disabled="busy"
                class="w-full"
              />
            </UFormField>
          </div><UFormField v-if="plan?.planStatus !== 'draft'" label="修改原因" required>
            <UTextarea
              v-model="planDraft.reason"
              required
              :maxlength="2000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField><div class="flex flex-wrap justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="busy"
              @click="editingPlan = false"
            >
              取消
            </UButton><UButton type="submit" :loading="busy">
              保存计划
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
    <UModal v-model:open="candidateComponentOpen" title="按模块筛选候选需求" description="选择父模块时可包含其全部子模块。">
      <template #body>
        <ProductsComponentPicker
          v-model="candidateComponentId"
          :product-code="code"
          :initial-label="candidateComponentName"
          @selected="candidateComponentName = $event.id === null ? '' : $event.name; candidatePage = 1; candidateComponentOpen = false"
        />
      </template>
    </UModal>

    <UModal
      :open="!!addingRequest"
      title="排入当前版本"
      description="默认沿用来源需求标题和说明。草案可以先保留未知投入或验收标准。"
      :dismissible="!busy"
      :close="!busy"
      @update:open="value => { if (!value && !busy) addingRequest = null }"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="addScope">
          <p class="break-words font-medium">
            {{ addingRequest?.title }}
          </p><UAlert v-if="mutationAlert" v-bind="mutationAlert" /><UFormField label="本次范围">
            <UTextarea
              v-model="addDraft.scopeSummary"
              :rows="4"
              :maxlength="10000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField><div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="粗估人日">
              <UInput
                v-model="addDraft.estimatePersonDays"
                inputmode="decimal"
                placeholder="可稍后填写"
                :disabled="busy"
                class="w-full"
              />
            </UFormField><UFormField label="交付顺序">
              <UInput
                v-model.number="addDraft.sortOrder"
                type="number"
                :min="0"
                :step="1"
                :disabled="busy"
                class="w-full"
              />
            </UFormField>
          </div><UFormField label="验收标准">
            <UTextarea
              v-model="addDraft.acceptanceCriteria"
              :rows="3"
              :maxlength="10000"
              placeholder="可在草案中稍后填写"
              :disabled="busy"
              class="w-full"
            />
          </UFormField><UCheckbox
            v-if="addingRequest && ['submitted', 'evaluating'].includes(addingRequest.decision_status)"
            v-model="addDraft.adoptRequest"
            label="我确认采纳此需求，并将其排入当前版本"
            :disabled="busy || !plan?.permissions.canDecideRequests"
          /><p v-if="addingRequest && ['submitted', 'evaluating'].includes(addingRequest.decision_status)" class="text-sm text-muted">
            采纳是独立产品决定。未勾选不会创建版本范围。
          </p><UFormField v-if="plan?.planStatus !== 'draft'" label="新增原因" required>
            <UTextarea
              v-model="addDraft.reason"
              required
              :maxlength="2000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField><div class="flex flex-wrap justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="busy"
              @click="addingRequest = null"
            >
              取消
            </UButton><UButton type="submit" :loading="busy">
              排入版本
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      :open="!!selectedScope"
      title="编辑版本范围"
      description="修改已确认计划会使确认失效，并需要记录原因。"
      :dismissible="!busy"
      :close="!busy"
      @update:open="value => { if (!value && !busy) selectedScope = null }"
    >
      <template #body>
        <form class="space-y-4" @submit.prevent="saveScope">
          <UAlert v-if="mutationAlert" v-bind="mutationAlert" /><UFormField label="本次范围">
            <UTextarea
              v-model="scopeDraft.scopeSummary"
              :rows="4"
              :maxlength="10000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField><div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="粗估人日">
              <UInput
                v-model="scopeDraft.estimatePersonDays"
                inputmode="decimal"
                :disabled="busy"
                class="w-full"
              />
            </UFormField><UFormField label="交付顺序">
              <UInput
                v-model.number="scopeDraft.sortOrder"
                type="number"
                :min="0"
                :step="1"
                :disabled="busy"
                class="w-full"
              />
            </UFormField>
          </div><UFormField label="验收标准">
            <UTextarea
              v-model="scopeDraft.acceptanceCriteria"
              :rows="3"
              :maxlength="10000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField><UFormField v-if="plan?.planStatus !== 'draft'" label="修改原因" required>
            <UTextarea
              v-model="scopeDraft.reason"
              required
              :maxlength="2000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField><div class="flex flex-wrap justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="busy"
              @click="selectedScope = null"
            >
              取消
            </UButton><UButton type="submit" :loading="busy">
              保存范围
            </UButton>
          </div>
        </form>
      </template>
    </UModal>

    <UModal
      :open="!!removing"
      title="移出版本范围"
      description="已产生研发、项目或发布引用的范围不能直接移出。"
      :dismissible="!busy"
      :close="!busy"
      @update:open="value => { if (!value && !busy) removing = null }"
    >
      <template #body>
        <div class="space-y-4">
          <p class="break-words">
            {{ removing?.requestTitle }}
          </p><UAlert v-if="mutationAlert" v-bind="mutationAlert" /><UFormField label="移出原因" required>
            <UTextarea
              v-model="removeReason"
              required
              :maxlength="2000"
              :disabled="busy"
              class="w-full"
            />
          </UFormField><div class="flex flex-wrap justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="busy"
              @click="removing = null; removeReason = ''"
            >
              取消
            </UButton><UButton
              color="error"
              :loading="busy"
              :disabled="!removeReason.trim()"
              @click="removeScope"
            >
              确认移出
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
