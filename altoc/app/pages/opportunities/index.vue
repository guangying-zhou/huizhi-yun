<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Customer, Opportunity, OpportunityStage } from '~/types/altoc'
import {
  FORECAST_CATEGORY_OPTIONS,
  OPPORTUNITY_LOST_REASON_OPTIONS,
  OPPORTUNITY_PAUSE_REASON_OPTIONS,
  OPPORTUNITY_PIPELINE_OPTIONS,
  OPPORTUNITY_STATUS_OPTIONS,
  OPPORTUNITY_WON_REASON_OPTIONS
} from '~/types/altoc'
import { getOpportunityRisks } from '~/utils/opportunityRisk'
import {
  expandOpportunityStageRequirementFields,
  getOpportunityTransitionMissingFields,
  isEditableOpportunityStageRequirement,
  opportunityStageRequirementLabel
} from '~/utils/opportunityStageRequirements'
import {
  isOpportunityOpenNormalStage,
  opportunityStageEnabled,
  opportunityStageMatchesTerminalMode,
  opportunityStagePipelineCode
} from '~/utils/opportunityStages'
import { unwrapApiList, unwrapApiPage } from '~/utils/apiResponse'

const router = useRouter()
const toast = useToast()

const keyword = ref('')
const pipelineFilter = ref('default')
const statusFilter = ref<string | undefined>(undefined)
const stageFilter = ref<number | undefined>(undefined)
const forecastFilter = ref<string | undefined>(undefined)
const page = ref(1)
const pageSize = ref(20)

// 视图切换：list / kanban
const viewMode = ref<'list' | 'kanban'>('list')

// 加载阶段配置
const { data: stages } = useFetch('/api/v1/config/opportunity-stages', {
  query: computed(() => ({ pipeline_code: pipelineFilter.value })),
  transform: (res: unknown) => unwrapApiList<OpportunityStage>(res)
})

const { data: customers } = useFetch('/api/v1/customers', {
  query: { pageSize: 100 },
  transform: (res: unknown) => unwrapApiList<Customer>(res)
})

const queryParams = computed(() => ({
  page: viewMode.value === 'kanban' ? 1 : page.value,
  pageSize: viewMode.value === 'kanban' ? 200 : pageSize.value,
  keyword: keyword.value || undefined,
  pipeline_code: pipelineFilter.value,
  status: viewMode.value === 'kanban' ? 'active' : (statusFilter.value || undefined),
  stage_id: stageFilter.value || undefined,
  forecast_category: forecastFilter.value || undefined
}))

const { data: result, status, refresh } = useFetch('/api/v1/opportunities', {
  query: queryParams,
  transform: (res: unknown) => unwrapApiPage<Opportunity>(res)
})

const items = computed(() => result.value?.items || [])
const total = computed(() => result.value?.total || 0)
const stageNameById = computed(() =>
  new Map((stages.value || []).map(stage => [Number(stage.id), stage.name]))
)
const customerNameById = computed(() =>
  new Map((customers.value || []).map(customer => [Number(customer.id), customer.name]))
)

function getErrorMessage(err: unknown, fallback: string) {
  const error = err as { data?: { statusMessage?: string, message?: string }, message?: string }
  return error?.data?.statusMessage || error?.data?.message || error?.message || fallback
}

// Kanban 数据（按阶段分组）
const kanbanColumns = computed(() => {
  if (!stages.value) return []
  return stages.value
    .filter(isOpportunityOpenNormalStage)
    .filter(stage => opportunityStagePipelineCode(stage) === pipelineFilter.value)
    .map(stage => ({
      ...stage,
      items: items.value.filter(o => Number(o.stage_id) === Number(stage.id)),
      totalAmount: items.value
        .filter(o => Number(o.stage_id) === Number(stage.id))
        .reduce((sum, o) => sum + (o.amount_tax_inclusive || 0), 0)
    }))
})

// ============= Kanban 拖拽 =============
type TransitionTerminalMode = 'won' | 'lost' | 'paused'

