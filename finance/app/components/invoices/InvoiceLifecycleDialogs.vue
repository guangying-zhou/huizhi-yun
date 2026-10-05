<script setup lang="ts">
import { financeApiPath } from '~/composables/useFinanceApi'
import {
  invoiceCode,
  invoiceReceiptReconcileDefaultAmount,
  isInvoiceReceiptReconcileDisabled,
  numericMoney
} from '~/utils/invoiceActions'

interface ReceiptReconcileForm {
  bankAccountId: string
  receivedAt: string
  receivedAmount: string
  note: string
}

const props = defineProps<{
  currentUserId?: string
}>()

const emit = defineEmits<{
  updated: []
}>()

const toast = useToast()
const selectedInvoice = ref<Record<string, unknown> | null>(null)
const receiptOpen = ref(false)
const receiptPending = ref(false)
const receiptError = ref('')
const receiptForm = ref<ReceiptReconcileForm>({
  bankAccountId: '',
  receivedAt: '',
  receivedAmount: '',
  note: ''
})
const bankAccountOptions = ref<Array<{ label: string, value: string }>>([])
const redReverseOpen = ref(false)
const redReverseReason = ref('')
const redReverseInvoiceNo = ref('')
const redReversePending = ref(false)
const deleteOpen = ref(false)
const deleteReason = ref('')
const deletePending = ref(false)

const selectedTitle = computed(() => {
  const row = selectedInvoice.value
  return row ? String(row.invoice_no || row.invoiceNo || invoiceCode(row)).trim() : ''
})

function errorText(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { message?: string, statusMessage?: string }
    statusMessage?: string
    message?: string
  }
  return String(candidate?.data?.message || candidate?.data?.statusMessage || candidate?.statusMessage || candidate?.message || fallback)
}

function responsePage(value: unknown) {
  let payload = value
  if (payload && typeof payload === 'object' && 'code' in payload && 'data' in payload) {
    payload = (payload as { data?: unknown }).data
  }
  if (Array.isArray(payload)) {
    const data = payload as Record<string, unknown>[]
    return { data, total: data.length }
  }
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    const page = payload as { data: Record<string, unknown>[], total?: unknown }
    return { data: page.data, total: Number(page.total || page.data.length) }
  }
  return { data: [] as Record<string, unknown>[], total: 0 }
}

function bankAccountLabel(account: Record<string, unknown>) {
  const name = String(account.account_name || account.code || '')
  const bankName = String(account.bank_name || '').trim()
  const code = String(account.code || '').trim()
  const suffix = [bankName, code].filter(Boolean).join('，')
  return suffix ? `${name}（${suffix}）` : name
}

async function loadBankAccountOptions() {
  if (bankAccountOptions.value.length > 0) return
  const accounts: Record<string, unknown>[] = []
  for (let page = 1; page <= 100; page++) {
    const response = await $fetch<unknown>(financeApiPath('/bank-accounts'), {
      query: { page, pageSize: 100, showAll: '1' }
    })
    const result = responsePage(response)
    accounts.push(...result.data)
    if (!result.data.length || accounts.length >= result.total) break
  }
  bankAccountOptions.value = accounts
    .filter(account => String(account.status || 'active') === 'active')
    .map(account => ({
      label: bankAccountLabel(account),
      value: String(account.id || '')
    }))
    .filter(option => option.value)
}

async function openReceipt(row: Record<string, unknown>) {
  if (isInvoiceReceiptReconcileDisabled(row)) {
    toast.add({ title: '无法核销', description: '仅已开票且存在未核销金额的发票可以执行该操作。', color: 'warning' })
    return
  }
  selectedInvoice.value = row
  receiptError.value = ''
  receiptForm.value = {
    bankAccountId: '',
    receivedAt: new Date().toISOString().slice(0, 10),
    receivedAmount: invoiceReceiptReconcileDefaultAmount(row),
    note: ''
  }
  receiptOpen.value = true
  try {
    await loadBankAccountOptions()
  } catch (error) {
    receiptError.value = errorText(error, '收款账户加载失败')
  }
}

async function submitReceipt() {
  const code = selectedInvoice.value ? invoiceCode(selectedInvoice.value) : ''
  if (!code) return
  const amount = numericMoney(receiptForm.value.receivedAmount)
  if (!receiptForm.value.bankAccountId) receiptError.value = '请选择收款账户'
  else if (!receiptForm.value.receivedAt) receiptError.value = '请选择到账日期'
  else if (amount <= 0) receiptError.value = '到账金额必须大于 0'
  else receiptError.value = ''
  if (receiptError.value) return

  receiptPending.value = true
  try {
    const actor = props.currentUserId || 'finance-ui'
    await $fetch(financeApiPath(`/invoices/${encodeURIComponent(code)}/receipt-reconcile`), {
      method: 'POST',
      body: {
        bankAccountId: receiptForm.value.bankAccountId,
        receivedAt: receiptForm.value.receivedAt,
        receivedAmount: receiptForm.value.receivedAmount,
        reconciledAmount: receiptForm.value.receivedAmount,
        note: receiptForm.value.note.trim(),
        createdBy: actor,
        updatedBy: actor,
        confirmedBy: actor
      }
    })
    toast.add({ title: '核销完成', description: `${code} 已生成收款记录并完成核销。`, color: 'success' })
    receiptOpen.value = false
    selectedInvoice.value = null
    emit('updated')
  } catch (error) {
    receiptError.value = errorText(error, '核销失败')
  } finally {
    receiptPending.value = false
  }
}

