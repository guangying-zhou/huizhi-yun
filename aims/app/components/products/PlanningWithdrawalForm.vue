<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'
import type { ProductPlanningDetail } from '~/types/productPlanning'
import type { ProductConsumptionConfirmation, ProductConsumptionView } from '~/types/productConsumption'
import { withdrawalConsumption } from '~/utils/productWithdrawalConsumption'

interface Issue { code: string, item_id?: string, predecessor_id?: string, category?: string }
interface IssueRow { issue: Issue, accepted: boolean, reason: string, impact: string, uids: string[] }
interface Report { retained_person_days: string, occupied_person_days: string, selected_person_days: string, remaining_person_days: string, unknown_estimates: number, issues: Issue[] }
interface Preview { cycle_biz_id: string, item_biz_id: string, workspace_revision: number, cycle_revision: number, queue_revision: number, before: { confirmed: Report, latest: Report }, after: { confirmed: Report, latest: Report }, can_confirm: boolean, blocker: { code: string, message: string } | null }
const props = defineProps<{ productCode: string, cycle: ProductPlanningCycle, item: ProductPlanningDetail, workspaceRevision: number, confirmation?: ProductConsumptionConfirmation | null }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const impactNote = ref('')
const currentConfirmation = ref(props.confirmation || null)
const blocked = ref(false), refreshed = ref(false)
const currentItem = ref(props.item), currentCycle = ref(props.cycle)
const reason = ref(''), busy = ref(false), error = ref<Error | null>(null), issueRows = ref<IssueRow[]>([]), issuePage = ref(1)
const preview = ref<{ payload: string, value: Preview } | null>(null)
const issues: Record<string, string> = { assessment_required: '需要重新评估', effort_required: '投入尚未确认', dependency_unresolved: '前置依赖未解除', cross_dependency_unresolved: '跨产品依赖需协调', capacity_exceeded: '超过周期容量', category_capacity_exceeded: '超过类别预算' }
const categories: Record<string, string> = { reliability: '可靠性与治理', usability: '体验优化', growth: '新功能与增长' }
const versions = reactive({ expectedRevision: props.workspaceRevision, expectedCycleRevision: props.cycle.revision, expectedItemRevision: props.item.revision, expectedQueueRevision: props.cycle.queue_revision })
const body = computed(() => ({ ...versions, ...(currentConfirmation.value ? { consumptionConfirmationId: currentConfirmation.value.confirmation_id } : {}), impactNote: impactNote.value, reason: reason.value, exceptions: issueRows.value.filter(row => row.accepted).map(row => ({ code: row.issue.code, ...(row.issue.item_id ? { itemId: row.issue.item_id } : {}), ...(row.issue.predecessor_id ? { predecessorId: row.issue.predecessor_id } : {}), ...(row.issue.category ? { category: row.issue.category } : {}), reason: row.reason, responsibleUid: row.uids[0] || '', impact: row.impact })) }))
const payload = computed(() => JSON.stringify(body.value))
const currentPreview = computed(() => preview.value?.payload === payload.value ? preview.value.value : null)
const alert = useApiErrorAlert(error, { fallbackTitle: '撤回事项失败' })
const { confirm } = useConfirm()
const base = `/api/v1/products/${encodeURIComponent(props.productCode)}/planning-cycles/${props.cycle.biz_id}/items/${props.item.biz_id}`
const validAmount = (value: unknown) => typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value) && Number.isFinite(Number(value))
const issueKey = (issue: Issue) => JSON.stringify([issue.code, issue.item_id || '', issue.predecessor_id || '', issue.category || ''])
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
async function reloadPreservingDraft() {
  if (busy.value) return
  busy.value = true
  blocked.value = true
  refreshed.value = false
  preview.value = null
  error.value = null
  try {
    const productBase = `/api/v1/products/${encodeURIComponent(props.productCode)}`
    const permission = await $fetch<{ code: number, data: { product_code: string, status: string, prioritize: boolean } }>(`${productBase}/planning-cycles/permissions`, { timeout: 15000 })
    if (permission.code !== 0 || permission.data?.product_code !== props.productCode || permission.data.status !== 'active' || !permission.data.prioritize) throw new Error('当前产品不可撤回或决策权限已变化，草稿已保留')
    const cycle = await $fetch<{ code: number, data: ProductPlanningCycle & { workspace_revision: number } }>(`${productBase}/planning-cycles/${props.cycle.biz_id}`, { timeout: 15000 })
    const item = await $fetch<{ code: number, data: ProductPlanningDetail }>(`${productBase}/planning-items/${props.item.biz_id}`, { timeout: 15000 })
    const consumption = await $fetch<{ code: number, data: ProductConsumptionView }>(`${base}/consumption`, { timeout: 15000 })
    if (cycle.code !== 0 || cycle.data?.biz_id !== props.cycle.biz_id || cycle.data.product_code !== props.productCode || cycle.data.status !== 'open') throw new Error('周期已不可调整，草稿已保留')
    if (item.code !== 0 || item.data?.biz_id !== props.item.biz_id || item.data.product_code !== props.productCode || !['proposed', 'in_delivery'].includes(item.data.lifecycle) || !categories[item.data.investment_category]) throw new Error('事项已变化或开始交付，不能直接撤回，草稿已保留')
    if (consumption.code !== 0 || item.data.workspace_revision !== cycle.data.workspace_revision) throw new Error('读取期间产品已变化，请重新读取')
    const confirmation = withdrawalConsumption(consumption.data, { cycleId: props.cycle.biz_id, itemId: props.item.biz_id, workspaceRevision: cycle.data.workspace_revision, cycleRevision: cycle.data.revision, queueRevision: cycle.data.queue_revision, itemRevision: item.data.revision, scopeRevision: item.data.scope_revision, lifecycle: item.data.lifecycle })
    const next = { expectedRevision: cycle.data.workspace_revision, expectedCycleRevision: cycle.data.revision, expectedItemRevision: item.data.revision, expectedQueueRevision: cycle.data.queue_revision }
    if (Object.values(next).some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('最新版本不完整，草稿已保留')
    currentConfirmation.value = confirmation
    currentItem.value = item.data
    currentCycle.value = cycle.data
    Object.assign(versions, next)
    blocked.value = false
    refreshed.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('重新读取失败，草稿已保留')
  } finally { busy.value = false }
}
async function loadPreview() {
  if (busy.value || blocked.value) return
  error.value = null
  if (!reason.value.trim() || !impactNote.value.trim() || issueRows.value.some(row => row.accepted && (!row.reason.trim() || !row.impact.trim() || row.uids.length !== 1))) {
    error.value = new Error('请填写撤回理由和影响说明；每个例外需填写原因、影响并选择一位责任人')
    return
  }
  busy.value = true
  preview.value = null
  const submitted = payload.value
  try {
    const response = await $fetch<{ code: number, data: Preview }>(`${base}/withdrawal-preview`, { method: 'POST', body: JSON.parse(submitted), timeout: 15000 })
    const value = response.data
    if (response.code !== 0 || !value || value.cycle_biz_id !== props.cycle.biz_id || value.item_biz_id !== props.item.biz_id || value.workspace_revision !== versions.expectedRevision || value.cycle_revision !== versions.expectedCycleRevision || value.queue_revision !== versions.expectedQueueRevision || typeof value.can_confirm !== 'boolean' || !Array.isArray(value.after?.latest?.issues)) throw new Error('撤回预览不完整，请重新读取')
    for (const report of [value.before?.confirmed, value.after?.confirmed, value.before?.latest, value.after?.latest]) if (!report || !validAmount(report.retained_person_days) || Number(report.retained_person_days) < 0 || !validAmount(report.occupied_person_days) || Number(report.occupied_person_days) < 0 || !validAmount(report.selected_person_days) || Number(report.selected_person_days) < 0 || !validAmount(report.remaining_person_days) || !Number.isSafeInteger(report.unknown_estimates) || report.unknown_estimates < 0) throw new Error('容量预览无效')
    const previous = new Map(issueRows.value.map(row => [issueKey(row.issue), row]))
    issueRows.value = value.after.latest.issues.map(issue => previous.get(issueKey(issue)) || { issue, accepted: false, reason: '', impact: '', uids: [] })
    issuePage.value = 1
    preview.value = { payload: submitted, value }
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('撤回预览失败')
  } finally { busy.value = false }
}
async function save() {
  if (busy.value || blocked.value || !currentPreview.value?.can_confirm) return
  error.value = null
  const submitted = payload.value, value = currentPreview.value
  if (retry?.payload !== submitted) retry = { payload: submitted, key: crypto.randomUUID() }
  busy.value = true
  try {
    if (!(await confirm({ title: '确认撤回事项', message: `从“${currentCycle.value.title}”撤回“${currentItem.value.title}”。\n周期总占用从 ${value.before.confirmed.occupied_person_days} 变为 ${value.after.confirmed.occupied_person_days} 人日，其中保留已发生投入 ${value.after.confirmed.retained_person_days} 人日，确认预算差额 ${value.after.confirmed.remaining_person_days} 人日。\n最新测算总占用 ${value.after.latest.occupied_person_days} 人日，估算差额 ${value.after.latest.remaining_person_days} 人日。\n记录 ${body.value.exceptions.length} 项例外。\n理由：${reason.value}\n事项转为暂缓、路线图分组转为以后，原决定保留。影响说明：${impactNote.value}`, tone: 'warning', confirmLabel: '确认撤回' }))) return
    const response = await $fetch<{ code: number }>(`${base}/withdraw`, { method: 'POST', body: JSON.parse(submitted), headers: { 'Idempotency-Key': retry.key }, timeout: 15000 })
    if (response.code !== 0) throw new Error('撤回结果不完整，请重试')
    busy.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('撤回失败，输入已保留')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="min-w-0 space-y-4">
    <h1 class="break-words text-xl font-semibold">
      撤回事项：{{ currentItem.title }}
    </h1>
    <p class="whitespace-pre-wrap break-words text-sm">
      {{ currentItem.scope_summary }}
    </p>
    <p class="text-sm text-muted">
      未开工事项可直接撤回；已开工事项保留核验后的已发生投入。提交后转为暂缓，原决定与前置关系保留。
    </p>
    <div v-if="currentConfirmation" class="space-y-1 rounded-lg border border-default p-4 text-sm">
      <h2 class="font-semibold">
        本次使用的投入确认
      </h2>
      <p>已发生 {{ currentConfirmation.spent_person_days }} 人日，撤回后继续占用预算。</p>
      <p class="break-words">
        {{ currentConfirmation.reason }}
      </p>
      <p class="break-all text-muted">
        {{ currentConfirmation.confirmed_by }} · {{ currentConfirmation.confirmed_at }}
      </p>
    </div>
    <UButton
      color="neutral"
      variant="outline"
      :disabled="busy"
      @click="reloadPreservingDraft"
    >
      重新读取并保留草稿
    </UButton>
    <UAlert
      v-if="refreshed"
      color="info"
      title="已读取最新事项范围和周期版本"
      description="理由、影响和例外填写已保留。请核对最新范围，重新预览后确认撤回。"
    />
    <UFormField label="影响说明" required>
      <UTextarea
        v-model="impactNote"
        class="w-full"
        :disabled="busy"
        :maxlength="2000"
      />
    </UFormField>
    <UFormField label="撤回理由" required>
      <UTextarea
        v-model="reason"
        class="w-full"
        :disabled="busy"
        :maxlength="2000"
        placeholder="为什么从本周期撤回，以及涉及的取舍"
      />
    </UFormField>
    <UAlert v-if="alert" v-bind="alert" />
    <div v-if="currentPreview" class="space-y-2 rounded-lg border border-default p-4">
      <h2 class="font-semibold">
        容量影响预览
      </h2>
      <p>周期总占用：{{ currentPreview.before.confirmed.occupied_person_days }} → {{ currentPreview.after.confirmed.occupied_person_days }} 人日</p>
      <p :class="Number(currentPreview.after.confirmed.remaining_person_days) < 0 ? 'text-error' : ''">
        撤回后确认差额：{{ currentPreview.after.confirmed.remaining_person_days }} 人日
      </p>
      <p>撤回后保留已发生投入：{{ currentPreview.after.confirmed.retained_person_days }} 人日</p>
      <p>最新测算总占用：{{ currentPreview.before.latest.occupied_person_days }} → {{ currentPreview.after.latest.occupied_person_days }} 人日</p>
      <p :class="Number(currentPreview.after.latest.remaining_person_days) < 0 ? 'text-error' : ''">
        撤回后估算差额：{{ currentPreview.after.latest.remaining_person_days }} 人日
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
        :disabled="blocked"
        @click="loadPreview"
      >
        预览撤回影响
      </UButton>
      <UButton :disabled="busy || blocked || !currentPreview?.can_confirm" @click="save">
        确认撤回事项
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
