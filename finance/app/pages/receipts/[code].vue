<script setup lang="ts">
type RuntimeEnvelope<T> = { data?: T, message?: string }
type Receipt = Record<string, unknown>

const route = useRoute()
const toast = useToast()
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
const code = computed(() => String(route.params.code || '').trim())
const receipt = ref<Receipt | null>(null)
const loading = ref(true)
const loadError = ref('')
const reconcileOpen = ref(false)
const reconcilePending = ref(false)
const reconcileError = ref('')
const form = reactive({ reconciledAmount: '', invoiceCode: '', reconciliationType: 'contract_receivable' })
const typeOptions = [
  { label: '合同应收', value: 'contract_receivable' },
  { label: '发票核销', value: 'invoice' },
  { label: '预收款', value: 'advance' },
  { label: '手工核销', value: 'manual' }
]
const canConfirmReconciliation = computed(() => permissionsLoaded.value && hasPermission('reconciliation', 'confirm'))
const receivedAmount = computed(() => Number(receipt.value?.received_amount || 0))
const reconciledAmount = computed(() => Number(receipt.value?.reconciled_amount || 0))
const remainingAmount = computed(() => Math.max(0, receivedAmount.value - reconciledAmount.value))
const canReconcileCurrent = computed(() => canConfirmReconciliation.value && remainingAmount.value > 0)
const title = computed(() => receipt.value ? `到账记录 ${code.value}` : '到账记录详情')

usePageTitle(title)

onMounted(async () => {
  await Promise.all([loadPermissions(), loadReceipt()])
})

function text(value: unknown) {
  return String(value ?? '').trim()
}
function value(...keys: string[]) {
  for (const key of keys) {
    const candidate = receipt.value?.[key]
    if (candidate !== undefined && candidate !== null && text(candidate)) return text(candidate)
  }
  return '-'
}
function statusLabel(status: unknown) {
  return ({ confirmed: '已确认', unreconciled: '未核销', partially_reconciled: '部分核销', reconciled: '已核销', canceled: '已取消' } as Record<string, string>)[text(status)] || text(status) || '-'
}
function errorText(error: unknown, fallback: string) {
  const candidate = error as { data?: { message?: string }, message?: string }
  return text(candidate?.data?.message || candidate?.message || fallback)
}

async function loadReceipt() {
  loading.value = true
  loadError.value = ''
  receipt.value = null
  try {
    const response = await $fetch<RuntimeEnvelope<Receipt>>(financeApiPath(`/receipts/${encodeURIComponent(code.value)}`))
    receipt.value = response.data || null
  } catch (error) {
    loadError.value = errorText(error, '到账记录加载失败')
  } finally {
    loading.value = false
  }
}

function openReconciliation() {
  form.reconciledAmount = remainingAmount.value.toFixed(2)
  form.invoiceCode = ''
  form.reconciliationType = 'contract_receivable'
  reconcileError.value = ''
  reconcileOpen.value = true
}

