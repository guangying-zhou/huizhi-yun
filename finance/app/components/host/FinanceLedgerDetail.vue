<script setup lang="ts">
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { ledgerResource, ledgerPath, ledgerApi, isSpend, ledgerTitles, ledgerStatusLabel, ledgerAmount, ledgerWriteMessage, type FinanceLedgerKind, type FinanceLedgerRow } from '../../utils/hostFinanceLedger'
import { createFinanceIntent } from '../../utils/hostFinanceForms'

const props = defineProps<{ kind: FinanceLedgerKind, objectCode?: string, embedded?: boolean }>()
const emit = defineEmits<{ context: [row: FinanceLedgerRow], changed: [] }>()
const route = useRoute()
const { hosted, moduleUrl, apiUrl, sessionScope } = useFinanceModule()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
onMounted(() => {
  void loadPermissions()
})
const code = computed(() => String(props.objectCode ?? route.params.code ?? ''))
const allowed = computed(() => loaded.value && !permissionError.value && hasPermission(ledgerResource[props.kind], 'view'))
const row = ref<FinanceLedgerRow | null>(null)
const pending = ref(false)
const saving = ref(false)
const error = ref('')
const toast = useToast()
const { user: currentUser } = useAuth()
const { confirm } = useConfirm()
const intent = createFinanceIntent()
let generation = 0
const submitPayload = ref<{ expectedVersion: number } | null>(null)
watch(() => [code.value, sessionScope?.value], () => {
  submitPayload.value = null
  intent.reset()
  action.value = null
})
async function load() {
  const epoch = ++generation
  row.value = null
  if (!allowed.value) return
  pending.value = true
  error.value = ''
  try {
    const response = await $fetch<{ data: FinanceLedgerRow }>(apiUrl(`/${ledgerApi(props.kind)}/${encodeURIComponent(code.value)}`), { retry: 0 })
    if (epoch === generation) {
      row.value = response.data
      emit('context', response.data)
    }
  } catch (failure) {
    const statusCode = (failure as { statusCode?: number, status?: number }).statusCode || (failure as { status?: number }).status
    if (epoch === generation) error.value = statusCode === 403 ? '您没有查看此单据的权限' : '单据暂不可用，请重试'
  } finally {
    if (epoch === generation) pending.value = false
  }
}
watch(() => [allowed.value, code.value, sessionScope?.value], () => {
  void load()
}, { immediate: true })
onScopeDispose(() => {
  generation++
})
const action = ref<'resume' | 'submit' | 'confirm' | 'delete' | 'cancel' | 'void' | 'red-reverse' | null>(null)
const reason = ref('')
const invoiceNo = ref('')
const confirming = ref(false)
const needsForm = computed(() => ['void', 'red-reverse'].includes(action.value || ''))
async function chooseAction(next: NonNullable<typeof action.value>) {
  if (saving.value || confirming.value) return
  action.value = next
  if (!needsForm.value) await execute()
}
const dialog = computed({ get: () => action.value !== null && needsForm.value && !confirming.value, set: (value) => {
  if (!value) action.value = null
} })
const actionLabel = computed(() => ({ 'resume': '恢复提交', 'submit': '提交审批', 'confirm': isSpend(props.kind) ? '确认实际付款' : '确认到账', 'delete': isSpend(props.kind) ? '删除支出草稿' : '删除到账草稿', 'cancel': '取消申请', 'void': '作废发票', 'red-reverse': '红冲发票' })[action.value || 'confirm'])
async function execute() {
  if (!row.value || !action.value || saving.value || confirming.value) return
  const currentAction = action.value
  const consequence = currentAction === 'resume' ? '沿用原冻结申请和原请求键恢复审批，不会创建重复实例。' : isSpend(props.kind) ? currentAction === 'submit' ? '冻结当前申请并创建人工审批，审批通过后仍须由与制单人和经办人不同的获权人员确认付款。' : currentAction === 'confirm' ? '确认实际付款；申请将生成唯一支出台账，审批通过本身不代表付款。' : '取消或删除未提交草稿，历史审计保留。' : currentAction === 'submit' ? '冻结当前申请并创建审批，审批通过后仍须由另一位获权人员正式开票。' : currentAction === 'confirm' ? '确认后允许另一位获权人员核销。' : currentAction === 'red-reverse' ? '将生成红字发票并回写合同结算计划，已有核销时须先按规则撤销。' : '会改变此单据的可办理状态并回写相关摘要，历史审计保留。'
  confirming.value = true
  await nextTick()
  let accepted = false
  try {
    accepted = await confirm({ tone: ['submit', 'resume', 'confirm'].includes(currentAction) ? 'warning' : 'danger', title: actionLabel.value, message: `${actionLabel.value}「${row.value.code}」：${consequence}` })
  } finally {
    confirming.value = false
  }
  if (!accepted) {
    if (!needsForm.value) action.value = null
    return
  }
  saving.value = true
  const payload = currentAction === 'resume' ? { expectedVersion: row.value.row_version, recover: true } : currentAction === 'submit' ? (submitPayload.value ||= { expectedVersion: row.value.row_version }) : { expectedVersion: row.value.row_version, ...(currentAction === 'cancel' && !isSpend(props.kind) ? { canceled: true } : {}), ...(['void', 'red-reverse'].includes(currentAction) ? { reason: reason.value, ...(currentAction === 'red-reverse' ? { invoiceNo: invoiceNo.value } : {}) } : {}) }
  const suffix = currentAction === 'resume' ? '/submit' : ['submit', 'confirm', 'red-reverse'].includes(currentAction) || (currentAction === 'cancel' && isSpend(props.kind)) ? `/${currentAction}` : ''
  const method = ['void', 'delete'].includes(currentAction) ? 'DELETE' : currentAction === 'cancel' && !isSpend(props.kind) ? 'PATCH' : 'POST'
  try {
    await $fetch(apiUrl(`/${ledgerApi(props.kind)}/${encodeURIComponent(row.value.code)}${suffix}`), { method, body: payload, headers: { 'Idempotency-Key': intent.key({ code: row.value.code, action: currentAction, payload }) }, retry: 0 })
    intent.reset()
    submitPayload.value = null
    toast.add({ title: `${actionLabel.value}成功`, color: 'success' })
    action.value = null
    await load()
    emit('changed')
  } catch (failure) {
    const cause = failure as { statusCode?: number, status?: number, data?: { requestFrozen?: boolean, data?: { requestFrozen?: boolean } } }
    if (currentAction === 'submit' && [400, 403, 409].includes(cause.statusCode || cause.status || 0) && !cause.data?.requestFrozen && !cause.data?.data?.requestFrozen) submitPayload.value = null
    toast.add({ title: ledgerWriteMessage(failure), color: 'error' })
  } finally {
    saving.value = false
    if (!needsForm.value) action.value = null
  }
}
async function preview(fileCode: string) {
  try {
    const response = await $fetch<{ data: { url: string } }>(apiUrl('/invoices/files/view'), { query: { code: fileCode }, retry: 0 })
    window.open(response.data.url, '_blank', 'noopener,noreferrer')
  } catch (failure) {
    toast.add({ title: ledgerWriteMessage(failure), color: 'error' })
  }
}
const fields: Record<string, string> = { title: '申请标题', project_code: '项目', applicant_uid: '申请人', handler_uid: '经办人', expense_date: '支出日期', description: '事由', generated_expense_id: '实际支出台账 ID', customer_name: '客户', contract_code: '合同', billing_schedule_code: '结算计划', invoice_no: '发票号码', invoice_date: '开票日期', received_at: '到账日期', payer_name: '付款方', requested_by: '申请人', issuance_responsible_uid: '开票责任人', issuance_due_at: '开票截止时间', reconciliation_responsible_uid: '核销责任人', reconciliation_due_at: '核销截止时间', confirmed_by: '到账确认人', issued_by: '开票人', unreconciled_amount: '未核销金额', remark: '备注', note: '说明' }
</script>

