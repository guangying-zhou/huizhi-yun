<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const toast = useToast()
const id = computed(() => route.params.id)

interface ApiResponse<T> {
  data: T
}

interface ReceivablePlanDetail {
  id: number
  code: string
  plan_name: string
  status: string
  amount: number | string
  received_amount?: number | string | null
  unreceived_amount?: number | string | null
  overdue_days?: number
  owner_user_id?: string | null
  customer_name?: string | null
  contract_id?: number | null
  contract_name?: string | null
  planned_invoice_date?: string | null
  planned_payment_date?: string | null
  invoices?: Record<string, unknown>[]
  payments?: Record<string, unknown>[]
}

interface InvoiceRequestResponse {
  data?: {
    invoiceRequest?: { code?: string }
    financeSubmitError?: unknown
  }
}

function errorMessage(error: unknown, fallback: string) {
  const source = error && typeof error === 'object' ? error as { data?: { message?: string, statusMessage?: string } } : {}
  return source.data?.message || source.data?.statusMessage || fallback
}

function numberValue(value: unknown) {
  return Number(value || 0)
}

const RP_STATUS: Record<string, { label: string, color: string }> = {
  pending: { label: '待开始', color: 'neutral' },
  to_invoice: { label: '待开票', color: 'warning' },
  to_receive: { label: '待回款', color: 'primary' },
  partially_received: { label: '部分回款', color: 'info' },
  received: { label: '已回款', color: 'success' },
  overdue: { label: '已逾期', color: 'error' },
  bad_debt: { label: '坏账', color: 'error' }
}

const { data: plan, status, refresh } = useFetch(() => `/api/v1/payments/${id.value}`, {
  transform: (res: ApiResponse<ReceivablePlanDetail>) => res.data
})

const invoiceRequestLoading = ref(false)
const canRequestInvoice = computed(() => {
  return !!plan.value?.code && ['to_invoice', 'to_receive', 'partially_received'].includes(plan.value.status)
})

function formatMoney(val: number | string | null | undefined) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 }).format(Number(val) || 0)
}

// 登记到账弹窗
const showConfirmModal = ref(false)
const confirmLoading = ref(false)
const confirmForm = reactive({
  received_amount: null as number | null,
  received_at: new Date().toISOString().slice(0, 10),
  payer_name: '',
  bank_account: '',
  note: ''
})

function openConfirm() {
  confirmForm.received_amount = plan.value?.unreceived_amount == null ? null : numberValue(plan.value.unreceived_amount)
  confirmForm.received_at = new Date().toISOString().slice(0, 10)
  confirmForm.payer_name = ''
  confirmForm.bank_account = ''
  confirmForm.note = ''
  showConfirmModal.value = true
}

async function doConfirm() {
  if (!confirmForm.received_amount || confirmForm.received_amount <= 0) {
    toast.add({ title: '请输入到账金额', color: 'error' })
    return
  }
  confirmLoading.value = true
  try {
    await $fetch(`/api/v1/payments/${id.value}/confirm`, {
      method: 'POST',
      body: confirmForm
    })
    toast.add({ title: '到账登记成功', color: 'success' })
    showConfirmModal.value = false
    refresh()
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '登记失败'), color: 'error' })
  } finally {
    confirmLoading.value = false
  }
}

// 更新状态
async function changeStatus(newStatus: string) {
  try {
    await $fetch(`/api/v1/payments/${id.value}`, { method: 'PUT', body: { status: newStatus } })
    toast.add({ title: '状态已更新', color: 'success' })
    refresh()
  } catch { toast.add({ title: '操作失败', color: 'error' }) }
}

async function requestInvoice() {
  if (!plan.value?.code) return
  invoiceRequestLoading.value = true
  try {
    const response = await $fetch<InvoiceRequestResponse>(`/api/v1/receivable-plans/${encodeURIComponent(plan.value.code)}/invoice-request`, {
      method: 'POST',
      body: {
        requestedAmount: plan.value.unreceived_amount || plan.value.amount,
        invoiceItem: plan.value.plan_name,
        submit: true
      }
    })
    const invoiceRequestCode = response?.data?.invoiceRequest?.code
    const submitError = response?.data?.financeSubmitError
    toast.add({
      title: invoiceRequestCode ? `开票申请 ${invoiceRequestCode} 已创建` : '开票申请已创建',
      description: submitError ? '审批提交暂未完成，请到 Finance 检查。' : undefined,
      color: submitError ? 'warning' : 'success'
    })
    await refresh()
  } catch (error: unknown) {
    toast.add({ title: errorMessage(error, '开票申请失败'), color: 'error' })
  } finally {
    invoiceRequestLoading.value = false
  }
}

// 到账进度百分比
const progressPercent = computed(() => {
  if (!plan.value?.amount) return 0
  return Math.min(100, Math.round(numberValue(plan.value.received_amount) / numberValue(plan.value.amount) * 100))
})

const paymentColumns = [
  { accessorKey: 'code', header: '编号' },
  { accessorKey: 'received_amount', header: '到账金额' },
  { accessorKey: 'received_at', header: '到账日期' },
  { accessorKey: 'payer_name', header: '付款方' },
  { accessorKey: 'confirmed_by', header: '确认人' }
]

const invoiceColumns = [
  { accessorKey: 'code', header: '编号' },
  { accessorKey: 'invoice_no', header: '发票号' },
  { accessorKey: 'invoice_amount', header: '开票金额' },
  { accessorKey: 'invoice_date', header: '开票日期' },
  { accessorKey: 'status', header: '状态' }
]
</script>