function openRedReverse(row: Record<string, unknown>) {
  selectedInvoice.value = row
  redReverseReason.value = ''
  redReverseInvoiceNo.value = ''
  redReverseOpen.value = true
}

async function submitRedReverse() {
  const code = selectedInvoice.value ? invoiceCode(selectedInvoice.value) : ''
  if (!code) return
  if (!redReverseReason.value.trim()) {
    toast.add({ title: '请填写冲红原因', color: 'warning' })
    return
  }
  redReversePending.value = true
  try {
    await $fetch(financeApiPath(`/invoices/${encodeURIComponent(code)}/red-reverse`), {
      method: 'POST',
      body: {
        reason: redReverseReason.value.trim(),
        redInvoiceNo: redReverseInvoiceNo.value.trim(),
        redReversedBy: props.currentUserId || 'finance-ui'
      }
    })
    toast.add({ title: '已冲红', description: `${code} 已标记为已红冲。`, color: 'success' })
    redReverseOpen.value = false
    selectedInvoice.value = null
    emit('updated')
  } catch (error) {
    toast.add({ title: errorText(error, '冲红失败'), color: 'error' })
  } finally {
    redReversePending.value = false
  }
}

function openDelete(row: Record<string, unknown>) {
  selectedInvoice.value = row
  deleteReason.value = ''
  deleteOpen.value = true
}

async function submitDelete() {
  const code = selectedInvoice.value ? invoiceCode(selectedInvoice.value) : ''
  if (!code) return
  deletePending.value = true
  try {
    await $fetch(financeApiPath(`/invoices/${encodeURIComponent(code)}/delete-with-file`), {
      method: 'POST',
      body: {
        reason: deleteReason.value.trim(),
        deletedBy: props.currentUserId || 'finance-ui'
      }
    })
    toast.add({ title: '已删除', description: `${code} 已删除。`, color: 'success' })
    deleteOpen.value = false
    selectedInvoice.value = null
    emit('updated')
  } catch (error) {
    toast.add({ title: errorText(error, '删除失败'), color: 'error' })
  } finally {
    deletePending.value = false
  }
}

defineExpose({ openReceipt, openRedReverse, openDelete })
</script>

<template>
  <div class="contents">
    <UModal
      v-model:open="receiptOpen"
      :title="selectedTitle ? `核销 ${selectedTitle}` : '收款核销'"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">收款核销</span>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                title="关闭"
                aria-label="关闭收款核销"
                @click="receiptOpen = false"
              />
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField
                label="收款账户"
                required
              >
                <USelect
                  v-model="receiptForm.bankAccountId"
                  :items="bankAccountOptions"
                  value-key="value"
                  label-key="label"
                  placeholder="选择到账账户"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="到账日期"
                required
              >
                <UInput
                  v-model="receiptForm.receivedAt"
                  type="date"
                />
              </UFormField>
              <UFormField
                label="到账金额"
                required
              >
                <UInput
                  v-model="receiptForm.receivedAmount"
                  type="number"
                  min="0"
                  step="0.01"
                />
              </UFormField>
              <UFormField label="备注">
                <UInput
                  v-model="receiptForm.note"
                  placeholder="可选"
                />
              </UFormField>
            </div>

            <UAlert
              v-if="bankAccountOptions.length === 0"
              color="warning"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="暂无可用收款账户"
            />
            <UAlert
              v-if="receiptError"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              :title="receiptError"
            />
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="receiptOpen = false"
              >
                取消
              </UButton>
              <UButton
                icon="i-lucide-circle-dollar-sign"
                color="success"
                :loading="receiptPending"
                :disabled="bankAccountOptions.length === 0"
                @click="submitReceipt"
              >
                确认核销
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <UModal
      v-model:open="redReverseOpen"
      :title="selectedTitle ? `冲红 ${selectedTitle}` : '冲红发票'"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">冲红发票</span>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                title="关闭"
                aria-label="关闭冲红发票"
                @click="redReverseOpen = false"
              />
            </div>
          </template>
          <div class="space-y-4">
            <UAlert
              color="warning"
              variant="subtle"
              icon="i-lucide-circle-alert"
              title="冲红后该发票不再计入开票金额统计"
            />
            <UFormField label="红字发票号码">
              <UInput
                v-model="redReverseInvoiceNo"
                placeholder="可选"
              />
            </UFormField>
            <UFormField
              label="冲红原因"
              required
            >
              <UTextarea
                v-model="redReverseReason"
                placeholder="请填写冲红原因"
                :rows="4"
              />
            </UFormField>
          </div>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="redReverseOpen = false"
              >
                取消
              </UButton>
              <UButton
                icon="i-lucide-undo-2"
                color="warning"
                :loading="redReversePending"
                @click="submitRedReverse"
              >
                确认冲红
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <UModal
      v-model:open="deleteOpen"
      :title="selectedTitle ? `删除 ${selectedTitle}` : '删除发票'"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">删除发票</span>
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                title="关闭"
                aria-label="关闭删除发票"
                @click="deleteOpen = false"
              />
            </div>
          </template>
          <div class="space-y-4">
            <UAlert
              color="error"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="确认后将删除发票记录"
              description="属于默认对象存储 finance/invoices/ 目录的发票文件会同步删除；历史外部链接只删除台账记录。"
            />
            <UFormField label="删除原因">
              <UTextarea
                v-model="deleteReason"
                placeholder="可选，建议填写业务原因"
                :rows="4"
              />
            </UFormField>
          </div>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="deleteOpen = false"
              >
                取消
              </UButton>
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                :loading="deletePending"
                @click="submitDelete"
              >
                确认删除
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