const dragState = ref<{ item: Opportunity, fromStageId: number } | null>(null)
const dragOverStageId = ref<number | null>(null)
const transitionReasonModalOpen = ref(false)
const transitionReasonMode = ref<TransitionTerminalMode>('lost')
const transitionReasonTarget = ref<Opportunity | null>(null)
const transitionReasonStage = ref<OpportunityStage | null>(null)
const transitionReasonForm = reactive({
  amount_tax_inclusive: null as number | null,
  expected_sign_date: '',
  reason_code: '',
  reason: '',
  competitor_info: ''
})
const transitionReasonSubmitting = ref(false)
const wonReasonOptions = OPPORTUNITY_WON_REASON_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const lostReasonOptions = OPPORTUNITY_LOST_REASON_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const pauseReasonOptions = OPPORTUNITY_PAUSE_REASON_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const transitionReasonOptions = computed(() =>
  transitionReasonMode.value === 'won'
    ? wonReasonOptions
    : transitionReasonMode.value === 'lost'
      ? lostReasonOptions
      : pauseReasonOptions
)
const transitionModalTitle = computed(() => {
  if (transitionReasonMode.value === 'won') return '标记赢单'
  if (transitionReasonMode.value === 'lost') return '标记输单'
  return '暂停商机'
})
const transitionReasonLabel = computed(() => {
  if (transitionReasonMode.value === 'won') return '赢单原因'
  if (transitionReasonMode.value === 'lost') return '输单原因'
  return '暂停原因'
})
const transitionNoteLabel = computed(() => {
  if (transitionReasonMode.value === 'won') return '赢单说明'
  if (transitionReasonMode.value === 'lost') return '输单说明'
  return '暂停说明'
})
const stageRequirementModalOpen = ref(false)
const stageRequirementTarget = ref<Opportunity | null>(null)
const stageRequirementStage = ref<OpportunityStage | null>(null)
const stageRequirementFields = ref<string[]>([])
const stageRequirementForm = reactive({
  amount_tax_inclusive: null as number | null,
  expected_sign_date: '',
  competitor_info: '',
  next_action: '',
  next_action_due_at: '',
  reason: ''
})
const stageRequirementSubmitting = ref(false)
const stageRequirementTitle = computed(() =>
  stageRequirementStage.value ? `推进至「${stageRequirementStage.value.name}」` : '阶段推进'
)
// 区分点击和拖拽
let pointerStartX = 0
let pointerStartY = 0
let isDragging = false

function openTransitionReasonModal(item: Opportunity, stage: OpportunityStage, mode: TransitionTerminalMode) {
  transitionReasonTarget.value = item
  transitionReasonStage.value = stage
  transitionReasonMode.value = mode
  transitionReasonForm.amount_tax_inclusive = item.amount_tax_inclusive ?? null
  transitionReasonForm.expected_sign_date = item.expected_sign_date?.slice(0, 10) || ''
  transitionReasonForm.reason_code = mode === 'won' ? 'business_value' : mode === 'lost' ? 'competitor_won' : 'procurement_paused'
  transitionReasonForm.reason = ''
  transitionReasonForm.competitor_info = mode === 'lost' ? (item.competitor_info || '') : ''
  transitionReasonModalOpen.value = true
}

function stageMatchesTerminalMode(stage: OpportunityStage, mode: TransitionTerminalMode) {
  return opportunityStageMatchesTerminalMode(stage, mode)
}

function terminalTransitionPath(item: Opportunity, mode: TransitionTerminalMode) {
  if (mode === 'won') return `/api/v1/opportunities/${item.id}/close-won`
  if (mode === 'lost') return `/api/v1/opportunities/${item.id}/close-lost`
  return `/api/v1/opportunities/${item.id}/pause`
}

function terminalStageForMode(mode: TransitionTerminalMode) {
  return (stages.value || [])
    .filter(opportunityStageEnabled)
    .filter(stage => opportunityStagePipelineCode(stage) === pipelineFilter.value)
    .find(stage => stageMatchesTerminalMode(stage, mode)) || null
}

function openTerminalTransition(item: Opportunity, mode: TransitionTerminalMode) {
  const stage = terminalStageForMode(mode)
  if (!stage) {
    toast.add({ title: '当前管线未配置对应阶段', color: 'error' })
    return
  }
  openTransitionReasonModal(item, stage, mode)
}

function hasTerminalActions(item: Opportunity) {
  return item.status === 'active' && ['won', 'lost', 'paused'].some(mode => terminalStageForMode(mode as TransitionTerminalMode))
}

