<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Ref } from 'vue'
import type { Contact, Opportunity, OpportunityContactRole, OpportunityStage } from '~/types/altoc'
import {
  CONTACT_ATTITUDE_OPTIONS,
  CONTACT_INFLUENCE_LEVEL_OPTIONS,
  FORECAST_CATEGORY_OPTIONS,
  OPPORTUNITY_CONTACT_ROLE_OPTIONS,
  OPPORTUNITY_LOST_REASON_OPTIONS,
  OPPORTUNITY_PAUSE_REASON_OPTIONS,
  OPPORTUNITY_SOURCE_OPTIONS,
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
import { unwrapApiData, unwrapApiList } from '~/utils/apiResponse'

interface OpportunityActivity {
  id: number
  activity_type: string
  subject: string
  content: string | null
  result_summary: string | null
  next_action: string | null
  activity_at: string
}

interface OpportunityStageLog {
  changed_at: string
  from_stage_name: string | null
  to_stage_name: string | null
  change_reason: string | null
  amount_snapshot: number | string | null
  forecast_category_snapshot: string | null
  expected_sign_date_snapshot: string | null
  win_rate_snapshot: number | string | null
  version_no: number | string | null
}

interface OpportunityQuotation {
  id: number
  code: string
  version_no: number
  status: string
  amount_tax_inclusive: number | null
  created_at: string
}

type OpportunityDetail = Opportunity & {
  activities?: OpportunityActivity[]
  stage_logs?: OpportunityStageLog[]
  quotations?: OpportunityQuotation[]
  contact_roles?: OpportunityContactRole[]
}
type TransitionTerminalMode = 'won' | 'lost' | 'paused'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const id = computed(() => String(route.params.id))

const opportunityFetch = useFetch(() => `/api/v1/opportunities/${id.value}`, {
  transform: (res: unknown) => unwrapApiData<OpportunityDetail>(res)
})
const opp = opportunityFetch.data as Ref<OpportunityDetail | null | undefined>
const status = opportunityFetch.status
const refresh = opportunityFetch.refresh

// 阶段列表
const { data: stages } = useFetch('/api/v1/config/opportunity-stages', {
  transform: (res: unknown) => unwrapApiList<OpportunityStage>(res)
})

const activeTab = ref('activities')
const tabs = [
  { label: '基本信息', value: 'info', icon: 'i-lucide-info' },
  { label: '干系人', value: 'contacts', icon: 'i-lucide-users' },
  { label: '活动记录', value: 'activities', icon: 'i-lucide-activity' },
  { label: '阶段历史', value: 'stages', icon: 'i-lucide-git-branch' },
  { label: '报价', value: 'quotes', icon: 'i-lucide-calculator' },
  { label: '文档', value: 'documents', icon: 'i-lucide-file-text' },
  { label: '操作历史', value: 'audit', icon: 'i-lucide-history' }
]

function getStatusColor(s: string) {
  return OPPORTUNITY_STATUS_OPTIONS.find(o => o.value === s)?.color || 'neutral'
}
function getStatusLabel(s: string) {
  return OPPORTUNITY_STATUS_OPTIONS.find(o => o.value === s)?.label || s
}
function getForecastLabel(s: string | null | undefined) {
  if (!s) return '-'
  return FORECAST_CATEGORY_OPTIONS.find(o => o.value === s)?.label || s
}
function getSourceLabel(s: string | null | undefined) {
  if (!s) return '-'
  return OPPORTUNITY_SOURCE_OPTIONS.find(o => o.value === s)?.label || s
}
function getContactRoleLabel(s: string | null | undefined) {
  if (!s) return '-'
  return OPPORTUNITY_CONTACT_ROLE_OPTIONS.find(o => o.value === s)?.label || s
}
function getInfluenceLabel(s: string | null | undefined) {
  if (!s) return '-'
  return CONTACT_INFLUENCE_LEVEL_OPTIONS.find(o => o.value === s)?.label || s
}
function getAttitudeLabel(s: string | null | undefined) {
  if (!s) return '-'
  return CONTACT_ATTITUDE_OPTIONS.find(o => o.value === s)?.label || s
}
function getAttitudeColor(s: string | null | undefined) {
  if (s === 'supportive') return 'success'
  if (s === 'resistant') return 'error'
  return 'neutral'
}
function getLostReasonLabel(s: string | null | undefined) {
  if (!s) return ''
  return OPPORTUNITY_LOST_REASON_OPTIONS.find(o => o.value === s)?.label || s
}
function getPauseReasonLabel(s: string | null | undefined) {
  if (!s) return ''
  return OPPORTUNITY_PAUSE_REASON_OPTIONS.find(o => o.value === s)?.label || s
}
function getWonReasonLabel(s: string | null | undefined) {
  if (!s) return ''
  return OPPORTUNITY_WON_REASON_OPTIONS.find(o => o.value === s)?.label || s
}
function formatMoney(val: number | string | null | undefined) {
  if (val == null) return '--'
  const amount = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(amount)) return '--'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 }).format(amount)
}
function formatPercentValue(val: number | string | null | undefined) {
  if (val == null) return '--'
  const percent = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(percent)) return '--'
  return `${percent}%`
}
function getErrorMessage(err: unknown, fallback: string) {
  const error = err as { data?: { statusMessage?: string, message?: string }, message?: string }
  return error?.data?.statusMessage || error?.data?.message || error?.message || fallback
}
function canReopenOpportunity(value: Opportunity | null | undefined) {
  return value?.status === 'lost' || value?.status === 'paused'
}
function terminalTransitionPath(mode: TransitionTerminalMode) {
  if (mode === 'won') return `/api/v1/opportunities/${id.value}/close-won`
  if (mode === 'lost') return `/api/v1/opportunities/${id.value}/close-lost`
  return `/api/v1/opportunities/${id.value}/pause`
}