async function submitReconciliation() {
  reconcilePending.value = true
  reconcileError.value = ''
  try {
    const amount = Number(form.reconciledAmount)
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('请输入大于 0 的核销金额')
    if (amount > remainingAmount.value) throw new Error('核销金额不能超过待核销金额')
    if (form.reconciliationType === 'invoice' && !form.invoiceCode.trim()) throw new Error('发票核销需要填写发票编号')
    await $fetch(financeApiPath('/reconciliation'), {
      method: 'POST',
      body: {
        receiptCode: code.value,
        reconciledAmount: amount.toFixed(2),
        reconciliationType: form.reconciliationType,
        ...(form.invoiceCode.trim() ? { invoiceCode: form.invoiceCode.trim() } : {})
      }
    })
    toast.add({ title: '核销成功', description: `${code.value} 的到账金额已更新`, color: 'success' })
    reconcileOpen.value = false
    await loadReceipt()
  } catch (error) {
    reconcileError.value = errorText(error, '核销失败')
  } finally {
    reconcilePending.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="finance-receipt-detail"
    grow
  >
    <template #header>
      <UDashboardToolbar>
        <template #left>
          <div class="flex min-w-0 items-center gap-3">
            <UButton
              to="/finance/receipts"
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="ghost"
              aria-label="返回到账记录列表"
            />
            <div class="min-w-0">
              <h1 class="truncate text-base font-semibold text-highlighted">
                {{ title }}
              </h1><p class="truncate text-sm text-muted">
                核对到账信息并完成当前核销任务
              </p>
            </div>
          </div>
        </template>
        <template #right>
          <UButton
            v-if="canReconcileCurrent"
            icon="i-lucide-link-2"
            @click="openReconciliation"
          >
            确认核销
          </UButton>
        </template>
      </UDashboardToolbar>
    </template>

    <div class="space-y-4 p-4">
      <UCard v-if="loading">
        <div class="py-16 text-center text-sm text-muted">
          正在加载到账记录...
        </div>
      </UCard>
      <UAlert
        v-else-if="loadError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="到账记录加载失败"
        :description="loadError"
      />
      <UAlert
        v-else-if="!receipt"
        color="warning"
        variant="subtle"
        icon="i-lucide-file-question"
        title="未找到到账记录"
        :description="`没有找到编号为 ${code} 的到账记录，或你无权查看。`"
      />
      <template v-else>
        <UAlert
          v-if="canConfirmReconciliation && !canReconcileCurrent"
          color="success"
          variant="subtle"
          title="无需继续核销"
          description="该到账记录当前没有待核销金额。"
        />
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="font-semibold text-highlighted">
                  到账概览
                </p><p class="text-sm text-muted">
                  {{ value('customer_name', 'customerName', 'customer_code', 'customerCode') }}
                </p>
              </div><UBadge
                color="neutral"
                variant="subtle"
              >
                {{ statusLabel(receipt.reconciliation_status || receipt.status) }}
              </UBadge>
            </div>
          </template>
          <dl class="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <dt class="text-xs text-muted">
                到账编号
              </dt><dd class="mt-1 text-sm font-medium text-highlighted">
                {{ code }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                到账金额
              </dt><dd class="mt-1 text-sm font-medium text-highlighted">
                {{ formatMoney(receivedAmount) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                已核销金额
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ formatMoney(reconciledAmount) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                待核销金额
              </dt><dd class="mt-1 text-sm font-medium text-highlighted">
                {{ formatMoney(remainingAmount) }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                合同编号
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('contract_code', 'contractCode') }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                项目编号
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('project_code', 'projectCode') }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                核销责任人
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('reconciliation_responsible_uid', 'reconciliationResponsibleUid') }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                核销截止时间
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('reconciliation_due_at', 'reconciliationDueAt') }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                到账时间
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('received_at', 'receivedAt') }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                银行流水号
              </dt><dd class="mt-1 text-sm text-highlighted">
                {{ value('bank_reference_no', 'bankReferenceNo') }}
              </dd>
            </div>
          </dl>
        </UCard>
      </template>
    </div>

    <UModal
      v-model:open="reconcileOpen"
      title="确认核销"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div>
              <p class="font-semibold text-highlighted">
                确认核销
              </p><p class="text-sm text-muted">
                待核销 {{ formatMoney(remainingAmount) }}
              </p>
            </div>
          </template>
          <div class="space-y-4">
            <UFormField
              label="核销类型"
              required
            >
              <USelect
                v-model="form.reconciliationType"
                :items="typeOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="form.reconciliationType === 'invoice'"
              label="发票编号"
              required
            >
              <UInput
                v-model="form.invoiceCode"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="核销金额"
              required
            >
              <UInput
                v-model="form.reconciledAmount"
                type="number"
                min="0.01"
                step="0.01"
                class="w-full"
              />
            </UFormField>
            <UAlert
              v-if="reconcileError"
              color="error"
              variant="subtle"
              :title="reconcileError"
            />
          </div>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="reconcileOpen = false"
              >
                取消
              </UButton><UButton
                color="success"
                :loading="reconcilePending"
                @click="submitReconciliation"
              >
                确认核销
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
