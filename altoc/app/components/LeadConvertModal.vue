<script setup lang="ts">
import type { Lead, OpportunityStage } from '~/types/altoc'
import {
  BUDGET_STATUS_OPTIONS,
  CONTACT_ATTITUDE_OPTIONS,
  CONTACT_INFLUENCE_LEVEL_OPTIONS,
  FORECAST_CATEGORY_OPTIONS,
  LEAD_PROJECT_TYPE_OPTIONS,
  OPPORTUNITY_PIPELINE_OPTIONS,
  PROCUREMENT_MODE_OPTIONS,
  OPPORTUNITY_CONTACT_ROLE_OPTIONS
} from '~/types/altoc'
import { unwrapApiData } from '~/utils/apiResponse'
import { isOpportunityOpenNormalStage, opportunityStagePipelineCode } from '~/utils/opportunityStages'

const props = defineProps<{
  open: boolean
  lead: Lead | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'converted': [payload: LeadConversionResponse]
}>()

interface CustomerCandidate {
  id: number | string
  code?: string | null
  name: string
  short_name?: string | null
  owner_user_id?: string | null
  last_follow_up_at?: string | null
}

interface ContactCandidate {
  id: number | string
  customer_id: number | string
  customer_code?: string | null
  customer_name?: string | null
  name: string
  mobile?: string | null
  email?: string | null
  job_title?: string | null
  decision_role?: string | null
  influence_level?: string | null
}

interface SimilarOpportunityCandidate {
  id: number | string
  code?: string | null
  name: string
  customer_id: number | string
  customer_name?: string | null
  stage_name?: string | null
  status?: string | null
  amount_tax_inclusive?: number | null
  expected_sign_date?: string | null
  owner_user_id?: string | null
}

interface LeadConversionCandidatesResponse {
  customers?: CustomerCandidate[]
  contacts?: ContactCandidate[]
  similar_open_opportunities?: SimilarOpportunityCandidate[]
  stages?: OpportunityStage[]
}

interface LeadConversionResponse {
  opportunity_id: number | string
}

const toast = useToast()
const modalOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const convertStep = ref(0)
const convertIdempotencyKey = ref('')
const convertForm = reactive({
  need_summary: '',
  project_type: '',
  budget_status: 'unknown',
  procurement_mode: '',
  expected_procurement_date: '',
  source_evidence_url: '',
  customer_name: '',
  customer_id: null as number | null,
  unified_social_credit_code: '',
  organization_domain: '',
  contact_id: null as number | null,
  contact_name: '',
  contact_mobile: '',
  contact_email: '',
  contact_role: 'sponsor',
  contact_influence_level: 'medium',
  contact_attitude: 'neutral',
  opportunity_name: '',
  pipeline_code: 'default',
  stage_id: undefined as number | undefined,
  owner_user_id: '',
  forecast_category: 'pipeline',
  amount: null as number | null,
  expected_sign_date: '',
  next_action: '',
  next_action_due_at: '',
  ack_similar_opportunity: false
})
const convertLoading = ref(false)
const candidateLoading = ref(false)
const customerCandidates = ref<CustomerCandidate[]>([])
const contactCandidates = ref<ContactCandidate[]>([])
const similarOpportunityCandidates = ref<SimilarOpportunityCandidate[]>([])
const stageCandidates = ref<OpportunityStage[]>([])

const convertSteps = [
  { label: '资格确认', value: 0 },
  { label: '匹配客户', value: 1 },
  { label: '创建商机', value: 2 }
]
const contactRoleOptions = OPPORTUNITY_CONTACT_ROLE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const contactInfluenceOptions = CONTACT_INFLUENCE_LEVEL_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const contactAttitudeOptions = CONTACT_ATTITUDE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const forecastOptions = FORECAST_CATEGORY_OPTIONS.filter(o => o.value !== 'commit').map(o => ({ label: o.label, value: o.value }))
const pipelineOptions = OPPORTUNITY_PIPELINE_OPTIONS
const projectTypeOptions = LEAD_PROJECT_TYPE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const budgetStatusOptions = BUDGET_STATUS_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const procurementModeOptions = PROCUREMENT_MODE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const stageOptions = computed(() => {
  const openStages = stageCandidates.value
    .filter(isOpportunityOpenNormalStage)
    .filter(stage => opportunityStagePipelineCode(stage) === convertForm.pipeline_code)
  return openStages.map(stage => ({ label: `${stage.name} · ${stage.win_rate}%`, value: Number(stage.id) }))
})