<template>
  <UDashboardPanel id="finance-ledger-detail">
    <template #body>
      <div class="p-4 sm:p-6">
        <ContentPageHeader
          v-if="hosted && !embedded"
          :hosted="hosted"
          :title="`${ledgerTitles[kind]}详情`"
          :description="code"
        >
          <template #actions>
            <UButton
              :to="moduleUrl(ledgerPath(kind))"
              color="neutral"
              variant="outline"
            >
              返回列表
            </UButton><UButton
              color="neutral"
              variant="outline"
              :loading="pending"
              @click="load"
            >
              刷新
            </UButton>
          </template>
        </ContentPageHeader>
        <UProgress
          v-if="!loaded || pending"
          aria-label="加载单据"
        />
        <CommonEmptyState
          v-else-if="permissionError"
          title="权限加载失败"
        />
        <CommonEmptyState
          v-else-if="!allowed"
          title="无权限"
        />
        <CommonEmptyState
          v-else-if="error"
          title="加载失败"
          :description="error"
        >
          <template #actions>
            <UButton @click="load">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <template v-else-if="row">
          <div class="mb-4 flex flex-wrap items-center gap-3">
            <UBadge
              color="info"
              variant="subtle"
            >
              {{ ledgerStatusLabel(row.status, kind) }}
            </UBadge><span class="text-xl font-semibold tabular-nums">{{ ledgerAmount(row) }} {{ row.currency_code }}</span><span class="text-muted">版本 {{ row.row_version }}</span>
          </div>
          <UAlert
            v-if="kind === 'invoice-requests'"
            color="info"
            class="mb-4"
            title="审批通过不等于正式开票；已批申请须由与申请人不同的获权人员办理开票。"
          />
          <UAlert
            v-if="kind === 'receipts'"
            color="info"
            class="mb-4"
            title="到账确认与核销分开办理，确认人不能是核销人。"
          />
          <UAlert
            v-if="isSpend(kind)"
            color="info"
            class="mb-4"
            title="审批只改变申请状态；确认实际付款后才生成台账。付款确认人不得为制单人或经办人。"
          />
          <dl class="grid grid-cols-1 gap-4 rounded-lg border border-default p-4 sm:grid-cols-2 lg:grid-cols-3">
            <template
              v-for="(label, key) in fields"
              :key="key"
            >
              <div
                v-if="row[key] !== undefined && row[key] !== null"
                class="min-w-0"
              >
                <dt class="text-sm text-muted">
                  {{ label }}
                </dt><dd class="break-all">
                  {{ row[key] }}
                </dd>
              </div>
            </template>
          </dl>
          <div
            v-if="Array.isArray(row.items)"
            class="mt-4 space-y-2"
          >
            <article
              v-for="(item, index) in (row.items as Array<Record<string, unknown>>)"
              :key="index"
              class="flex min-w-0 justify-between gap-3 rounded border border-default p-3"
            >
              <span class="min-w-0 break-words">{{ item.description }}</span><span class="shrink-0 tabular-nums">{{ item.amount }} {{ row.currency_code }}</span>
            </article>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            <UButton
              v-if="hasPermission(ledgerResource[kind], kind === 'receipts' ? 'confirm' : 'edit') && (kind === 'invoices' ? row.status === 'issued' : ['draft', 'rejected'].includes(row.status))"
              :disabled="!!submitPayload"
              :to="moduleUrl(`${ledgerPath(kind)}/${row.code}/edit`)"
              color="neutral"
              variant="outline"
            >
              编辑
            </UButton>
            <template v-if="kind === 'invoice-requests'">
              <UButton
                v-if="(['draft', 'rejected'].includes(row.status) || (row.status === 'pending_approval' && submitPayload)) && row.requested_by === currentUser && hasPermission('invoices', 'edit')"
                :loading="saving && action === 'submit'"
                @click="chooseAction('submit')"
              >
                {{ submitPayload ? '重试审批提交' : '提交审批' }}
              </UButton>
              <UButton
                v-if="row.status === 'approved' && hasPermission('invoices', 'issue')"
                :disabled="!row.requested_by || row.requested_by === currentUser"
                :to="moduleUrl(`/invoices/requests/${row.code}/issue`)"
              >
                办理开票
              </UButton>
              <p
                v-if="row.status === 'approved' && row.requested_by === currentUser"
                class="w-full text-sm text-muted"
              >
                此申请由你发起，请交另一位获权人员开票。
              </p>
              <UButton
                v-if="row.status === 'approved' && hasPermission('invoices', 'issue')"
                :to="moduleUrl(`/invoices/requests/${row.code}/assign-issuance`)"
                color="neutral"
                variant="outline"
              >
                指派开票
              </UButton>
              <UButton
                v-if="!submitPayload && ['draft', 'rejected'].includes(row.status) && hasPermission('invoices', 'edit')"
                color="warning"
                variant="outline"
                @click="chooseAction('cancel')"
              >
                取消申请
              </UButton>
            </template>
            <template v-if="isSpend(kind)">
              <UButton
                v-if="kind !== 'expenses' && (['draft', 'rejected'].includes(row.status) || submitPayload) && row.applicant_uid === currentUser && hasPermission('expenses', 'edit')"
                :loading="saving && action === 'submit'"
                @click="chooseAction('submit')"
              >
                {{ submitPayload ? '重试审批提交' : '提交审批' }}
              </UButton>
              <UButton
                v-if="(kind === 'expenses' ? row.status === 'draft' : row.status === 'approved') && hasPermission('expenses', 'confirm')"
                :disabled="[row.applicant_uid, row.handler_uid, row.created_by].includes(currentUser)"
                @click="chooseAction('confirm')"
              >
                确认实际付款
              </UButton>
              <span
                v-if="(kind === 'expenses' ? row.status === 'draft' : row.status === 'approved') && [row.applicant_uid, row.handler_uid, row.created_by].includes(currentUser)"
                class="text-sm text-muted"
              >制单人和经办人不能确认自己的付款</span>
              <UButton
                v-if="!submitPayload && ['draft', 'rejected'].includes(row.status) && hasPermission('expenses', 'edit') && (kind === 'expenses' || row.applicant_uid === currentUser)"
                color="warning"
                variant="outline"
                @click="action = kind === 'expenses' ? 'delete' : 'cancel'"
              >
                {{ kind === 'expenses' ? '删除草稿' : '取消申请' }}
              </UButton>
            </template>
            <UButton
              v-if="['invoice-requests', 'claims', 'project-requests', 'payment-requests'].includes(kind) && row.status === 'pending_approval' && !row.workflow_instance_id && hasPermission(ledgerResource[kind], 'edit') && (row.applicant_uid === currentUser || row.requested_by === currentUser)"
              :loading="saving"
              @click="chooseAction('resume')"
            >
              恢复提交
            </UButton>
            <template v-if="kind === 'receipts'">
              <UButton
                v-if="row.status === 'draft' && hasPermission('receipts', 'confirm')"
                @click="chooseAction('confirm')"
              >
                确认到账
              </UButton>
              <UButton
                v-if="hasPermission('receipts', 'edit')"
                :to="moduleUrl(`/receipts/${row.code}/classify`)"
                color="neutral"
                variant="outline"
              >
                分类
              </UButton>
              <UButton
                v-if="row.status === 'draft' && hasPermission('receipts', 'edit')"
                color="error"
                variant="outline"
                @click="chooseAction('delete')"
              >
                删除草稿
              </UButton>
              <UButton
                v-if="['confirmed', 'partially_reconciled'].includes(row.status) && hasPermission('reconciliation', 'confirm')"
                :disabled="!row.confirmed_by || row.confirmed_by === currentUser"
                :to="moduleUrl(`/receipts/${row.code}/allocate`)"
              >
                办理核销
              </UButton>
              <p
                v-if="['confirmed', 'partially_reconciled'].includes(row.status) && row.confirmed_by === currentUser"
                class="w-full text-sm text-muted"
              >
                到账已由你确认，请交另一位财务分配。复制本页交接链接，由对方登录后办理。
              </p>
            </template>
            <template v-if="kind === 'invoices' && row.status === 'issued' && hasPermission('invoices', 'edit')">
              <UButton
                color="warning"
                variant="outline"
                @click="chooseAction('void')"
              >
                作废
              </UButton><UButton
                color="warning"
                variant="outline"
                @click="chooseAction('red-reverse')"
              >
                红冲
              </UButton>
            </template>
          </div>
          <ul
            v-if="row.attachments?.length"
            class="mt-4 space-y-2"
          >
            <li
              v-for="file in row.attachments"
              :key="file.code"
            >
              <UButton
                color="neutral"
                variant="link"
                icon="i-lucide-paperclip"
                @click="preview(file.code)"
              >
                {{ file.file_name }}
              </UButton>
            </li>
          </ul>
        </template>
        <UModal
          v-model:open="dialog"
          :title="actionLabel"
          description="请确认单据与操作后果。"
        >
          <template #body>
            <div class="space-y-4">
              <UFormField
                v-if="action === 'red-reverse'"
                label="红字发票号码"
              >
                <UInput
                  v-model="invoiceNo"
                  class="w-full"
                />
              </UFormField><UFormField
                v-if="['void', 'red-reverse'].includes(action || '')"
                label="原因"
              >
                <UInput
                  v-model="reason"
                  class="w-full"
                />
              </UFormField><UButton
                :loading="saving"
                @click="execute"
              >
                继续确认
              </UButton>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