// 阶段流转
const stageLoading = ref(false)
const transitionReasonModalOpen = ref(false)
const transitionReasonMode = ref<TransitionTerminalMode>('lost')
const transitionReasonStage = ref<OpportunityStage | null>(null)
const transitionReasonForm = reactive({
  amount_tax_inclusive: null as number | null,
  expected_sign_date: '',
  reason_code: '',
  reason: '',
  competitor_info: ''
})
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
const stageRequirementTitle = computed(() =>
  stageRequirementStage.value ? `推进至「${stageRequirementStage.value.name}」` : '阶段推进'
)

function openTransitionReasonModal(stage: OpportunityStage, mode: TransitionTerminalMode) {
  transitionReasonStage.value = stage
  transitionReasonMode.value = mode
  transitionReasonForm.amount_tax_inclusive = opp.value?.amount_tax_inclusive ?? null
  transitionReasonForm.expected_sign_date = opp.value?.expected_sign_date?.slice(0, 10) || ''
  transitionReasonForm.reason_code = mode === 'won' ? 'business_value' : mode === 'lost' ? 'competitor_won' : 'procurement_paused'
  transitionReasonForm.reason = ''
  transitionReasonForm.competitor_info = mode === 'lost' ? (opp.value?.competitor_info || '') : ''
  transitionReasonModalOpen.value = true
}

function stageMatchesTerminalMode(stage: OpportunityStage, mode: TransitionTerminalMode) {
  return opportunityStageMatchesTerminalMode(stage, mode)
}

function terminalStageForMode(mode: TransitionTerminalMode) {
  return (stages.value || [])
    .filter(opportunityStageEnabled)
    .filter(stage => opportunityStagePipelineCode(stage) === currentPipelineCode.value)
    .find(stage => stageMatchesTerminalMode(stage, mode)) || null
}

function canTerminalTransition(mode: TransitionTerminalMode) {
  return opp.value?.status === 'active' && !!terminalStageForMode(mode)
}

function openTerminalTransition(mode: TransitionTerminalMode) {
  const stage = terminalStageForMode(mode)
  if (!stage) {
    toast.add({ title: '当前管线未配置对应阶段', color: 'error' })
    return
  }
  openTransitionReasonModal(stage, mode)
}

const canUseTerminalActions = computed(() =>
  opp.value?.status === 'active'
  && ['won', 'lost', 'paused'].some(mode => canTerminalTransition(mode as TransitionTerminalMode))
)
const terminalActionItems = computed<DropdownMenuItem[][]>(() => [[
  {
    label: '标记赢单',
    icon: 'i-lucide-trophy',
    color: 'success',
    disabled: !canTerminalTransition('won'),
    onSelect: () => openTerminalTransition('won')
  },
  {
    label: '标记输单',
    icon: 'i-lucide-x-circle',
    color: 'error',
    disabled: !canTerminalTransition('lost'),
    onSelect: () => openTerminalTransition('lost')
  },
  {
    label: '暂停商机',
    icon: 'i-lucide-pause-circle',
    color: 'warning',
    disabled: !canTerminalTransition('paused'),
    onSelect: () => openTerminalTransition('paused')
  }
]])

function stageRequirementFieldVisible(field: string) {
  return stageRequirementFields.value.includes(field)
}