const qualificationChecks = computed(() => {
  const lead = props.lead
  if (!lead) return []
  return [
    { label: '客户对象', ok: Boolean(convertForm.customer_id || convertForm.customer_name.trim() || lead.org_name || lead.name) },
    { label: '需求摘要', ok: Boolean(convertForm.need_summary.trim() || lead.need_summary?.trim()) },
    { label: '联系人或证据', ok: Boolean(convertForm.contact_id || convertForm.contact_name.trim() || convertForm.contact_mobile.trim() || convertForm.contact_email.trim() || convertForm.source_evidence_url.trim() || lead.contact_name || lead.contact_mobile || lead.contact_email || lead.source_evidence_url) },
    { label: '负责人', ok: Boolean(convertForm.owner_user_id.trim() || lead.owner_user_id) },
    { label: '下一步行动', ok: Boolean(convertForm.next_action.trim() && convertForm.next_action_due_at) }
  ]
})
const qualificationReady = computed(() => qualificationChecks.value.every(item => item.ok))
const visibleContactCandidates = computed(() => {
  if (!convertForm.customer_id) return contactCandidates.value
  return contactCandidates.value.filter(item => Number(item.customer_id) === convertForm.customer_id)
})
const visibleSimilarOpportunityCandidates = computed(() => {
  if (!convertForm.customer_id) return similarOpportunityCandidates.value
  return similarOpportunityCandidates.value.filter(item => Number(item.customer_id) === convertForm.customer_id)
})

watch(
  [() => props.open, () => props.lead?.id],
  ([open]) => {
    if (open && props.lead) {
      resetForLead(props.lead)
      void loadConversionCandidates(props.lead)
    }
  },
  { immediate: true }
)

watch(() => convertForm.pipeline_code, () => {
  syncDefaultStageForPipeline()
})

function resetForLead(lead: Lead) {
  convertStep.value = 0
  convertIdempotencyKey.value = `lead-${lead.id}-${Date.now()}`
  convertForm.need_summary = lead.need_summary || ''
  convertForm.project_type = lead.project_type || ''
  convertForm.budget_status = lead.budget_status || 'unknown'
  convertForm.procurement_mode = lead.procurement_mode || ''
  convertForm.expected_procurement_date = lead.expected_procurement_date ? lead.expected_procurement_date.slice(0, 10) : ''
  convertForm.source_evidence_url = lead.source_evidence_url || ''
  convertForm.customer_name = lead.org_name || lead.name
  convertForm.customer_id = null
  convertForm.unified_social_credit_code = ''
  convertForm.organization_domain = ''
  convertForm.contact_id = null
  convertForm.contact_name = lead.contact_name || ''
  convertForm.contact_mobile = lead.contact_mobile || ''
  convertForm.contact_email = lead.contact_email || ''
  convertForm.contact_role = 'sponsor'
  convertForm.contact_influence_level = 'medium'
  convertForm.contact_attitude = 'neutral'
  convertForm.opportunity_name = lead.name
  convertForm.pipeline_code = pipelineCodeForLead(lead)
  convertForm.stage_id = undefined
  convertForm.owner_user_id = lead.owner_user_id || ''
  convertForm.forecast_category = 'pipeline'
  convertForm.amount = lead.estimated_budget || null
  convertForm.expected_sign_date = convertForm.expected_procurement_date
  convertForm.next_action = lead.next_action || ''
  convertForm.next_action_due_at = lead.next_action_due_at ? lead.next_action_due_at.slice(0, 10) : ''
  convertForm.ack_similar_opportunity = false
  customerCandidates.value = []
  contactCandidates.value = []
  similarOpportunityCandidates.value = []
  stageCandidates.value = []
}