function terminalActionItems(item: Opportunity): DropdownMenuItem[][] {
  return [[
    {
      label: '标记赢单',
      icon: 'i-lucide-trophy',
      color: 'success',
      disabled: item.status !== 'active' || !terminalStageForMode('won'),
      onSelect: () => openTerminalTransition(item, 'won')
    },
    {
      label: '标记输单',
      icon: 'i-lucide-x-circle',
      color: 'error',
      disabled: item.status !== 'active' || !terminalStageForMode('lost'),
      onSelect: () => openTerminalTransition(item, 'lost')
    },
    {
      label: '暂停商机',
      icon: 'i-lucide-pause-circle',
      color: 'warning',
      disabled: item.status !== 'active' || !terminalStageForMode('paused'),
      onSelect: () => openTerminalTransition(item, 'paused')
    }
  ]]
}

function stageRequirementFieldVisible(field: string) {
  return stageRequirementFields.value.includes(field)
}

function openStageRequirementModal(item: Opportunity, stage: OpportunityStage, fields: string[]) {
  stageRequirementTarget.value = item
  stageRequirementStage.value = stage
  stageRequirementFields.value = fields
  stageRequirementForm.amount_tax_inclusive = item.amount_tax_inclusive ?? null
  stageRequirementForm.expected_sign_date = item.expected_sign_date?.slice(0, 10) || ''
  stageRequirementForm.competitor_info = item.competitor_info || ''
  stageRequirementForm.next_action = item.next_action || ''
  stageRequirementForm.next_action_due_at = item.next_action_due_at?.slice(0, 10) || ''
  stageRequirementForm.reason = ''
  stageRequirementModalOpen.value = true
}

function blockOrOpenStageRequirements(item: Opportunity, stage: OpportunityStage) {
  const currentStage = stages.value?.find(s => Number(s.id) === Number(item.stage_id)) || null
  const missingFields = getOpportunityTransitionMissingFields(currentStage, stage, item)
  if (!missingFields.length) return false

  const editableFields = expandOpportunityStageRequirementFields(
    missingFields.filter(isEditableOpportunityStageRequirement),
    item
  )
  const blockedFields = missingFields.filter(field => !isEditableOpportunityStageRequirement(field))
  if (blockedFields.length) {
    toast.add({
      title: `请先补充${blockedFields.map(opportunityStageRequirementLabel).join('、')}`,
      color: 'error'
    })
    return true
  }

  openStageRequirementModal(item, stage, editableFields)
  return true
}

function onCardPointerDown(e: PointerEvent) {
  pointerStartX = e.clientX
  pointerStartY = e.clientY
  isDragging = false
}

function onCardDragStart(stageId: number, opp: Opportunity, e: DragEvent) {
  isDragging = true
  dragState.value = { item: opp, fromStageId: stageId }
  e.dataTransfer!.effectAllowed = 'move'
  e.dataTransfer!.setData('text/plain', String(opp.id))
}

function onCardDragEnd() {
  setTimeout(() => {
    dragState.value = null
    dragOverStageId.value = null
  }, 100)
}

function onColumnDragOver(stageId: number, e: DragEvent) {
  e.preventDefault()
  dragOverStageId.value = stageId
  if (dragState.value && stageId !== dragState.value.fromStageId) {
    e.dataTransfer!.dropEffect = 'move'
  } else {
    e.dataTransfer!.dropEffect = 'none'
  }
}

function onColumnDragLeave() {
  dragOverStageId.value = null
}

async function onColumnDrop(targetStageId: number, e: DragEvent) {
  e.preventDefault()
  dragOverStageId.value = null
  if (!dragState.value) return

  const { item, fromStageId } = dragState.value
  if (targetStageId === fromStageId) return

  // 获取目标阶段信息
  const targetStage = stages.value?.find(s => s.id === targetStageId)
  if (!targetStage) return

  if (stageMatchesTerminalMode(targetStage, 'won')) {
    openTransitionReasonModal(item, targetStage, 'won')
    dragState.value = null
    return
  }
  if (stageMatchesTerminalMode(targetStage, 'lost')) {
    openTransitionReasonModal(item, targetStage, 'lost')
    dragState.value = null
    return
  }
  if (stageMatchesTerminalMode(targetStage, 'paused')) {
    openTransitionReasonModal(item, targetStage, 'paused')
    dragState.value = null
    return
  }
  if (blockOrOpenStageRequirements(item, targetStage)) {
    dragState.value = null
    return
  }

  // 乐观更新：直接修改 result 数据
  const prevItems = result.value ? [...result.value.items] : []
  if (result.value) {
    const idx = result.value.items.findIndex(o => o.id === item.id)
    if (idx >= 0) {
      result.value.items[idx] = { ...result.value.items[idx], stage_id: targetStageId } as Opportunity
    }
  }

  try {
    await $fetch(`/api/v1/opportunities/${item.id}/transition` as string, {
      method: 'POST',
      body: { stage_id: targetStageId }
    })
    toast.add({ title: `阶段已更新为「${targetStage.name}」`, color: 'success' })
    refresh()
  } catch (err: unknown) {
    // 回滚
    if (result.value) {
      result.value.items = prevItems
    }
    toast.add({ title: getErrorMessage(err, '阶段更新失败'), color: 'error' })
  }
  dragState.value = null
}