function openStageRequirementModal(stage: OpportunityStage, fields: string[]) {
  const current = opp.value
  stageRequirementStage.value = stage
  stageRequirementFields.value = fields
  stageRequirementForm.amount_tax_inclusive = current?.amount_tax_inclusive ?? null
  stageRequirementForm.expected_sign_date = current?.expected_sign_date?.slice(0, 10) || ''
  stageRequirementForm.competitor_info = current?.competitor_info || ''
  stageRequirementForm.next_action = current?.next_action || ''
  stageRequirementForm.next_action_due_at = current?.next_action_due_at?.slice(0, 10) || ''
  stageRequirementForm.reason = ''
  stageRequirementModalOpen.value = true
}

function blockOrOpenStageRequirements(stage: OpportunityStage) {
  const missingFields = getOpportunityTransitionMissingFields(currentOpportunityStage.value, stage, opp.value || null)
  if (!missingFields.length) return false

  const editableFields = expandOpportunityStageRequirementFields(
    missingFields.filter(isEditableOpportunityStageRequirement),
    opp.value || null
  )
  const blockedFields = missingFields.filter(field => !isEditableOpportunityStageRequirement(field))
  if (blockedFields.length) {
    toast.add({
      title: `请先补充${blockedFields.map(opportunityStageRequirementLabel).join('、')}`,
      color: 'error'
    })
    return true
  }

  openStageRequirementModal(stage, editableFields)
  return true
}

async function changeStage(stageId: number) {
  if (!opp.value || stageId === opp.value.stage_id) return

  const stageName = stages.value?.find(s => s.id === stageId)?.name
  const stage = stages.value?.find(s => s.id === stageId)

  if (stage && stageMatchesTerminalMode(stage, 'won')) {
    openTransitionReasonModal(stage, 'won')
    return
  }
  if (stage && stageMatchesTerminalMode(stage, 'lost')) {
    openTransitionReasonModal(stage, 'lost')
    return
  }
  if (stage && stageMatchesTerminalMode(stage, 'paused')) {
    openTransitionReasonModal(stage, 'paused')
    return
  }
  if (stage && blockOrOpenStageRequirements(stage)) {
    return
  }

  stageLoading.value = true
  try {
    await $fetch(`/api/v1/opportunities/${id.value}/transition`, {
      method: 'POST',
      body: { stage_id: stageId }
    })
    toast.add({ title: `阶段已更新为「${stageName}」`, color: 'success' })
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '操作失败'), color: 'error' })
  } finally {
    stageLoading.value = false
  }
}

async function submitStageRequirementTransition() {
  if (!stageRequirementStage.value) return
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

  stageLoading.value = true
  try {
    await $fetch(`/api/v1/opportunities/${id.value}/transition`, {
      method: 'POST',
      body
    })
    toast.add({ title: `阶段已更新为「${stage.name}」`, color: 'success' })
    stageRequirementModalOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '操作失败'), color: 'error' })
  } finally {
    stageLoading.value = false
  }
}

async function submitTransitionReason() {
  if (!transitionReasonStage.value) return
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
  stageLoading.value = true
  try {
    await $fetch(terminalTransitionPath(transitionReasonMode.value), {
      method: 'POST',
      body
    })
    toast.add({ title: `已标记为${stage.name}`, color: 'success' })
    transitionReasonModalOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '操作失败'), color: 'error' })
  } finally {
    stageLoading.value = false
  }
}

async function reopenOpportunity() {
  if (!opp.value || !canReopenOpportunity(opp.value)) return
  stageLoading.value = true
  try {
    await $fetch(`/api/v1/opportunities/${id.value}/reopen`, {
      method: 'POST',
      body: {
        change_reason: '重新打开商机'
      }
    })
    toast.add({ title: '商机已重新打开', color: 'success' })
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '重新打开失败'), color: 'error' })
  } finally {
    stageLoading.value = false
  }
}

// 阶段进度条
const currentOpportunityStage = computed(() => {
  const stageId = opp.value?.stage_id
  if (stageId == null) return null
  return stages.value?.find(s => Number(s.id) === Number(stageId)) || null
})
const currentPipelineCode = computed(() => currentOpportunityStage.value ? opportunityStagePipelineCode(currentOpportunityStage.value) : 'default')
const activeStages = computed(() => (stages.value || [])
  .filter(isOpportunityOpenNormalStage)
  .filter(s => opportunityStagePipelineCode(s) === currentPipelineCode.value))
const currentStageIndex = computed(() => {
  const currentOpportunity = opp.value
  if (!currentOpportunity) return -1
  return activeStages.value.findIndex(s => Number(s.id) === Number(currentOpportunity.stage_id))
})
const opportunityRisks = computed(() => opp.value ? getOpportunityRisks(opp.value) : [])
const opportunityRiskAlertClass = computed(() =>
  opportunityRisks.value.some(risk => risk.color === 'error')
    ? 'border-error/30 bg-error/5 text-error'
    : 'border-warning/30 bg-warning/5 text-warning'
)