async function loadConversionCandidates(lead: Lead) {
  candidateLoading.value = true
  try {
    const response = await $fetch<unknown>(`/api/v1/leads/${lead.id}/conversion-preview` as string, {
      query: {
        customer_name: convertForm.customer_name || undefined,
        unified_social_credit_code: convertForm.unified_social_credit_code || undefined,
        organization_domain: convertForm.organization_domain || undefined,
        contact_name: convertForm.contact_name || undefined,
        contact_mobile: convertForm.contact_mobile || undefined,
        contact_email: convertForm.contact_email || undefined
      }
    })
    const data = unwrapApiData<LeadConversionCandidatesResponse>(response) as LeadConversionCandidatesResponse
    if (props.lead?.id !== lead.id) return
    customerCandidates.value = data.customers || []
    contactCandidates.value = data.contacts || []
    similarOpportunityCandidates.value = data.similar_open_opportunities || []
    stageCandidates.value = data.stages || []
    syncDefaultStageForPipeline()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '候选匹配失败'), color: 'warning' })
  } finally {
    candidateLoading.value = false
  }
}

function pipelineCodeForLead(lead: Lead) {
  switch (lead.project_type) {
    case 'tog':
      return 'tog_project'
    case 'tob':
      return 'solution'
    default:
      return 'default'
  }
}

function syncDefaultStageForPipeline() {
  const currentStageStillAvailable = stageOptions.value.some(stage => stage.value === Number(convertForm.stage_id))
  if (currentStageStillAvailable) return
  convertForm.stage_id = stageOptions.value[0]?.value
}

function refreshConversionCandidates() {
  if (!props.lead) return
  void loadConversionCandidates(props.lead)
}

function selectCustomer(candidate: CustomerCandidate) {
  convertForm.customer_id = Number(candidate.id)
  convertForm.customer_name = candidate.name
  convertForm.contact_id = null
  convertForm.ack_similar_opportunity = false
}

function clearCustomerSelection() {
  convertForm.customer_id = null
  convertForm.customer_name = props.lead?.org_name || props.lead?.name || ''
  convertForm.contact_id = null
  convertForm.ack_similar_opportunity = false
}

function selectContact(candidate: ContactCandidate) {
  convertForm.contact_id = Number(candidate.id)
  convertForm.contact_name = candidate.name
  convertForm.contact_mobile = candidate.mobile || ''
  convertForm.contact_email = candidate.email || ''
  if (candidate.customer_id) {
    convertForm.customer_id = Number(candidate.customer_id)
    convertForm.ack_similar_opportunity = false
  }
  if (candidate.customer_name) {
    convertForm.customer_name = candidate.customer_name
  }
  if (candidate.influence_level) {
    convertForm.contact_influence_level = candidate.influence_level
  }
}

function clearContactSelection() {
  convertForm.contact_id = null
  convertForm.contact_name = props.lead?.contact_name || ''
  convertForm.contact_mobile = props.lead?.contact_mobile || ''
  convertForm.contact_email = props.lead?.contact_email || ''
}

function validateConvertStep(step: number) {
  if (step === 0 && !qualificationReady.value) {
    toast.add({ title: '请先补齐线索资格信息', color: 'error' })
    return false
  }
  if (step === 1 && !convertForm.customer_name.trim()) {
    toast.add({ title: '请选择或输入客户名称', color: 'error' })
    return false
  }
  if (step === 1 && visibleSimilarOpportunityCandidates.value.length && !convertForm.ack_similar_opportunity) {
    toast.add({ title: '请确认仍创建新商机', color: 'warning' })
    return false
  }
  return true
}

function goToConvertStep(targetStep: number) {
  if (targetStep <= convertStep.value) {
    convertStep.value = targetStep
    return
  }
  for (let step = convertStep.value; step < targetStep; step += 1) {
    if (!validateConvertStep(step)) return
  }
  convertStep.value = targetStep
}

function nextConvertStep() {
  goToConvertStep(Math.min(convertStep.value + 1, 2))
}

function previousConvertStep() {
  convertStep.value = Math.max(convertStep.value - 1, 0)
}