async function submitTransitionReason() {
  if (!transitionReasonTarget.value || !transitionReasonStage.value) return
  if (transitionReasonMode.value === 'won') {
    if (!transitionReasonForm.amount_tax_inclusive || transitionReasonForm.amount_tax_inclusive <= 0) {
      toast.add({ title: '请输入最终金额', color: 'error' })
      return
    }
    if (!transitionReasonForm.expected_sign_date) {
      toast.add({ title: '请选择签约日期', color: 'error' })
      return
    }
  }
  if (!transitionReasonForm.reason_code || !transitionReasonForm.reason.trim()) {
    toast.add({ title: '请选择原因并填写说明', color: 'error' })
    return
  }
  if (transitionReasonMode.value === 'lost' && !transitionReasonForm.competitor_info.trim()) {
    toast.add({ title: '请输入主要竞争对手或竞品信息', color: 'error' })
    return
  }
  const item = transitionReasonTarget.value
  const stage = transitionReasonStage.value
  let body: Record<string, unknown>
  if (transitionReasonMode.value === 'won') {
    body = {
      stage_id: stage.id,
      amount_tax_inclusive: transitionReasonForm.amount_tax_inclusive,
      expected_sign_date: transitionReasonForm.expected_sign_date,
      won_reason_code: transitionReasonForm.reason_code,
      won_reason: transitionReasonForm.reason.trim(),
      change_reason: transitionReasonForm.reason.trim()
    }
  } else if (transitionReasonMode.value === 'lost') {
    body = {
      stage_id: stage.id,
      lost_reason_code: transitionReasonForm.reason_code,
      lost_reason: transitionReasonForm.reason.trim(),
      competitor_info: transitionReasonForm.competitor_info.trim(),
      change_reason: transitionReasonForm.reason.trim()
    }
  } else {
    body = {
      stage_id: stage.id,
      pause_reason_code: transitionReasonForm.reason_code,
      pause_reason: transitionReasonForm.reason.trim(),
      change_reason: transitionReasonForm.reason.trim()
    }
  }

  transitionReasonSubmitting.value = true
  try {
    await $fetch(terminalTransitionPath(item, transitionReasonMode.value), {
      method: 'POST',
      body
    })
    toast.add({ title: `已标记为${stage.name}`, color: 'success' })
    transitionReasonModalOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '操作失败'), color: 'error' })
  } finally {
    transitionReasonSubmitting.value = false
  }
}

async function submitStageRequirementTransition() {
  if (!stageRequirementTarget.value || !stageRequirementStage.value) return
  if (stageRequirementFieldVisible('amount_tax_inclusive') && (!stageRequirementForm.amount_tax_inclusive || stageRequirementForm.amount_tax_inclusive <= 0)) {
    toast.add({ title: '请输入预计金额', color: 'error' })
    return
  }
  if (stageRequirementFieldVisible('expected_sign_date') && !stageRequirementForm.expected_sign_date) {
    toast.add({ title: '请选择预计签约日期', color: 'error' })
    return
  }
  if (stageRequirementFieldVisible('competitor_info') && !stageRequirementForm.competitor_info.trim()) {
    toast.add({ title: '请输入竞品信息', color: 'error' })
    return
  }
  if (stageRequirementFieldVisible('next_action') && !stageRequirementForm.next_action.trim()) {
    toast.add({ title: '请输入下一步动作', color: 'error' })
    return
  }
  if (stageRequirementFieldVisible('next_action_due_at') && !stageRequirementForm.next_action_due_at) {
    toast.add({ title: '请选择下一步截止日期', color: 'error' })
    return
  }

  const item = stageRequirementTarget.value
  const stage = stageRequirementStage.value
  const body: Record<string, unknown> = {
    stage_id: stage.id,
    change_reason: stageRequirementForm.reason.trim() || `推进至${stage.name}`
  }
  if (stageRequirementFieldVisible('amount_tax_inclusive')) {
    body.amount_tax_inclusive = stageRequirementForm.amount_tax_inclusive
  }
  if (stageRequirementFieldVisible('expected_sign_date')) {
    body.expected_sign_date = stageRequirementForm.expected_sign_date
  }
  if (stageRequirementFieldVisible('competitor_info')) {
    body.competitor_info = stageRequirementForm.competitor_info.trim()
  }
  if (stageRequirementFieldVisible('next_action')) {
    body.next_action = stageRequirementForm.next_action.trim()
  }
  if (stageRequirementFieldVisible('next_action_due_at')) {
    body.next_action_due_at = stageRequirementForm.next_action_due_at
  }

  stageRequirementSubmitting.value = true
  try {
    await $fetch(`/api/v1/opportunities/${item.id}/transition` as string, {
      method: 'POST',
      body
    })
    toast.add({ title: `阶段已更新为「${stage.name}」`, color: 'success' })
    stageRequirementModalOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '操作失败'), color: 'error' })
  } finally {
    stageRequirementSubmitting.value = false
  }
}