// 干系人维护
const contactRoleModalOpen = ref(false)
const contactRoleLoading = ref(false)
const contactRoleContactsLoading = ref(false)
const contactRoleEditing = ref<OpportunityContactRole | null>(null)
const contactRoleDeleteTarget = ref<OpportunityContactRole | null>(null)
const customerContacts = ref<Contact[]>([])
const contactRoleForm = reactive({
  contact_id: undefined as number | undefined,
  role: 'decision_maker',
  influence_level: 'medium',
  attitude: 'unknown',
  is_primary: false,
  remark: ''
})
const contactRoleOptions = OPPORTUNITY_CONTACT_ROLE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const influenceOptions = CONTACT_INFLUENCE_LEVEL_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const attitudeOptions = CONTACT_ATTITUDE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const customerContactOptions = computed(() =>
  customerContacts.value.map(contact => ({
    label: [
      contact.name,
      contact.job_title,
      contact.mobile || contact.email
    ].filter(Boolean).join(' · '),
    value: contact.id
  }))
)
const contactRoleModalTitle = computed(() => contactRoleEditing.value ? '编辑干系人' : '新增干系人')

function resetContactRoleForm() {
  contactRoleForm.contact_id = undefined
  contactRoleForm.role = 'decision_maker'
  contactRoleForm.influence_level = 'medium'
  contactRoleForm.attitude = 'unknown'
  contactRoleForm.is_primary = false
  contactRoleForm.remark = ''
}

async function loadCustomerContacts() {
  if (!opp.value?.customer_id) return
  contactRoleContactsLoading.value = true
  try {
    const res = await $fetch<unknown>(`/api/v1/customers/${opp.value.customer_id}/contacts`, {
      query: { pageSize: 100 }
    })
    customerContacts.value = unwrapApiList<Contact>(res)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '联系人加载失败'), color: 'error' })
  } finally {
    contactRoleContactsLoading.value = false
  }
}

async function openCreateContactRole() {
  resetContactRoleForm()
  contactRoleEditing.value = null
  contactRoleModalOpen.value = true
  await loadCustomerContacts()
}

async function openEditContactRole(role: OpportunityContactRole) {
  contactRoleEditing.value = role
  contactRoleForm.contact_id = Number(role.contact_id)
  contactRoleForm.role = role.role || 'decision_maker'
  contactRoleForm.influence_level = role.influence_level || 'medium'
  contactRoleForm.attitude = role.attitude || 'unknown'
  contactRoleForm.is_primary = Boolean(role.is_primary)
  contactRoleForm.remark = role.remark || ''
  contactRoleModalOpen.value = true
  await loadCustomerContacts()
}

async function submitContactRole() {
  if (!contactRoleEditing.value && !contactRoleForm.contact_id) {
    toast.add({ title: '请选择联系人', color: 'error' })
    return
  }
  if (!contactRoleForm.role) {
    toast.add({ title: '请选择干系人角色', color: 'error' })
    return
  }
  const body = {
    contact_id: contactRoleForm.contact_id,
    role: contactRoleForm.role,
    influence_level: contactRoleForm.influence_level || null,
    attitude: contactRoleForm.attitude || null,
    is_primary: contactRoleForm.is_primary,
    remark: contactRoleForm.remark.trim() || null
  }
  contactRoleLoading.value = true
  try {
    if (contactRoleEditing.value) {
      await $fetch(`/api/v1/opportunities/${id.value}/contact-roles/${contactRoleEditing.value.id}`, {
        method: 'PUT',
        body
      })
      toast.add({ title: '干系人已更新', color: 'success' })
    } else {
      await $fetch(`/api/v1/opportunities/${id.value}/contact-roles`, {
        method: 'POST',
        body
      })
      toast.add({ title: '干系人已添加', color: 'success' })
    }
    contactRoleModalOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '保存干系人失败'), color: 'error' })
  } finally {
    contactRoleLoading.value = false
  }
}

function openDeleteContactRole(role: OpportunityContactRole) {
  contactRoleDeleteTarget.value = role
}

async function deleteContactRole() {
  if (!contactRoleDeleteTarget.value) return
  contactRoleLoading.value = true
  try {
    await $fetch(`/api/v1/opportunities/${id.value}/contact-roles/${contactRoleDeleteTarget.value.id}`, {
      method: 'DELETE'
    })
    toast.add({ title: '干系人已移除', color: 'success' })
    contactRoleDeleteTarget.value = null
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '移除干系人失败'), color: 'error' })
  } finally {
    contactRoleLoading.value = false
  }
}

// 活动类型标签
const activityTypeLabels: Record<string, string> = {
  visit: '拜访', call: '电话', demo: '演示',
  meeting: '会议', tender: '投标', memo: '纪要'
}
const activityTypeOptions = Object.entries(activityTypeLabels).map(([v, l]) => ({ label: l, value: v }))