async function doConvert() {
  const lead = props.lead
  if (!lead) return
  if (convertLoading.value) return
  if (!validateConvertStep(0)) {
    convertStep.value = 0
    return
  }
  if (!validateConvertStep(1)) {
    convertStep.value = 1
    return
  }
  if (!convertForm.opportunity_name.trim()) {
    toast.add({ title: '请输入商机名称', color: 'error' })
    return
  }
  if (!convertForm.owner_user_id.trim()) {
    toast.add({ title: '请选择商机负责人', color: 'error' })
    return
  }
  if (!convertForm.next_action.trim() || !convertForm.next_action_due_at) {
    toast.add({ title: '请输入下一步动作和截止日期', color: 'error' })
    return
  }
  convertLoading.value = true
  try {
    const response = await $fetch<unknown>(`/api/v1/leads/${lead.id}/convert` as string, {
      method: 'POST',
      headers: {
        'Idempotency-Key': convertIdempotencyKey.value
      },
      body: {
        ...convertForm,
        customer_id: convertForm.customer_id || undefined,
        contact_id: convertForm.contact_id || undefined,
        stage_id: convertForm.stage_id || undefined,
        owner_user_id: convertForm.owner_user_id || undefined,
        expected_sign_date: convertForm.expected_sign_date || convertForm.expected_procurement_date || undefined,
        ack_similar_opportunity: visibleSimilarOpportunityCandidates.value.length ? convertForm.ack_similar_opportunity : undefined,
        idempotency_key: convertIdempotencyKey.value
      }
    })
    const converted = unwrapApiData<LeadConversionResponse>(response) as LeadConversionResponse
    toast.add({ title: '转化成功', color: 'success' })
    modalOpen.value = false
    emit('converted', converted)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '转化失败'), color: 'error' })
  } finally {
    convertLoading.value = false
  }
}

function getErrorMessage(err: unknown, fallback: string) {
  const error = err as { data?: { statusMessage?: string, message?: string }, message?: string }
  return error?.data?.statusMessage || error?.data?.message || error?.message || fallback
}

function formatMoney(val: number | null | undefined) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 }).format(val)
}
</script>

