<script setup lang="ts">
import { ledgerRequiredFields, validateLedgerForm } from '../../utils/hostFinanceLedgerValidation'
import FinanceBusinessObjectSelect from './FinanceBusinessObjectSelect.vue'
import UserTreeSelector from '../../../../foundation/app/components/UserTreeSelector.vue'
import type { FinanceObjectKind, FinanceObjectRow } from '../../utils/hostFinanceObjectChoices'
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useFinanceModule } from '../../../layer/useFinanceModule'
import { ledgerResource, ledgerPath, ledgerTitles, ledgerWriteMessage, type FinanceLedgerKind, type FinanceLedgerRow, type FinanceLedgerPage, type FinanceBillingCandidate } from '../../utils/hostFinanceLedger'
import { createFinanceIntent, decimalInput } from '../../utils/hostFinanceForms'

const props = defineProps<{ kind: FinanceLedgerKind, objectCode?: string, embedded?: boolean, initialContext?: Record<string, string>, action?: 'edit' | 'issue' | 'assign-issuance' | 'classify' | 'void' }>()
const emit = defineEmits<{ saved: [code: string] }>()
const route = useRoute()
const router = useRouter()
const { hosted, apiUrl, moduleUrl, sessionScope } = useFinanceModule()
const { loaded, error: permissionError, hasPermission, loadPermissions } = usePermissions()
onMounted(() => {
  void loadPermissions()
})
const code = computed(() => String(props.objectCode ?? route.params.code ?? ''))
const altocSource = computed(() => hosted && props.kind === 'invoice-requests' && !code.value && route.query.source === 'altoc')
const sourceContract = computed(() => String(route.query.contractId || ''))
const sourceSchedule = computed(() => String(route.query.billingScheduleCode || ''))
const mode = computed(() => props.action || (code.value ? 'edit' : 'create'))
const required = computed(() => ['issue', 'assign-issuance'].includes(mode.value) ? 'issue' : props.kind === 'receipts' && mode.value !== 'classify' ? 'confirm' : props.kind === 'reconciliation' ? 'confirm' : 'edit')
const allowed = computed(() => loaded.value && !permissionError.value && hasPermission(ledgerResource[props.kind], required.value))
const fields = computed<Array<{ key: string, label: string, type?: 'date' | 'datetime-local', amount?: boolean }>>(() => {
  if (mode.value === 'issue') return [{ key: 'invoiceNo', label: '发票号码' }, { key: 'invoiceDate', label: '开票日期', type: 'date' }]
  if (mode.value === 'assign-issuance') return [{ key: 'responsibleUid', label: '开票责任人' }, { key: 'dueAt', label: '办理截止时间', type: 'datetime-local' }]
  if (mode.value === 'classify') return [{ key: 'incomeTypeId', label: '收入分类 ID' }, { key: 'note', label: '说明' }]
  if (mode.value === 'void') return [{ key: 'reason', label: '撤销原因' }]
  if (altocSource.value) return [{ key: 'invoiceProfileCode', label: '开票资料编码' }, { key: 'invoiceItem', label: '开票内容' }, { key: 'requestedAmount', label: '申请金额', amount: true }]
  if (props.kind === 'invoice-requests') return [{ key: 'customerCode', label: '客户' }, { key: 'customerName', label: '客户名称' }, { key: 'contractCode', label: '合同' }, { key: 'billingScheduleCode', label: '结算计划' }, { key: 'invoiceProfileCode', label: '开票资料编码' }, { key: 'invoiceItem', label: '开票内容' }, { key: 'requestedAmount', label: '申请金额', amount: true }, { key: 'currencyCode', label: '币种' }, { key: 'taxpayerName', label: '购方名称' }, { key: 'taxpayerNo', label: '购方税号' }, { key: 'remark', label: '备注' }]
  if (props.kind === 'invoices') return [{ key: 'invoiceItem', label: '开票内容' }, { key: 'remark', label: '备注' }]
  if (props.kind === 'receipts') return [{ key: 'customerCode', label: '客户' }, { key: 'customerName', label: '客户名称' }, { key: 'contractCode', label: '合同' }, { key: 'billingScheduleCode', label: '结算计划' }, { key: 'receiptNo', label: '银行流水号' }, { key: 'receivedAmount', label: '到账金额', amount: true }, { key: 'receivedAt', label: '到账日期', type: 'date' }, { key: 'currencyCode', label: '币种' }, { key: 'bankAccountId', label: '银行账户' }, { key: 'payerName', label: '付款方' }, { key: 'responsibleUid', label: '核销责任人' }, { key: 'dueAt', label: '核销截止时间', type: 'datetime-local' }, { key: 'note', label: '说明' }]
  return [{ key: 'receiptCode', label: '确认到账编号' }, { key: 'invoiceCode', label: '发票编号（可选）' }, { key: 'billingScheduleCode', label: '结算计划编号（可选）' }, { key: 'contractCode', label: '合同编码（可选）' }, { key: 'reconciledAmount', label: '核销金额', amount: true }, { key: 'currencyCode', label: '币种' }, { key: 'note', label: '说明' }]
})
const form = reactive<Record<string, string>>({ currencyCode: 'CNY', ...props.initialContext })
let cleanForm = JSON.stringify(form)
const responsibleUids = computed({ get: () => form.responsibleUid ? [form.responsibleUid] : [], set: (uids: string[]) => {
  form.responsibleUid = uids[0] || ''
} })
const objectFields: Record<string, FinanceObjectKind> = { customerCode: 'customers', contractCode: 'contracts', billingScheduleCode: 'billing-schedules', bankAccountId: 'bank-accounts' }
function selectedObject(key: string, row: FinanceObjectRow) {
  if (key === 'customerCode') form.customerName = String(row.name || '')
  if (key === 'contractCode') form.billingScheduleCode = ''
}
const original = ref<FinanceLedgerRow | null>(null)
const comparison = ref<FinanceLedgerRow | null>(null)
const source = ref<FinanceLedgerRow | null>(null)
const target = ref<FinanceLedgerRow | null>(null)
const billingCandidates = computed(() => (source.value?.billing_candidates || []) as FinanceBillingCandidate[])
async function inspectTargets() {
  try {
    await preflight()
  } catch (failure) {
    toast.add({ title: ledgerWriteMessage(failure), color: 'error' })
  }
}
const pending = ref(false)
const saving = ref(false)
const uncertain = ref(false)
const loadError = ref('')
const saveError = ref('')
const fieldErrors = ref<Record<string, string>>({})
const requiredFields = computed(() => ledgerRequiredFields(props.kind, mode.value))
const toast = useToast()
const { confirm } = useConfirm()
const intent = createFinanceIntent()
const uploadIntent = createFinanceIntent()
let frozenSignature = ''
let frozenPayload: Record<string, unknown> | null = null
const file = shallowRef<File | null>(null)
const attachment = ref<Record<string, unknown> | null>(null)
let generation = 0
const mapping: Record<string, string> = { responsibleUid: 'reconciliation_responsible_uid', dueAt: 'reconciliation_due_at' }
const snake = (key: string) => mapping[key] || key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
async function load(compare = false) {
  const epoch = ++generation
  if (!code.value || !allowed.value) return
  pending.value = true
  loadError.value = ''
  try {
    let row: FinanceLedgerRow | undefined
    if (props.kind === 'reconciliation') {
      const response = await $fetch<FinanceLedgerPage>(apiUrl('/reconciliation'), { query: { page: 1, pageSize: 20, search: code.value }, retry: 0 })
      row = response.data.find(r => r.code === code.value)
    } else row = (await $fetch<{ data: FinanceLedgerRow }>(apiUrl(`/${props.kind}/${encodeURIComponent(code.value)}`), { retry: 0 })).data
    if (epoch !== generation) return
    if (!row) throw new Error('Unavailable')
    if (compare) comparison.value = row
    else {
      original.value = row
      for (const field of fields.value) {
        const value = String(row[snake(field.key)] ?? form[field.key] ?? '')
        form[field.key] = field.type === 'date' ? value.slice(0, 10) : field.type === 'datetime-local' ? value.replace(' ', 'T').slice(0, 16) : value
      }
      if (mode.value === 'issue') form.invoiceDate = new Date().toISOString().slice(0, 10)
      if (mode.value === 'assign-issuance') {
        form.responsibleUid = String(row.issuance_responsible_uid || '')
        form.dueAt = String(row.issuance_due_at || '').replace(' ', 'T').slice(0, 16)
      }
      cleanForm = JSON.stringify(form)
    }
  } catch {
    if (epoch === generation) loadError.value = '单据详情暂不可用，请稍后重试'
  } finally {
    if (epoch === generation) pending.value = false
  }
}
watch(() => [code.value, allowed.value, sessionScope?.value], () => {
  void load()
}, { immediate: true })
watch(() => sessionScope?.value, () => {
  generation++
  Object.keys(form).forEach((k) => {
    Reflect.deleteProperty(form, k)
  })
  form.currencyCode = 'CNY'
  original.value = null
  comparison.value = null
  source.value = null
  target.value = null
  attachment.value = null
  file.value = null
  intent.reset()
  uploadIntent.reset()
  frozenSignature = ''
  frozenPayload = null
})
onScopeDispose(() => {
  generation++
})
async function preflight() {
  source.value = null
  target.value = null
  source.value = (await $fetch<{ data: FinanceLedgerRow }>(apiUrl(`/receipts/${encodeURIComponent(form.receiptCode || '')}`), { retry: 0 })).data
  if (form.invoiceCode) target.value = (await $fetch<{ data: FinanceLedgerRow }>(apiUrl(`/invoices/${encodeURIComponent(form.invoiceCode)}`), { retry: 0 })).data
  if (source.value.status === 'draft') throw { statusCode: 409, data: { code: 'finance_receipt_not_confirmed' } }
}
function selectFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] || null
  attachment.value = null
}
async function upload() {
  if (!file.value || !original.value) throw new Error('请上传发票 PDF/OFD 附件')
  const body = new FormData()
  body.set('file', file.value)
  body.set('entityType', 'finance_invoice_request')
  body.set('entityCode', original.value.code)
  const response = await $fetch<{ data: Record<string, unknown> }>(apiUrl('/invoices/files'), { method: 'POST', body, headers: { 'Idempotency-Key': uploadIntent.key({ code: code.value, name: file.value.name, size: file.value.size, lastModified: file.value.lastModified }) }, retry: 0 })
  attachment.value = response.data
}
async function save() {
  if (!allowed.value || saving.value) return
  fieldErrors.value = validateLedgerForm(props.kind, mode.value, form, fields.value, !!file.value || !!attachment.value)
  if (Object.keys(fieldErrors.value).length) {
    saveError.value = Object.values(fieldErrors.value)[0]!
    toast.add({ title: saveError.value, color: 'error' })
    return
  }
  saving.value = true
  let attempted = false
  saveError.value = ''
  try {
    const signature = JSON.stringify([code.value, mode.value, form, original.value?.row_version, file.value?.name, file.value?.size, file.value?.lastModified, altocSource.value, sourceContract.value, sourceSchedule.value, route.query.expectedVersion, route.query.scheduleVersion])
    const retrying = !!frozenPayload && (uncertain.value || frozenSignature === signature)
    const payload: Record<string, unknown> = retrying ? { ...frozenPayload } : {}
    if (!retrying) for (const field of fields.value) {
      const value = form[field.key]
      if (value !== undefined && value !== '') payload[field.key] = field.amount ? decimalInput(value, 2) : ['bankAccountId', 'incomeTypeId'].includes(field.key) ? Number(value) : field.type === 'datetime-local' ? value.replace('T', ' ') + ':00' : value
    }
    if (altocSource.value && !retrying) {
      payload.expectedVersion = Number(route.query.expectedVersion)
      payload.scheduleVersion = Number(route.query.scheduleVersion)
    }
    if (code.value && !retrying) payload.expectedVersion = original.value?.row_version
    if (props.kind === 'reconciliation' && mode.value !== 'void' && !retrying) {
      await preflight()
      payload.targetType = form.invoiceCode ? 'invoice' : form.billingScheduleCode || source.value?.billing_schedule_code ? 'billing_schedule' : form.contractCode || source.value?.contract_code ? 'contract' : 'manual'
      payload.receiptVersion = source.value?.row_version
      if (target.value) payload.invoiceVersion = target.value.row_version
      const parent = target.value || source.value
      if (parent?.billing_schedule_code || form.billingScheduleCode) {
        const candidate = billingCandidates.value.find(r => r.code === (form.billingScheduleCode || parent?.billing_schedule_code))
        payload.scheduleVersion = candidate?.row_version || parent?.billing_schedule_version
      }
      if (!(await confirm({ tone: 'warning', title: '确认核销', message: `将「${form.receiptCode}」的 ${String(payload.reconciledAmount)} ${form.currencyCode} 分配至「${form.invoiceCode || form.billingScheduleCode || form.contractCode || '手工目标'}」，确认人与核销人须不同，提交后可按规则撤销。` }))) return
    }
    if (mode.value === 'issue') {
      if (!(await confirm({ tone: 'warning', title: '正式开票', message: `为申请「${code.value}」生成正式发票，申请人不能是开票人；审批通过不等于开票完成。` }))) return
      if (!retrying && !attachment.value) await upload()
      Object.assign(payload, { invoiceFileKey: attachment.value?.file_key, invoiceFileName: attachment.value?.file_name, invoiceFileMimeType: attachment.value?.mime_type, invoiceFileSize: Number(attachment.value?.file_size) })
    }
    if (mode.value === 'void' && !(await confirm({ tone: 'danger', title: '撤销核销', message: `撤销「${code.value}」将恢复到账与发票可核销余额，并回写合同结算计划。` }))) return
    frozenSignature = signature
    frozenPayload = { ...payload }
    const suffix = ['issue', 'assign-issuance', 'classify', 'void'].includes(mode.value) ? `/${mode.value}` : ''
    const endpoint = altocSource.value ? `/altoc/api/v1/contracts/${encodeURIComponent(sourceContract.value)}/billing-schedules/${encodeURIComponent(sourceSchedule.value)}/invoice-request` : apiUrl(`/${props.kind}${code.value ? `/${encodeURIComponent(code.value)}` : ''}${suffix}`)
    attempted = true
    const response = await $fetch<{ data: FinanceLedgerRow }>(endpoint, { method: code.value && !suffix ? 'PATCH' : 'POST', body: payload, headers: { 'Idempotency-Key': intent.key({ code: code.value, mode: mode.value, payload }) }, retry: 0 })
    uncertain.value = false
    toast.add({ title: mode.value === 'issue' ? '正式发票已生成' : mode.value === 'void' ? '核销已撤销' : '单据已保存', color: 'success' })
    if (props.embedded) emit('saved', response.data.code)
    else await router.push(moduleUrl(props.kind === 'reconciliation' ? '/reconciliation' : `${ledgerPath(props.kind)}/${response.data.code}`))
    intent.reset()
  } catch (failure) {
    const status = (failure as { statusCode?: number, status?: number }).statusCode || (failure as { status?: number }).status || 0
    if (props.embedded && attempted) uncertain.value = !status || status >= 500
    saveError.value = ledgerWriteMessage(failure)
    toast.add({ title: saveError.value, color: 'error' })
  } finally {
    saving.value = false
  }
}
defineExpose({ hasDraft: () => saving.value || uncertain.value || JSON.stringify(form) !== cleanForm })
</script>