function onCardClick(e: MouseEvent, opp: Opportunity) {
  // 如果是拖拽则不跳转
  const dx = Math.abs(e.clientX - pointerStartX)
  const dy = Math.abs(e.clientY - pointerStartY)
  if (isDragging && (dx > 5 || dy > 5)) return
  router.push(`/opportunities/${opp.id}`)
}

const columns = [
  { accessorKey: 'code', header: '编号' },
  { accessorKey: 'name', header: '商机名称' },
  { accessorKey: 'customer_name', header: '客户' },
  { accessorKey: 'stage_name', header: '阶段' },
  { accessorKey: 'amount_tax_inclusive', header: '预计金额' },
  { accessorKey: 'win_rate', header: '赢率' },
  { accessorKey: 'expected_sign_date', header: '预计签约' },
  { accessorKey: 'risks', header: '风险' },
  { accessorKey: 'owner_user_id', header: '负责人' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'actions', header: '' }
]

function onSearch() {
  page.value = 1
  refresh()
}

function resetFilters() {
  keyword.value = ''
  pipelineFilter.value = 'default'
  statusFilter.value = undefined
  stageFilter.value = undefined
  forecastFilter.value = undefined
  page.value = 1
}

function getStatusColor(s: string) {
  return OPPORTUNITY_STATUS_OPTIONS.find(o => o.value === s)?.color || 'neutral'
}
function getStatusLabel(s: string) {
  return OPPORTUNITY_STATUS_OPTIONS.find(o => o.value === s)?.label || s
}
function formatMoney(val: number | null) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0 }).format(val)
}
function getStageName(opp: Opportunity) {
  const directName = String(opp.stage_name || '').trim()
  if (directName) return directName
  const stageId = Number(opp.stage_id)
  if (Number.isFinite(stageId)) {
    return stageNameById.value.get(stageId) || `阶段 #${stageId}`
  }
  return '-'
}
function getCustomerName(opp: Opportunity) {
  const directName = String(opp.customer_name || '').trim()
  if (directName) return directName
  const customerId = Number(opp.customer_id)
  if (Number.isFinite(customerId)) {
    return customerNameById.value.get(customerId) || `客户 #${customerId}`
  }
  return '-'
}

const statusSelectOptions = computed(() =>
  OPPORTUNITY_STATUS_OPTIONS.map(o => ({ label: o.label, value: o.value }))
)
const pipelineSelectOptions = OPPORTUNITY_PIPELINE_OPTIONS
const stageSelectOptions = computed(() =>
  (stages.value || [])
    .filter(opportunityStageEnabled)
    .filter(stage => opportunityStagePipelineCode(stage) === pipelineFilter.value)
    .map(stage => ({ label: stage.name, value: stage.id }))
)
const forecastSelectOptions = computed(() =>
  FORECAST_CATEGORY_OPTIONS.map(o => ({ label: o.label, value: o.value }))
)

watch(pipelineFilter, () => {
  stageFilter.value = undefined
  page.value = 1
})
</script>