<template>
  <UModal v-model:open="modalOpen" :ui="{ content: 'sm:max-w-3xl' }">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">转化为客户 + 商机</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="modalOpen = false"
            />
          </div>
        </template>

        <div class="space-y-4">
          <div class="grid grid-cols-3 gap-2">
            <UButton
              v-for="step in convertSteps"
              :key="step.value"
              :label="step.label"
              :variant="convertStep === step.value ? 'solid' : 'soft'"
              :color="convertStep === step.value ? 'primary' : 'neutral'"
              size="sm"
              block
              @click="goToConvertStep(step.value)"
            />
          </div>

          <div v-if="convertStep === 0" class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div
                v-for="item in qualificationChecks"
                :key="item.label"
                class="flex items-center gap-2 rounded-md border border-default px-3 py-2 text-sm"
              >
                <UIcon
                  :name="item.ok ? 'i-lucide-check-circle' : 'i-lucide-alert-circle'"
                  :class="item.ok ? 'text-success' : 'text-error'"
                />
                <span>{{ item.label }}</span>
              </div>
            </div>
            <UFormField label="需求摘要" required>
              <UTextarea
                v-model="convertForm.need_summary"
                :rows="3"
                placeholder="描述客户问题、真实需求或项目机会信号"
                class="w-full"
              />
            </UFormField>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UFormField label="项目类型">
                <USelect
                  v-model="convertForm.project_type"
                  :items="projectTypeOptions"
                  placeholder="选择项目类型"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="预算状态">
                <USelect
                  v-model="convertForm.budget_status"
                  :items="budgetStatusOptions"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UFormField label="采购方式">
                <USelect
                  v-model="convertForm.procurement_mode"
                  :items="procurementModeOptions"
                  placeholder="选择采购方式"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="预计采购时间">
                <UInput
                  v-model="convertForm.expected_procurement_date"
                  type="date"
                  class="w-full"
                />
              </UFormField>
            </div>
            <UFormField label="来源证据">
              <UInput
                v-model="convertForm.source_evidence_url"
                placeholder="招标公告、立项信息、官网线索等链接"
                class="w-full"
              />
            </UFormField>
            <UFormField label="负责人" required>
              <UserPicker v-model="convertForm.owner_user_id" />
            </UFormField>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UFormField label="下一步动作" required>
                <UInput
                  v-model="convertForm.next_action"
                  placeholder="如：约客户方案沟通"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="截止日期" required>
                <UInput
                  v-model="convertForm.next_action_due_at"
                  type="date"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div v-if="lead" class="space-y-3 text-sm">
              <div class="flex">
                <span class="text-muted w-24 shrink-0">组织名称</span>
                <span>{{ lead.org_name || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">原需求摘要</span>
                <span>{{ lead.need_summary || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">联系人</span>
                <span>{{ lead.contact_name || lead.contact_mobile || lead.contact_email || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">证据链接</span>
                <span class="truncate">{{ lead.source_evidence_url || '-' }}</span>
              </div>
            </div>
          </div>

          <div v-else-if="convertStep === 1" class="space-y-4">
            <div v-if="candidateLoading" class="space-y-2">
              <USkeleton class="h-10 w-full" />
              <USkeleton class="h-10 w-full" />
            </div>
            <template v-else>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <UFormField label="客户名称" required>
                  <UInput v-model="convertForm.customer_name" class="w-full" />
                </UFormField>
                <UFormField label="统一社会信用代码">
                  <UInput v-model="convertForm.unified_social_credit_code" class="w-full" />
                </UFormField>
                <UFormField label="组织域名">
                  <UInput v-model="convertForm.organization_domain" placeholder="example.com" class="w-full" />
                </UFormField>
              </div>
              <div class="flex justify-end">
                <UButton
                  type="button"
                  size="xs"
                  variant="soft"
                  icon="i-lucide-refresh-cw"
                  :loading="candidateLoading"
                  @click="refreshConversionCandidates"
                >
                  重新匹配
                </UButton>
              </div>

              <UFormField label="客户匹配" required>
                <div class="space-y-2">
                  <button
                    type="button"
                    class="w-full rounded-md border px-3 py-2 text-left text-sm transition-colors"
                    :class="convertForm.customer_id === null ? 'border-primary bg-primary/5' : 'border-default hover:border-primary'"
                    @click="clearCustomerSelection"
                  >
                    <div class="font-medium">
                      新建客户：{{ convertForm.customer_name }}
                    </div>
                  </button>
                  <button
                    v-for="candidate in customerCandidates"
                    :key="candidate.id"
                    type="button"
                    class="w-full rounded-md border px-3 py-2 text-left text-sm transition-colors"
                    :class="convertForm.customer_id === Number(candidate.id) ? 'border-primary bg-primary/5' : 'border-default hover:border-primary'"
                    @click="selectCustomer(candidate)"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-medium">{{ candidate.name }}</span>
                      <UBadge
                        v-if="convertForm.customer_id === Number(candidate.id)"
                        size="xs"
                        color="primary"
                        variant="subtle"
                      >
                        已选择
                      </UBadge>
                    </div>
                    <div class="mt-1 flex items-center gap-3 text-xs text-muted">
                      <span class="font-mono">{{ candidate.code || '-' }}</span>
                      <UserName :uid="candidate.owner_user_id" />
                    </div>
                  </button>
                </div>
              </UFormField>

              <UFormField label="联系人匹配">
                <div class="space-y-2">
                  <button
                    type="button"
                    class="w-full rounded-md border px-3 py-2 text-left text-sm transition-colors"
                    :class="convertForm.contact_id === null ? 'border-primary bg-primary/5' : 'border-default hover:border-primary'"
                    @click="clearContactSelection"
                  >
                    <div class="font-medium">
                      {{ convertForm.contact_name ? `新建联系人：${convertForm.contact_name}` : '不创建联系人' }}
                    </div>
                  </button>
                  <button
                    v-for="candidate in visibleContactCandidates"
                    :key="candidate.id"
                    type="button"
                    class="w-full rounded-md border px-3 py-2 text-left text-sm transition-colors"
                    :class="convertForm.contact_id === Number(candidate.id) ? 'border-primary bg-primary/5' : 'border-default hover:border-primary'"
                    @click="selectContact(candidate)"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <span class="font-medium">{{ candidate.name }}</span>
                      <UBadge
                        v-if="convertForm.contact_id === Number(candidate.id)"
                        size="xs"
                        color="primary"
                        variant="subtle"
                      >
                        已选择
                      </UBadge>
                    </div>
                    <div class="mt-1 text-xs text-muted">
                      {{ candidate.mobile || candidate.email || '-' }} · {{ candidate.customer_name || '-' }}
                    </div>
                  </button>
                </div>
              </UFormField>

              <div v-if="visibleSimilarOpportunityCandidates.length" class="rounded-md border border-warning/40 bg-warning/5 p-3">
                <div class="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
                  <UIcon name="i-lucide-alert-triangle" />
                  <span>相似开放商机</span>
                </div>
                <div class="space-y-2">
                  <div
                    v-for="candidate in visibleSimilarOpportunityCandidates"
                    :key="candidate.id"
                    class="rounded-md border border-default bg-default px-3 py-2 text-sm"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <NuxtLink
                        :to="`/opportunities/${candidate.id}`"
                        class="font-medium text-primary hover:underline"
                        target="_blank"
                      >
                        {{ candidate.name }}
                      </NuxtLink>
                      <span class="font-mono text-xs text-muted">{{ formatMoney(candidate.amount_tax_inclusive) }}</span>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
                      <span class="font-mono">{{ candidate.code || '-' }}</span>
                      <span>{{ candidate.customer_name || '-' }}</span>
                      <span>{{ candidate.stage_name || '-' }}</span>
                      <UserName :uid="candidate.owner_user_id" />
                    </div>
                  </div>
                </div>
                <UCheckbox
                  v-model="convertForm.ack_similar_opportunity"
                  class="mt-3"
                  label="已核对相似商机，仍创建新的商机"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <UFormField label="角色">
                  <USelect v-model="convertForm.contact_role" :items="contactRoleOptions" class="w-full" />
                </UFormField>
                <UFormField label="影响力">
                  <USelect v-model="convertForm.contact_influence_level" :items="contactInfluenceOptions" class="w-full" />
                </UFormField>
                <UFormField label="态度">
                  <USelect v-model="convertForm.contact_attitude" :items="contactAttitudeOptions" class="w-full" />
                </UFormField>
              </div>
            </template>
          </div>

          <div v-else class="space-y-4">
            <UFormField label="商机名称" required>
              <UInput v-model="convertForm.opportunity_name" class="w-full" />
            </UFormField>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <UFormField label="销售管线">
                <USelect
                  v-model="convertForm.pipeline_code"
                  :items="pipelineOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="初始阶段">
                <USelect
                  v-model="convertForm.stage_id"
                  :items="stageOptions"
                  placeholder="默认首个开放阶段"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="商机负责人" required>
                <UserPicker v-model="convertForm.owner_user_id" />
              </UFormField>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <UFormField label="预测分类">
                <USelect
                  v-model="convertForm.forecast_category"
                  :items="forecastOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="预计签约日期">
                <UInput v-model="convertForm.expected_sign_date" type="date" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="预计金额(元)">
              <UInput
                v-model.number="convertForm.amount"
                type="number"
                placeholder="选填"
                class="w-full"
              />
            </UFormField>
            <UFormField label="下一步动作" required>
              <UInput
                v-model="convertForm.next_action"
                placeholder="如：约客户方案沟通"
                class="w-full"
              />
            </UFormField>
            <UFormField label="截止日期" required>
              <UInput
                v-model="convertForm.next_action_due_at"
                type="date"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>

        <template #footer>
          <div class="flex w-full justify-between gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="modalOpen = false"
            />
            <div class="flex gap-2">
              <UButton
                v-if="convertStep > 0"
                label="上一步"
                variant="soft"
                color="neutral"
                @click="previousConvertStep"
              />
              <UButton
                v-if="convertStep < 2"
                label="下一步"
                color="primary"
                @click="nextConvertStep"
              />
              <UButton
                v-else
                label="确认转化"
                color="primary"
                :loading="convertLoading"
                @click="doConvert"
              />
            </div>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