<template>
  <UDashboardPanel id="finance-ledger-form">
    <template #body>
      <div class="p-4 sm:p-6">
        <ContentPageHeader
          v-if="hosted && !embedded"
          :hosted="hosted"
          :title="`${mode === 'issue' ? '办理开票' : mode === 'void' ? '撤销' : code ? '编辑' : '新建'}${ledgerTitles[kind]}`"
        >
          <template #actions>
            <UButton
              :to="moduleUrl(ledgerPath(kind))"
              color="neutral"
              variant="outline"
            >
              返回列表
            </UButton>
          </template>
        </ContentPageHeader>
        <UProgress
          v-if="!loaded || pending"
          aria-label="加载权限与单据"
        />
        <CommonEmptyState
          v-else-if="permissionError"
          title="权限加载失败"
        />
        <CommonEmptyState
          v-else-if="!allowed"
          title="无权限"
          description="您没有办理此财务单据的权限。"
        />
        <CommonEmptyState
          v-else-if="loadError"
          title="加载失败"
          :description="loadError"
        >
          <template #actions>
            <UButton @click="load()">
              重试
            </UButton>
          </template>
        </CommonEmptyState>
        <form
          v-else
          class="max-w-[720px] space-y-4"
          @submit.prevent="save"
        >
          <UAlert
            v-if="kind === 'invoice-requests' && mode !== 'issue'"
            color="info"
            title="先保存草稿，再在详情页提交审批；正式发票只能由已批申请开票。"
          />
          <UAlert
            v-if="altocSource"
            color="info"
            :title="`来源：合同 ${sourceContract} · 结算计划 ${sourceSchedule}。客户、币种与来源由服务端锁定，需同时具备合同编辑和开票申请编辑权限。`"
          />
          <UAlert
            v-if="mode === 'issue'"
            color="warning"
            title="由另一位获权人员办理开票；审批通过后仍需上传发票并确认。"
          />
          <UAlert
            v-if="kind === 'receipts'"
            color="info"
            title="登记后保存为草稿，确认到账后由另一位财务办理分配。"
          />
          <UAlert
            v-if="saveError"
            color="error"
            :title="saveError"
          >
            <template #actions>
              <UButton
                v-if="code"
                color="neutral"
                variant="outline"
                @click="load(true)"
              >
                刷新比较
              </UButton>
            </template>
          </UAlert>
          <UAlert
            v-if="comparison"
            color="info"
            :title="`最新版本 ${comparison.row_version}（草稿保留）`"
          >
            <template #actions>
              <UButton
                color="neutral"
                @click="original = comparison; comparison = null"
              >
                采用最新版本号
              </UButton>
            </template>
          </UAlert>
          <UAlert
            v-if="uncertain"
            color="warning"
            title="提交结果待确认，请重试原请求"
            description="输入已暂时锁定，重试会沿用原内容和请求编号，避免重复登记。"
          />
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField
              v-for="field in fields"
              :key="field.key"
              :label="field.label"
              :required="requiredFields.includes(field.key)"
              :error="fieldErrors[field.key]"
            >
              <UserTreeSelector
                v-if="field.key === 'responsibleUid'"
                v-model="responsibleUids"
                selection-mode="single"
                hide-committees
                :disabled="saving || uncertain"
              />
              <FinanceBusinessObjectSelect
                v-else-if="hosted && objectFields[field.key]"
                :model-value="form[field.key] || ''"
                :kind="objectFields[field.key]!"
                :enabled="allowed && !saving && !uncertain"
                :contract-code="form.contractCode"
                @update:model-value="form[field.key] = $event"
                @select="selectedObject(field.key, $event)"
              />
              <UInput
                v-else
                v-model="form[field.key]"
                :type="field.type || 'text'"
                class="w-full"
                :disabled="saving || uncertain"
              />
            </UFormField>
          </div>
          <UFormField
            v-if="mode === 'issue'"
            label="发票附件（PDF/OFD，30MB 内）"
            required
            :error="fieldErrors.attachment"
          >
            <UInput
              type="file"
              accept=".pdf,.ofd"
              :disabled="saving || uncertain"
              @change="selectFile"
            />
          </UFormField>
          <UButton
            v-if="kind === 'reconciliation' && mode !== 'void'"
            color="neutral"
            variant="outline"
            :disabled="!form.receiptCode || saving"
            @click="inspectTargets"
          >
            查看到账余额与可核销计划
          </UButton>
          <UFormField
            v-if="billingCandidates.length && !form.invoiceCode"
            label="可核销结算计划（当前合同，最多 100 项）"
          >
            <USelect
              v-model="form.billingScheduleCode"
              :items="billingCandidates.map(r => ({ label: `${r.code} · ${r.amount} ${r.currency_code}`, value: r.code }))"
              class="w-full"
              :disabled="saving || uncertain"
            />
          </UFormField>
          <div
            v-if="source"
            class="rounded-lg border border-default p-3"
          >
            <p class="break-all">
              到账 {{ source.code }}：剩余 {{ source.unreconciled_amount }} {{ source.currency_code }}
            </p><p
              v-if="target"
              class="break-all"
            >
              发票 {{ target.code }}：剩余 {{ target.unreconciled_amount }} {{ target.currency_code }}
            </p>
          </div>
          <UButton
            type="submit"
            :loading="saving"
            :disabled="!allowed"
          >
            {{ mode === 'issue' ? '确认开票' : mode === 'void' ? '确认撤销' : '保存' }}
          </UButton>
        </form>
      </div>
    </template>
  </UDashboardPanel>
</template>