// 新建活动
const showActivityModal = ref(false)
const activityLoading = ref(false)
const activityForm = reactive({
  activity_type: 'memo',
  subject: '',
  content: '',
  result_summary: '',
  next_action: '',
  next_action_due_at: '',
  activity_at: new Date().toISOString().slice(0, 16)
})

function resetActivityForm() {
  activityForm.activity_type = 'memo'
  activityForm.subject = ''
  activityForm.content = ''
  activityForm.result_summary = ''
  activityForm.next_action = ''
  activityForm.next_action_due_at = ''
  activityForm.activity_at = new Date().toISOString().slice(0, 16)
}

async function createActivity() {
  if (!activityForm.subject.trim()) {
    toast.add({ title: '请输入活动主题', color: 'error' })
    return
  }
  if (activityForm.next_action.trim() && !activityForm.next_action_due_at) {
    toast.add({ title: '请填写下一步截止日期', color: 'error' })
    return
  }
  activityLoading.value = true
  try {
    await $fetch(`/api/v1/opportunities/${id.value}/activities`, {
      method: 'POST',
      body: activityForm
    })
    toast.add({ title: '活动记录已添加', color: 'success' })
    showActivityModal.value = false
    resetActivityForm()
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '添加失败'), color: 'error' })
  } finally {
    activityLoading.value = false
  }
}

// 阶段历史列
const stageLogColumns = [
  { accessorKey: 'changed_at', header: '时间' },
  { accessorKey: 'from_stage_name', header: '原阶段' },
  { accessorKey: 'to_stage_name', header: '新阶段' },
  { accessorKey: 'snapshot', header: '变更后快照' },
  { accessorKey: 'changed_by', header: '操作人' },
  { accessorKey: 'change_reason', header: '原因' }
]
</script>

