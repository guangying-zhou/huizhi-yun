<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'
import type { ProductPlanningDetail } from '~/types/productPlanning'
import type { ProductAssessment } from '~/types/productAssessment'

interface Issue { code: string, item_id?: string, predecessor_id?: string, category?: string }
interface IssueRow { issue: Issue, accepted: boolean, reason: string, impact: string, uids: string[] }
interface Report { retained_person_days: string, occupied_person_days: string, selected_person_days: string, remaining_person_days: string, unknown_estimates: number, issues: Issue[] }
interface Preview { cycle_biz_id: string, item_biz_id: string, workspace_revision: number, cycle_revision: number, queue_revision: number, before: { latest: Report }, after: { latest: Report }, can_confirm: boolean, blocker: { code: string, message: string } | null }
const props = defineProps<{ productCode: string, cycle: ProductPlanningCycle, item: ProductPlanningDetail, assessment: ProductAssessment, workspaceRevision: number }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const reason = ref(''), busy = ref(false), error = ref<Error | null>(null), issueRows = ref<IssueRow[]>([]), issuePage = ref(1)
const preview = ref<{ payload: string, value: Preview } | null>(null)
const issues: Record<string, string> = { assessment_required: '需要重新评估', effort_required: '投入尚未确认', dependency_unresolved: '前置依赖未解除', cross_dependency_unresolved: '跨产品依赖需协调', capacity_exceeded: '超过周期容量', category_capacity_exceeded: '超过类别预算' }
const categories: Record<string, string> = { reliability: '可靠性与治理', usability: '体验优化', growth: '新功能与增长' }
const versions = { expectedRevision: props.workspaceRevision, expectedCycleRevision: props.cycle.revision, expectedItemRevision: props.item.revision, expectedQueueRevision: props.cycle.queue_revision, expectedAssessmentId: props.assessment.id }
const body = computed(() => ({ ...versions, reason: reason.value, exceptions: issueRows.value.filter(row => row.accepted).map(row => ({ code: row.issue.code, ...(row.issue.item_id ? { itemId: row.issue.item_id } : {}), ...(row.issue.predecessor_id ? { predecessorId: row.issue.predecessor_id } : {}), ...(row.issue.category ? { category: row.issue.category } : {}), reason: row.reason, responsibleUid: row.uids[0] || '', impact: row.impact })) }))
const payload = computed(() => JSON.stringify(body.value))
const currentPreview = computed(() => preview.value?.payload === payload.value ? preview.value.value : null)
const alert = useApiErrorAlert(error, { fallbackTitle: '选入周期失败' })
const { confirm } = useConfirm()
const base = `/api/v1/products/${encodeURIComponent(props.productCode)}/planning-cycles/${props.cycle.biz_id}/items/${props.item.biz_id}`
const validAmount = (value: unknown) => typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value) && Number.isFinite(Number(value))
const issueKey = (issue: Issue) => JSON.stringify([issue.code, issue.item_id || '', issue.predecessor_id || '', issue.category || ''])
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
async function loadPreview() {
  if (busy.value) return
  error.value = null
  if (!reason.value.trim() || issueRows.value.some(row => row.accepted && (!row.reason.trim() || !row.impact.trim() || row.uids.length !== 1))) {
    error.value = new Error('请填写选入理由；每个例外需填写原因、影响并选择一位责任人')
    return
  }
  busy.value = true
  preview.value = null
  const submitted = payload.value
  try {
    const response = await $fetch<{ code: number, data: Preview }>(`${base}/selection-preview`, { method: 'POST', body: JSON.parse(submitted), timeout: 15000 })
    const value = response.data
    if (response.code !== 0 || !value || value.cycle_biz_id !== props.cycle.biz_id || value.item_biz_id !== props.item.biz_id || value.workspace_revision !== versions.expectedRevision || value.cycle_revision !== versions.expectedCycleRevision || value.queue_revision !== versions.expectedQueueRevision || typeof value.can_confirm !== 'boolean' || !Array.isArray(value.after?.latest?.issues)) throw new Error('选入预览不完整，请重新读取')
    for (const report of [value.before?.latest, value.after?.latest]) if (!report || !validAmount(report.retained_person_days) || Number(report.retained_person_days) < 0 || !validAmount(report.occupied_person_days) || Number(report.occupied_person_days) < 0 || !validAmount(report.selected_person_days) || Number(report.selected_person_days) < 0 || !validAmount(report.remaining_person_days) || !Number.isSafeInteger(report.unknown_estimates) || report.unknown_estimates < 0) throw new Error('容量预览无效')
    const previous = new Map(issueRows.value.map(row => [issueKey(row.issue), row]))
    issueRows.value = value.after.latest.issues.map(issue => previous.get(issueKey(issue)) || { issue, accepted: false, reason: '', impact: '', uids: [] })
    issuePage.value = 1
    preview.value = { payload: submitted, value }
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('选入预览失败')
  } finally { busy.value = false }
}
async function save() {
  if (busy.value || !currentPreview.value?.can_confirm) return
  error.value = null
  const submitted = payload.value, value = currentPreview.value
  if (retry?.payload !== submitted) retry = { payload: submitted, key: crypto.randomUUID() }
  busy.value = true
  try {
    if (!(await confirm({ title: '确认选入周期', message: `将“${props.item.title}”选入“${props.cycle.title}”。\n周期总占用（含撤回后保留投入）从 ${value.before.latest.occupied_person_days} 变为 ${value.after.latest.occupied_person_days} 人日，预算差额 ${value.after.latest.remaining_person_days} 人日。\n记录 ${body.value.exceptions.length} 项例外。\n理由：${reason.value}\n系统将冻结本次评估与投入，标记路线为当前；版本安排仍须另行确认。`, tone: 'warning', confirmLabel: '确认选入' }))) return
    const response = await $fetch<{ code: number }>(`${base}/select`, { method: 'POST', body: JSON.parse(submitted), headers: { 'Idempotency-Key': retry.key }, timeout: 15000 })
    if (response.code !== 0) throw new Error('选入结果不完整，请重试')
    busy.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('选入失败，输入已保留')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="min-w-0 space-y-4">
    <h1 class="break-words text-xl font-semibold">
      选入周期：{{ item.title }}
    </h1>
    <p class="whitespace-pre-wrap break-words text-sm">
      {{ item.scope_summary }}
    </p>
    <p class="text-sm text-muted">
      {{ cycle.title }} · {{ categories[item.investment_category] }} · 评估投入 {{ assessment.effort_person_days }} 人日 · 推荐分 {{ Number(assessment.priority_score).toFixed(2) }}
    </p>
    <UButton
      :to="`/products/${encodeURIComponent(productCode)}/cycles/${cycle.biz_id}/items/${item.biz_id}/assessments`"
      color="neutral"
      variant="link"
      :disabled="busy"
    >
      查看评估依据与历史
    </UButton>
    <UFormField label="选入理由" required>
      <UTextarea
        v-model="reason"
        class="w-full"
        :disabled="busy"
        :maxlength="2000"
        placeholder="为什么本周期做，以及涉及的取舍"
      />
    </UFormField>
    <UAlert v-if="alert" v-bind="alert" />
    <div v-if="currentPreview" class="space-y-2 rounded-lg border border-default p-4">
      <h2 class="font-semibold">
        容量影响预览
      </h2>
      <p>撤回后保留投入：{{ currentPreview.after.latest.retained_person_days }} 人日</p>
      <p>周期总占用（含撤回后保留投入）：{{ currentPreview.before.latest.occupied_person_days }} → {{ currentPreview.after.latest.occupied_person_days }} 人日</p>
      <p :class="Number(currentPreview.after.latest.remaining_person_days) < 0 ? 'text-error' : ''">
        选择后差额：{{ currentPreview.after.latest.remaining_person_days }} 人日
      </p>
      <p class="text-sm">
        未知估算 {{ currentPreview.after.latest.unknown_estimates }} 项。未知投入未扣除，不能据此宣称可交付。
      </p>
      <UAlert v-if="currentPreview.blocker" color="warning" :title="currentPreview.blocker.message" />
    </div>
    <p v-else-if="preview" class="text-sm text-warning">
      输入已变化，请重新预览后确认。
    </p>
    <section v-if="issueRows.length" class="space-y-3">
      <h2 class="font-semibold">
        需要处理的问题 · 共 {{ issueRows.length }} 项
      </h2>
      <p class="text-sm text-muted">
        优先处理范围、预算和前置关系。确需例外时逐项说明；例外不表示依赖已解除。
      </p>
      <div v-for="row in issueRows.slice((issuePage - 1) * 10, issuePage * 10)" :key="issueKey(row.issue)" class="space-y-3 rounded-lg border border-default p-3">
        <p class="font-medium">
          {{ issues[row.issue.code] || '需要复核' }}{{ row.issue.category ? ` · ${categories[row.issue.category]}` : '' }}
        </p>
        <p v-if="row.issue.item_id" class="break-all text-xs text-muted">
          事项 {{ row.issue.item_id }}{{ row.issue.predecessor_id ? `；前置 ${row.issue.predecessor_id}` : '' }}
        </p>
        <p v-if="row.issue.code === 'assessment_required'" class="text-sm text-warning">
          请补充或重新确认评估，此问题不能通过容量例外豁免。
        </p>
        <template v-else>
          <UCheckbox v-model="row.accepted" :disabled="busy" label="为此问题记录明确例外" />
          <template v-if="row.accepted">
            <UFormField label="例外原因" required>
              <UTextarea
                v-model="row.reason"
                class="w-full"
                :disabled="busy"
                :maxlength="2000"
              />
            </UFormField>
            <UFormField label="责任人" required>
              <UserTreeSelector
                v-model="row.uids"
                selection-mode="single"
                :hide-committees="true"
                :disabled="busy"
              />
            </UFormField>
            <UFormField label="影响与后续处理" required>
              <UTextarea
                v-model="row.impact"
                class="w-full"
                :disabled="busy"
                :maxlength="2000"
              />
            </UFormField>
          </template>
        </template>
      </div>
      <UPagination
        v-if="issueRows.length > 10"
        v-model:page="issuePage"
        :total="issueRows.length"
        :items-per-page="10"
        :sibling-count="0"
        :disabled="busy"
      />
    </section>
    <div class="flex flex-wrap gap-2">
      <UButton
        color="neutral"
        variant="outline"
        :loading="busy"
        @click="loadPreview"
      >
        预览选入影响
      </UButton>
      <UButton :disabled="busy || !currentPreview?.can_confirm" @click="save">
        确认选入周期
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="emit('cancel')"
      >
        取消
      </UButton>
    </div>
  </div>
</template>