<template>
  <UDashboardPanel
    id="opportunities"
    :ui="{
      root: '!h-full !min-h-0 !flex-1 !shrink !overflow-hidden',
      body: '!min-h-0 !flex-1 !gap-0 !overflow-hidden !p-0 sm:!p-0'
    }"
  >
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          商机管理
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <!-- 视图切换 -->
        <UButtonGroup>
          <UButton
            icon="i-lucide-list"
            :variant="viewMode === 'list' ? 'solid' : 'ghost'"
            :color="viewMode === 'list' ? 'primary' : 'neutral'"
            size="sm"
            @click="viewMode = 'list'"
          />
          <UButton
            icon="i-lucide-kanban"
            :variant="viewMode === 'kanban' ? 'solid' : 'ghost'"
            :color="viewMode === 'kanban' ? 'primary' : 'neutral'"
            size="sm"
            @click="viewMode = 'kanban'"
          />
        </UButtonGroup>
        <UButton
          label="新建商机"
          icon="i-lucide-plus"
          color="primary"
          @click="router.push('/opportunities/new')"
        />
      </Teleport>

      <div class="altoc-list-page">
        <!-- 筛选栏 -->
        <div class="altoc-list-toolbar flex flex-wrap items-center gap-2 px-4 py-3 border-b border-default">
          <UInput
            v-model="keyword"
            placeholder="搜索商机/客户..."
            icon="i-lucide-search"
            class="w-56"
            @keyup.enter="onSearch"
          />
          <USelect
            v-model="pipelineFilter"
            :items="pipelineSelectOptions"
            class="w-44"
            @update:model-value="onSearch"
          />
          <USelect
            v-model="statusFilter"
            :items="statusSelectOptions"
            placeholder="全部状态"
            class="w-32"
            @update:model-value="onSearch"
          />
          <USelect
            v-model="stageFilter"
            :items="stageSelectOptions"
            placeholder="全部阶段"
            class="w-32"
            @update:model-value="onSearch"
          />
          <USelect
            v-model="forecastFilter"
            :items="forecastSelectOptions"
            placeholder="全部分类"
            class="w-32"
            @update:model-value="onSearch"
          />
          <UButton
            label="重置"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="resetFilters"
          />
        </div>

        <!-- 列表视图 -->
        <template v-if="viewMode === 'list'">
          <div class="altoc-list-table">
            <UTable
              :data="items"
              :columns="columns"
              :loading="status === 'pending'"
              sticky="header"
              class="altoc-sticky-table w-full"
              :ui="{ thead: 'z-20 bg-default' }"
            >
              <template #code-cell="{ row }">
                <span class="font-mono text-xs text-muted">{{ row.original.code }}</span>
              </template>

              <template #name-cell="{ row }">
                <NuxtLink :to="`/opportunities/${row.original.id}`" class="font-medium text-primary hover:underline">
                  {{ row.original.name }}
                </NuxtLink>
              </template>

              <template #customer_name-cell="{ row }">
                <NuxtLink
                  v-if="row.original.customer_id"
                  :to="`/customers/${row.original.customer_id}`"
                  class="text-primary hover:underline"
                >
                  <TruncatedText :text="getCustomerName(row.original)" :max="16" />
                </NuxtLink>
                <span v-else class="text-muted">-</span>
              </template>

              <template #stage_name-cell="{ row }">
                <UBadge color="primary" variant="subtle" size="sm">
                  {{ getStageName(row.original) }}
                </UBadge>
              </template>

              <template #amount_tax_inclusive-cell="{ row }">
                <span class="font-mono">{{ formatMoney(row.original.amount_tax_inclusive) }}</span>
              </template>

              <template #win_rate-cell="{ row }">
                <span v-if="row.original.win_rate != null" class="font-mono">{{ row.original.win_rate }}%</span>
                <span v-else class="text-muted">--</span>
              </template>

              <template #expected_sign_date-cell="{ row }">
                <span class="text-xs">{{ row.original.expected_sign_date || '-' }}</span>
              </template>

              <template #risks-cell="{ row }">
                <div
                  v-if="getOpportunityRisks(row.original).length"
                  class="flex flex-wrap gap-1"
                >
                  <UBadge
                    v-for="risk in getOpportunityRisks(row.original)"
                    :key="risk.key"
                    :color="risk.color"
                    variant="subtle"
                    size="xs"
                    :icon="risk.icon"
                  >
                    {{ risk.label }}
                  </UBadge>
                </div>
                <span v-else class="text-muted">-</span>
              </template>

              <template #owner_user_id-cell="{ row }">
                <UserName :uid="row.original.owner_user_id" />
              </template>

              <template #status-cell="{ row }">
                <UBadge :color="getStatusColor(row.original.status)" variant="subtle" size="sm">
                  {{ getStatusLabel(row.original.status) }}
                </UBadge>
              </template>

              <template #actions-cell="{ row }">
                <div class="flex items-center justify-end gap-1">
                  <UButton
                    icon="i-lucide-eye"
                    variant="ghost"
                    color="neutral"
                    size="xs"
                    @click="router.push(`/opportunities/${row.original.id}`)"
                  />
                  <UDropdownMenu
                    v-if="hasTerminalActions(row.original)"
                    :items="terminalActionItems(row.original)"
                    :content="{ align: 'end' }"
                  >
                    <UButton
                      icon="i-lucide-ellipsis"
                      variant="ghost"
                      color="neutral"
                      size="xs"
                    />
                  </UDropdownMenu>
                </div>
              </template>

              <template #empty>
                <div class="flex flex-col items-center py-12 text-muted">
                  <UIcon name="i-lucide-trending-up" class="text-4xl mb-3" />
                  <p class="text-sm mb-3">
                    暂无商机数据
                  </p>
                  <UButton
                    label="创建第一个商机"
                    color="primary"
                    variant="soft"
                    @click="router.push('/opportunities/new')"
                  />
                </div>
              </template>
            </UTable>
          </div>

          <div v-if="total > 0" class="altoc-list-pagination flex items-center justify-between px-4 py-3 border-t border-default">
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination v-model:page="page" :items-per-page="pageSize" :total="total" />
          </div>
        </template>

        <!-- Kanban 视图（支持拖拽） -->
        <template v-if="viewMode === 'kanban'">
          <div class="altoc-list-table p-4">
            <div class="flex min-h-full gap-4">
              <div
                v-for="col in kanbanColumns"
                :key="col.id"
                class="flex-shrink-0 w-72 rounded-lg p-3 transition-colors"
                :class="dragOverStageId === col.id && dragState?.fromStageId !== col.id ? 'bg-primary/10 ring-2 ring-primary/30' : 'bg-elevated/50'"
                @dragover="onColumnDragOver(col.id, $event)"
                @dragleave="onColumnDragLeave"
                @drop.prevent="onColumnDrop(col.id, $event)"
              >
                <!-- 列头 -->
                <div class="flex items-center justify-between mb-3">
                  <div>
                    <span class="font-semibold text-sm">{{ col.name }}</span>
                    <span class="text-xs text-muted ml-1">({{ col.items.length }})</span>
                  </div>
                  <span class="text-xs font-mono text-muted">{{ formatMoney(col.totalAmount) }}</span>
                </div>

                <!-- 拖拽提示 -->
                <div
                  v-if="dragState && dragOverStageId === col.id && dragState.fromStageId !== col.id"
                  class="text-center py-2 mb-2 text-xs text-primary bg-primary/5 rounded border border-dashed border-primary/30"
                >
                  松开移至「{{ col.name }}」
                </div>

                <!-- 卡片 -->
                <div class="space-y-2">
                  <div
                    v-for="opp in col.items"
                    :key="opp.id"
                    class="bg-default rounded-md p-3 border border-default cursor-grab hover:border-primary hover:shadow-md transition-all active:cursor-grabbing"
                    :class="dragState?.item.id === opp.id ? 'opacity-50' : ''"
                    draggable="true"
                    @pointerdown="onCardPointerDown"
                    @dragstart="onCardDragStart(col.id, opp, $event)"
                    @dragend="onCardDragEnd"
                    @dragenter.stop="onColumnDragOver(col.id, $event)"
                    @dragover.stop="onColumnDragOver(col.id, $event)"
                    @drop.stop.prevent="onColumnDrop(col.id, $event)"
                    @click="onCardClick($event, opp)"
                  >
                    <div class="flex items-start gap-2">
                      <div class="min-w-0 flex-1">
                        <div class="font-medium text-sm truncate">
                          {{ opp.name }}
                        </div>
                        <div class="text-xs text-muted mt-1">
                          <TruncatedText :text="opp.customer_name" :max="16" />
                        </div>
                      </div>
                      <UDropdownMenu
                        v-if="hasTerminalActions(opp)"
                        :items="terminalActionItems(opp)"
                        :content="{ align: 'end' }"
                      >
                        <UButton
                          icon="i-lucide-ellipsis"
                          variant="ghost"
                          color="neutral"
                          size="xs"
                          @pointerdown.stop
                          @click.stop
                        />
                      </UDropdownMenu>
                    </div>
                    <div class="flex items-center justify-between mt-2">
                      <span class="font-mono text-sm">{{ formatMoney(opp.amount_tax_inclusive) }}</span>
                      <span class="text-xs text-muted"><UserName :uid="opp.owner_user_id" /></span>
                    </div>
                    <div
                      v-if="getOpportunityRisks(opp).length"
                      class="mt-2 flex flex-wrap gap-1"
                    >
                      <UBadge
                        v-for="risk in getOpportunityRisks(opp)"
                        :key="risk.key"
                        :color="risk.color"
                        variant="subtle"
                        size="xs"
                        :icon="risk.icon"
                      >
                        {{ risk.label }}
                      </UBadge>
                    </div>
                    <div v-if="opp.expected_sign_date" class="text-xs text-muted mt-1">
                      预计签约：{{ opp.expected_sign_date }}
                    </div>
                  </div>

                  <div v-if="col.items.length === 0 && !dragState" class="text-center py-6 text-muted text-xs">
                    暂无商机
                  </div>
                  <!-- 空列拖拽目标区域 -->
                  <div
                    v-if="col.items.length === 0 && dragState"
                    class="text-center py-8 text-xs text-muted border border-dashed border-default rounded"
                  >
                    拖拽到此处
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="stageRequirementModalOpen">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">
              {{ stageRequirementTitle }}
            </span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="stageRequirementModalOpen = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <div
            v-if="stageRequirementFieldVisible('amount_tax_inclusive') || stageRequirementFieldVisible('expected_sign_date')"
            class="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <UFormField
              v-if="stageRequirementFieldVisible('amount_tax_inclusive')"
              label="预计金额"
              required
            >
              <UInput
                v-model.number="stageRequirementForm.amount_tax_inclusive"
                type="number"
                min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="stageRequirementFieldVisible('expected_sign_date')"
              label="预计签约日期"
              required
            >
              <UInput
                v-model="stageRequirementForm.expected_sign_date"
                type="date"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField
            v-if="stageRequirementFieldVisible('competitor_info')"
            label="竞品信息"
            required
          >
            <UTextarea
              v-model="stageRequirementForm.competitor_info"
              :rows="3"
              class="w-full"
            />
          </UFormField>
          <div
            v-if="stageRequirementFieldVisible('next_action') || stageRequirementFieldVisible('next_action_due_at')"
            class="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <UFormField
              v-if="stageRequirementFieldVisible('next_action')"
              label="下一步动作"
              required
            >
              <UInput v-model="stageRequirementForm.next_action" class="w-full" />
            </UFormField>
            <UFormField
              v-if="stageRequirementFieldVisible('next_action_due_at')"
              label="截止日期"
              required
            >
              <UInput
                v-model="stageRequirementForm.next_action_due_at"
                type="date"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField label="阶段说明">
            <UTextarea
              v-model="stageRequirementForm.reason"
              :rows="3"
              class="w-full"
            />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="stageRequirementModalOpen = false"
            />
            <UButton
              label="确认"
              color="primary"
              :loading="stageRequirementSubmitting"
              @click="submitStageRequirementTransition"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <UModal v-model:open="transitionReasonModalOpen">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">
              {{ transitionModalTitle }}
            </span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="transitionReasonModalOpen = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <div
            v-if="transitionReasonMode === 'won'"
            class="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <UFormField label="最终金额" required>
              <UInput
                v-model.number="transitionReasonForm.amount_tax_inclusive"
                type="number"
                min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField label="签约日期" required>
              <UInput
                v-model="transitionReasonForm.expected_sign_date"
                type="date"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField
            :label="transitionReasonLabel"
            required
          >
            <USelect
              v-model="transitionReasonForm.reason_code"
              :items="transitionReasonOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField
            v-if="transitionReasonMode === 'lost'"
            label="主要竞争对手 / 竞品信息"
            required
          >
            <UTextarea
              v-model="transitionReasonForm.competitor_info"
              :rows="3"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="transitionNoteLabel" required>
            <UTextarea
              v-model="transitionReasonForm.reason"
              :rows="4"
              class="w-full"
            />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="transitionReasonModalOpen = false"
            />
            <UButton
              label="确认"
              color="primary"
              :loading="transitionReasonSubmitting"
              @click="submitTransitionReason"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