<template>
  <UDashboardPanel id="payment-detail">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.push('/payments')"
        />
        <div v-if="plan" class="flex items-center gap-2">
          <span class="font-semibold">{{ plan.plan_name }}</span>
          <UBadge :color="(RP_STATUS[plan.status]?.color || 'neutral') as any" variant="subtle" size="sm">
            {{ RP_STATUS[plan.status]?.label || plan.status }}
          </UBadge>
          <span class="text-xs text-muted font-mono">{{ plan.code }}</span>
        </div>
        <USkeleton v-else class="h-6 w-48" />
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <template v-if="plan">
          <UButton
            v-if="plan.status === 'pending'"
            label="标记待开票"
            variant="soft"
            color="warning"
            @click="changeStatus('to_invoice')"
          />
          <UButton
            v-if="canRequestInvoice"
            label="开票申请"
            icon="i-lucide-file-plus-2"
            variant="soft"
            color="warning"
            :loading="invoiceRequestLoading"
            @click="requestInvoice"
          />
          <UButton
            v-if="plan.status === 'to_invoice'"
            label="标记待回款"
            variant="soft"
            color="primary"
            @click="changeStatus('to_receive')"
          />
          <UButton
            v-if="['to_receive', 'partially_received', 'overdue'].includes(plan.status)"
            label="登记到账"
            icon="i-lucide-plus"
            color="success"
            @click="openConfirm"
          />
        </template>
      </Teleport>

      <div v-if="status === 'pending'" class="p-6">
        <USkeleton class="h-64 w-full" />
      </div>

      <div v-else-if="plan" class="p-4 space-y-4">
        <!-- 回款进度 -->
        <UCard>
          <div class="flex items-center gap-8">
            <div class="flex-1">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm text-muted">回款进度</span>
                <span class="font-mono text-sm font-medium">{{ progressPercent }}%</span>
              </div>
              <div class="w-full bg-elevated rounded-full h-3">
                <div
                  class="h-3 rounded-full transition-all"
                  :class="progressPercent >= 100 ? 'bg-success' : progressPercent > 0 ? 'bg-primary' : 'bg-neutral'"
                  :style="{ width: progressPercent + '%' }"
                />
              </div>
              <div class="flex justify-between mt-2 text-xs text-muted">
                <span>已回款 {{ formatMoney(plan.received_amount) }}</span>
                <span>计划 {{ formatMoney(plan.amount) }}</span>
              </div>
            </div>
            <div class="text-right">
              <div class="text-2xl font-bold font-mono" :class="numberValue(plan.unreceived_amount) > 0 ? 'text-warning' : 'text-success'">
                {{ formatMoney(plan.unreceived_amount) }}
              </div>
              <div class="text-xs text-muted">
                未回款
              </div>
            </div>
          </div>
        </UCard>

        <!-- 基本信息 -->
        <UCard>
          <template #header>
            <span class="font-semibold text-sm">基本信息</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
            <div class="flex">
              <span class="text-muted w-28 shrink-0">客户</span><span>{{ plan.customer_name || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">合同</span>
              <NuxtLink v-if="plan.contract_id" :to="`/contracts/${plan.contract_id}`" class="text-primary hover:underline">{{ plan.contract_name }}</NuxtLink>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">计划开票日期</span><span>{{ plan.planned_invoice_date || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">计划回款日期</span><span>{{ plan.planned_payment_date || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">负责人</span><UserName :uid="plan.owner_user_id" />
            </div>
            <div class="flex">
              <span class="text-muted w-28 shrink-0">逾期天数</span><span :class="numberValue(plan.overdue_days) > 0 ? 'text-error' : ''">{{ plan.overdue_days || 0 }} 天</span>
            </div>
          </div>
        </UCard>

        <!-- 到账记录 -->
        <UCard>
          <template #header>
            <span class="font-semibold text-sm">到账记录 ({{ plan.payments?.length || 0 }})</span>
          </template>
          <UTable :data="plan.payments || []" :columns="paymentColumns">
            <template #code-cell="{ row }">
              <span class="font-mono text-xs">{{ (row.original as any).code }}</span>
            </template>
            <template #received_amount-cell="{ row }">
              <span class="font-mono text-success">{{ formatMoney((row.original as any).received_amount) }}</span>
            </template>
            <template #empty>
              <div class="text-center py-6 text-muted text-sm">
                暂无到账记录
              </div>
            </template>
          </UTable>
        </UCard>

        <!-- 发票记录 -->
        <UCard>
          <template #header>
            <span class="font-semibold text-sm">发票记录 ({{ plan.invoices?.length || 0 }})</span>
          </template>
          <UTable :data="plan.invoices || []" :columns="invoiceColumns">
            <template #invoice_amount-cell="{ row }">
              <span class="font-mono">{{ formatMoney((row.original as any).invoice_amount) }}</span>
            </template>
            <template #empty>
              <div class="text-center py-6 text-muted text-sm">
                暂无发票记录
              </div>
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <!-- 登记到账弹窗 -->
  <UModal v-model:open="showConfirmModal">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">登记到账</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="showConfirmModal = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="到账金额(元)" required>
            <UInput v-model.number="confirmForm.received_amount" type="number" class="w-full" />
          </UFormField>
          <UFormField label="到账日期" required>
            <UInput v-model="confirmForm.received_at" type="date" class="w-full" />
          </UFormField>
          <UFormField label="付款方">
            <UInput v-model="confirmForm.payer_name" placeholder="付款方名称" class="w-full" />
          </UFormField>
          <UFormField label="付款账号">
            <UInput v-model="confirmForm.bank_account" placeholder="银行账号" class="w-full" />
          </UFormField>
          <UFormField label="备注">
            <UTextarea
              v-model="confirmForm.note"
              placeholder="备注"
              :rows="2"
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
              @click="showConfirmModal = false"
            />
            <UButton
              label="确认到账"
              color="success"
              :loading="confirmLoading"
              @click="doConfirm"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