<template>
  <UDashboardPanel id="opportunity-detail">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.push('/opportunities')"
        />
        <div v-if="opp" class="flex items-center gap-2">
          <span class="font-semibold">{{ opp.name }}</span>
          <UBadge :color="getStatusColor(opp.status)" variant="subtle" size="sm">
            {{ getStatusLabel(opp.status) }}
          </UBadge>
          <span class="text-xs text-muted font-mono">{{ opp.code }}</span>
        </div>
        <USkeleton v-else class="h-6 w-48" />
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UDropdownMenu
          v-if="canUseTerminalActions"
          :items="terminalActionItems"
          :content="{ align: 'end' }"
        >
          <UButton
            label="状态动作"
            icon="i-lucide-flag"
            variant="soft"
            color="neutral"
            :loading="stageLoading"
          />
        </UDropdownMenu>
        <UButton
          v-if="canReopenOpportunity(opp)"
          label="重新打开"
          icon="i-lucide-rotate-ccw"
          variant="soft"
          color="primary"
          :loading="stageLoading"
          @click="reopenOpportunity"
        />
        <UButton
          v-if="opp"
          label="编辑"
          icon="i-lucide-pencil"
          variant="soft"
          color="primary"
          @click="router.push(`/opportunities/${id}/edit`)"
        />
      </Teleport>

      <div v-if="status === 'pending'" class="p-6">
        <USkeleton class="h-64 w-full" />
      </div>

      <div v-else-if="opp" class="p-4 space-y-4">
        <!-- 阶段进度条 -->
        <UCard v-if="opp.status === 'active'">
          <div class="flex items-center gap-1 overflow-x-auto">
            <button
              v-for="(stage, idx) in activeStages"
              :key="stage.id"
              class="flex-1 min-w-0 text-center py-2 px-3 text-xs rounded transition-colors"
              :class="{
                'bg-primary text-white': idx === currentStageIndex,
                'bg-primary/20 text-primary': idx < currentStageIndex,
                'bg-elevated text-muted': idx > currentStageIndex,
                'cursor-pointer hover:bg-primary/10': stage.id !== opp.stage_id
              }"
              :disabled="stageLoading"
              @click="changeStage(stage.id)"
            >
              {{ stage.name }}
              <div class="text-[10px] opacity-70">
                {{ stage.win_rate }}%
              </div>
            </button>
          </div>
        </UCard>

        <!-- 摘要卡片 -->
        <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
          <UCard>
            <div class="text-center">
              <div class="text-xl font-bold font-mono">
                {{ formatMoney(opp.amount_tax_inclusive) }}
              </div>
              <div class="text-xs text-muted mt-1">
                预计金额
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="text-center">
              <div class="text-xl font-bold">
                {{ opp.win_rate ?? opp.stage_win_rate ?? '--' }}%
              </div>
              <div class="text-xs text-muted mt-1">
                赢率
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="text-center">
              <div class="text-xl font-bold">
                {{ opp.stage_name }}
              </div>
              <div class="text-xs text-muted mt-1">
                当前阶段
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="text-center">
              <div class="text-xl font-bold">
                {{ getForecastLabel(opp.forecast_category) }}
              </div>
              <div class="text-xs text-muted mt-1 flex items-center justify-center gap-1">
                预测分类
                <UTooltip>
                  <template #content>
                    <div class="text-xs space-y-1 p-1">
                      <div>管线：有可能成交的机会</div>
                      <div>最佳预期：如果顺利，3个月到半年内能签单</div>
                      <div>承诺：客户已口头确认，3个月内定能下单</div>
                    </div>
                  </template>
                  <UIcon name="i-lucide-info" class="w-3 h-3" />
                </UTooltip>
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="text-center">
              <div class="text-xl font-bold text-sm">
                {{ opp.expected_sign_date || '--' }}
              </div>
              <div class="text-xs text-muted mt-1">
                预计签约
              </div>
            </div>
          </UCard>
        </div>

        <div
          v-if="opportunityRisks.length"
          class="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
          :class="opportunityRiskAlertClass"
        >
          <UIcon name="i-lucide-triangle-alert" class="size-4" />
          <span class="font-medium">风险提醒</span>
          <UBadge
            v-for="risk in opportunityRisks"
            :key="risk.key"
            :color="risk.color"
            variant="subtle"
            size="xs"
            :icon="risk.icon"
          >
            {{ risk.label }}
          </UBadge>
        </div>

        <!-- Tabs -->
        <UTabs v-model="activeTab" :items="tabs" class="w-full" />

        <!-- 基本信息 -->
        <UCard v-if="activeTab === 'info'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
            <div class="flex">
              <span class="text-muted w-28 shrink-0">所属客户</span>
              <NuxtLink :to="`/customers/${opp.customer_id}`" class="text-primary hover:underline">{{ opp.customer_name }}</NuxtLink>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">负责人</span><UserName :uid="opp.owner_user_id" />
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">售前负责人</span><span>{{ opp.pre_sales_user_id || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">交付负责人</span><span>{{ opp.delivery_user_id || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">预计回款日期</span><span>{{ opp.expected_payment_date || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">商机来源</span><span>{{ getSourceLabel(opp.source_type) }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">风险等级</span>
              <UBadge
                v-if="opp.risk_level"
                :color="opp.risk_level === 'high' ? 'error' : opp.risk_level === 'medium' ? 'warning' : 'success'"
                variant="subtle"
                size="sm"
              >
                {{ opp.risk_level === 'high' ? '高' : opp.risk_level === 'medium' ? '中' : '低' }}
              </UBadge>
              <span v-else>-</span>
            </div>
            <div class="flex md:col-span-2">
              <span class="text-muted w-28 shrink-0">下一步动作</span><span>{{ opp.next_action || '-' }}</span>
            </div>
            <div class="flex md:col-span-2">
              <span class="text-muted w-28 shrink-0">来源说明</span><span>{{ opp.source_detail || '-' }}</span>
            </div>
            <div class="flex md:col-span-2">
              <span class="text-muted w-28 shrink-0">竞品信息</span><span>{{ opp.competitor_info || '-' }}</span>
            </div>
            <div v-if="opp.won_reason" class="flex md:col-span-2">
              <span class="text-muted w-28 shrink-0">赢单原因</span>
              <span class="text-success">
                {{ getWonReasonLabel(opp.won_reason_code) || '未分类' }}：{{ opp.won_reason }}
              </span>
            </div>
            <div v-if="opp.lost_reason" class="flex md:col-span-2">
              <span class="text-muted w-28 shrink-0">输单原因</span>
              <span class="text-error">
                {{ getLostReasonLabel(opp.lost_reason_code) || '未分类' }}：{{ opp.lost_reason }}
              </span>
            </div>
            <div v-if="opp.pause_reason" class="flex md:col-span-2">
              <span class="text-muted w-28 shrink-0">暂停原因</span>
              <span class="text-warning">
                {{ getPauseReasonLabel(opp.pause_reason_code) || '未分类' }}：{{ opp.pause_reason }}
              </span>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">创建时间</span><span class="text-xs">{{ opp.created_at }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">更新时间</span><span class="text-xs">{{ opp.updated_at }}</span>
            </div>
          </div>
        </UCard>

        <!-- 干系人 -->
        <UCard v-if="activeTab === 'contacts'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">干系人 ({{ opp.contact_roles?.length || 0 }})</span>
              <UButton
                label="新增干系人"
                icon="i-lucide-user-plus"
                size="sm"
                variant="soft"
                @click="openCreateContactRole"
              />
            </div>
          </template>
          <div v-if="opp.contact_roles?.length" class="space-y-3">
            <div
              v-for="role in opp.contact_roles"
              :key="role.id"
              class="rounded-md border border-default px-3 py-3"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium text-sm">{{ role.contact_name || `联系人 #${role.contact_id}` }}</span>
                <UBadge
                  v-if="role.is_primary"
                  color="primary"
                  variant="subtle"
                  size="xs"
                >
                  主要
                </UBadge>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ getContactRoleLabel(role.role) }}
                </UBadge>
                <UBadge :color="getAttitudeColor(role.attitude)" variant="subtle" size="xs">
                  {{ getAttitudeLabel(role.attitude) }}
                </UBadge>
              </div>
              <div class="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-muted">
                <span>{{ role.contact_mobile || role.contact_email || '-' }}</span>
                <span>{{ role.contact_dept_name || '-' }}</span>
                <span>影响力：{{ getInfluenceLabel(role.influence_level) }}</span>
              </div>
              <p v-if="role.remark" class="mt-2 text-sm text-muted">
                {{ role.remark }}
              </p>
              <div class="mt-3 flex justify-end gap-1">
                <UButton
                  icon="i-lucide-pencil"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  title="编辑干系人"
                  @click="openEditContactRole(role)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  size="xs"
                  variant="ghost"
                  color="error"
                  title="移除干系人"
                  @click="openDeleteContactRole(role)"
                />
              </div>
            </div>
          </div>
          <div v-else class="text-center py-8 text-muted text-sm">
            <div class="flex flex-col items-center gap-3">
              <span>暂无干系人</span>
              <UButton
                label="新增干系人"
                icon="i-lucide-user-plus"
                size="sm"
                variant="soft"
                @click="openCreateContactRole"
              />
            </div>
          </div>
        </UCard>

        <!-- 活动记录 -->
        <UCard v-if="activeTab === 'activities'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">活动记录 ({{ opp.activities?.length || 0 }})</span>
              <UButton
                label="新增活动"
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="showActivityModal = true"
              />
            </div>
          </template>
          <div v-if="opp.activities?.length" class="space-y-3">
            <div v-for="act in opp.activities" :key="act.id" class="border-b border-default pb-3 last:border-0">
              <div class="flex items-center gap-2">
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ activityTypeLabels[act.activity_type] || act.activity_type }}
                </UBadge>
                <span class="font-medium text-sm">{{ act.subject }}</span>
                <span class="text-xs text-muted ml-auto">{{ act.activity_at }}</span>
              </div>
              <p v-if="act.content" class="text-sm text-muted mt-1 line-clamp-2">
                {{ act.content }}
              </p>
              <p v-if="act.result_summary" class="text-xs mt-1">
                结果：{{ act.result_summary }}
              </p>
              <p v-if="act.next_action" class="text-xs text-primary mt-1">
                下一步：{{ act.next_action }}
              </p>
            </div>
          </div>
          <div v-else class="text-center py-8 text-muted text-sm">
            暂无活动记录
          </div>
        </UCard>

        <!-- 阶段历史 -->
        <UCard v-if="activeTab === 'stages'">
          <UTable :data="opp.stage_logs || []" :columns="stageLogColumns">
            <template #changed_at-cell="{ row }">
              <span class="text-xs">{{ row.original.changed_at }}</span>
            </template>
            <template #from_stage_name-cell="{ row }">
              {{ row.original.from_stage_name || '(新建)' }}
            </template>
            <template #snapshot-cell="{ row }">
              <div class="flex flex-wrap gap-1">
                <UBadge size="xs" color="neutral" variant="subtle">
                  金额 {{ formatMoney(row.original.amount_snapshot) }}
                </UBadge>
                <UBadge size="xs" color="neutral" variant="subtle">
                  预测 {{ getForecastLabel(row.original.forecast_category_snapshot) }}
                </UBadge>
                <UBadge size="xs" color="neutral" variant="subtle">
                  签约 {{ row.original.expected_sign_date_snapshot || '--' }}
                </UBadge>
                <UBadge size="xs" color="neutral" variant="subtle">
                  赢率 {{ formatPercentValue(row.original.win_rate_snapshot) }}
                </UBadge>
                <UBadge size="xs" color="neutral" variant="subtle">
                  v{{ row.original.version_no || '-' }}
                </UBadge>
              </div>
            </template>
            <template #change_reason-cell="{ row }">
              {{ row.original.change_reason || '-' }}
            </template>
            <template #empty>
              <div class="text-center py-6 text-muted text-sm">
                暂无阶段流转记录
              </div>
            </template>
          </UTable>
        </UCard>

        <!-- 报价 -->
        <UCard v-if="activeTab === 'quotes'">
          <div v-if="opp.quotations?.length" class="space-y-2">
            <div v-for="q in opp.quotations" :key="q.id" class="flex items-center justify-between border-b border-default pb-2 last:border-0">
              <div>
                <span class="font-mono text-xs text-muted">{{ q.code }}</span>
                <span class="ml-2 text-sm">v{{ q.version_no }}</span>
                <UBadge
                  class="ml-2"
                  :color="q.status === 'accepted' ? 'success' : q.status === 'approved' ? 'primary' : 'neutral'"
                  variant="subtle"
                  size="xs"
                >
                  {{ q.status }}
                </UBadge>
              </div>
              <div class="text-right">
                <span class="font-mono text-sm">{{ formatMoney(q.amount_tax_inclusive) }}</span>
                <span class="text-xs text-muted ml-2">{{ q.created_at }}</span>
              </div>
            </div>
          </div>
          <div v-else class="text-center py-8 text-muted text-sm">
            暂无关联报价
          </div>
        </UCard>

        <!-- 文档 -->
        <DocumentsPanel v-if="activeTab === 'documents'" entity-type="opportunity" :entity-id="Number(id)" />

        <UCard v-if="activeTab === 'audit'">
          <template #header>
            <span class="font-semibold text-sm">操作历史</span>
          </template>
          <AuditTimeline entity-type="opportunity" :entity-id="Number(id)" />
        </UCard>
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
              :loading="stageLoading"
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
              :loading="stageLoading"
              @click="submitTransitionReason"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <UModal v-model:open="contactRoleModalOpen">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">{{ contactRoleModalTitle }}</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="contactRoleModalOpen = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="联系人" required>
            <USelect
              v-model="contactRoleForm.contact_id"
              :items="customerContactOptions"
              :loading="contactRoleContactsLoading"
              :disabled="!!contactRoleEditing"
              placeholder="选择该客户下的联系人"
              class="w-full"
            />
          </UFormField>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="角色" required>
              <USelect
                v-model="contactRoleForm.role"
                :items="contactRoleOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField label="影响力">
              <USelect
                v-model="contactRoleForm.influence_level"
                :items="influenceOptions"
                class="w-full"
              />
            </UFormField>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="态度">
              <USelect
                v-model="contactRoleForm.attitude"
                :items="attitudeOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField label="主要联系人">
              <div class="flex h-9 items-center">
                <USwitch v-model="contactRoleForm.is_primary" />
              </div>
            </UFormField>
          </div>
          <UFormField label="备注">
            <UTextarea
              v-model="contactRoleForm.remark"
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
              @click="contactRoleModalOpen = false"
            />
            <UButton
              label="保存"
              color="primary"
              :loading="contactRoleLoading"
              @click="submitContactRole"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <UModal :open="!!contactRoleDeleteTarget" @update:open="value => { if (!value) contactRoleDeleteTarget = null }">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">移除干系人</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="contactRoleDeleteTarget = null"
            />
          </div>
        </template>
        <p class="text-sm text-muted">
          确认从当前商机移除
          <span class="font-medium text-default">{{ contactRoleDeleteTarget?.contact_name || '该联系人' }}</span>
          的干系人角色？
        </p>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="contactRoleDeleteTarget = null"
            />
            <UButton
              label="确认移除"
              color="error"
              :loading="contactRoleLoading"
              @click="deleteContactRole"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <!-- 新增活动弹窗 -->
  <UModal v-model:open="showActivityModal">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">新增活动记录</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="showActivityModal = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="活动类型">
              <USelect v-model="activityForm.activity_type" :items="activityTypeOptions" class="w-full" />
            </UFormField>
            <UFormField label="时间">
              <UInput v-model="activityForm.activity_at" type="datetime-local" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="主题" required>
            <UInput v-model="activityForm.subject" placeholder="如：客户需求沟通会议" class="w-full" />
          </UFormField>
          <UFormField label="内容/纪要">
            <UTextarea
              v-model="activityForm.content"
              placeholder="活动内容或会议纪要"
              :rows="3"
              class="w-full"
            />
          </UFormField>
          <UFormField label="结果摘要">
            <UInput v-model="activityForm.result_summary" placeholder="本次活动结论" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="下一步动作">
              <UInput v-model="activityForm.next_action" placeholder="下一步计划" class="w-full" />
            </UFormField>
            <UFormField label="截止日期">
              <UInput v-model="activityForm.next_action_due_at" type="date" class="w-full" />
            </UFormField>
          </div>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="showActivityModal = false"
            />
            <UButton
              label="保存"
              color="primary"
              :loading="activityLoading"
              @click="createActivity"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
