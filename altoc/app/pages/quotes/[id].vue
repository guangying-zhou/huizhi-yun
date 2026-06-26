<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const toast = useToast()
const id = computed(() => route.params.id)
const idNum = computed(() => Number(id.value) || 0)

type QuoteStatusColor = 'neutral' | 'warning' | 'primary' | 'error' | 'info' | 'success'

interface QuoteItem {
  item_name: string
  specification: string | null
  unit: string | null
  quantity: number | string | null
  unit_price: number | string | null
  amount_tax_inclusive: number | string | null
}

interface QuoteDetail {
  code: string
  status: string
  version_no: number | string | null
  customer_id: number | string
  customer_name: string | null
  opportunity_id: number | string | null
  opportunity_name: string | null
  amount_tax_inclusive: number | string | null
  discount_rate: number | string | null
  gross_margin_rate: number | string | null
  valid_until: string | null
  tax_rate: number | string | null
  owner_user_id: string | null
  created_at: string | null
  reject_reason: string | null
  items?: QuoteItem[]
}

interface ApiResponse<T> {
  data: T
}

interface ContractCreateResponse {
  id?: number | string
  contract?: { id?: number | string }
}

const QUOTE_STATUS: Record<string, { label: string, color: QuoteStatusColor }> = {
  draft: { label: '草稿', color: 'neutral' },
  pending_approval: { label: '待审批', color: 'warning' },
  approved: { label: '已批准', color: 'primary' },
  rejected: { label: '已驳回', color: 'error' },
  sent: { label: '已发送', color: 'info' },
  accepted: { label: '已接受', color: 'success' },
  expired: { label: '已失效', color: 'neutral' },
  voided: { label: '已作废', color: 'neutral' }
}

const { data: quot, status, refresh } = useFetch(() => `/api/v1/quotes/${id.value}`, {
  transform: (res: unknown) => (res as ApiResponse<QuoteDetail>).data
})
const convertingToContract = ref(false)

// 审批模式（从审批中心跳转过来时为 true，隐藏编辑按钮）
const { isApprovalMode } = useApprovalMode()

function errorMessage(error: unknown, fallback: string) {
  const source = error && typeof error === 'object'
    ? error as { data?: { message?: string, statusMessage?: string }, message?: string }
    : {}
  return source.data?.message || source.data?.statusMessage || source.message || fallback
}

function formatMoney(val: number | string | null | undefined) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 }).format(Number(val) || 0)
}

// ========================
// 平台审批流程（usePageWorkflow 单动作模式）
// ========================
// 报价审批的完整性检查：必须有明细、有金额
const approvalIssues = computed<string[]>(() => {
  const issues: string[] = []
  if (!quot.value) return issues
  if (!quot.value.amount_tax_inclusive || Number(quot.value.amount_tax_inclusive) <= 0) {
    issues.push('报价金额必须大于 0')
  }
  if (!quot.value.items || quot.value.items.length === 0) {
    issues.push('请至少添加一条报价明细')
  }
  if (!quot.value.valid_until) {
    issues.push('请填写有效期')
  }
  return issues
})

const canSubmitApproval = computed(() => {
  return !!quot.value && ['draft', 'rejected'].includes(quot.value.status) && approvalIssues.value.length === 0
})

function quoteStatusCommand(action: 'submit' | 'send' | 'accept') {
  return $fetch(`/api/v1/quotes/${id.value}/status` as string, {
    method: 'POST',
    body: { action }
  })
}

function quoteApprovalCommand(action: 'approve' | 'reject') {
  return $fetch(`/api/v1/quotes/${id.value}/approve` as string, {
    method: 'POST',
    body: { action }
  })
}

const workflowActions = computed(() => {
  if (!quot.value) return []
  // 仅在 draft 状态下展示"提交审批"动作
  // pending_approval / approved / rejected 状态由 WorkflowPanel 自动检测已有实例并展示
  if (quot.value.status === 'draft' || quot.value.status === 'rejected') {
    return [{
      actionCode: 'approve',
      actionName: '报价审批',
      icon: 'i-lucide-file-check',
      canSubmit: canSubmitApproval,
      completenessIssues: approvalIssues,
      async onSubmitted() {
        await quoteStatusCommand('submit')
        toast.add({ title: '已提交审批', color: 'success' })
        await refresh()
      },
      async onApproved() {
        await quoteApprovalCommand('approve')
        toast.add({ title: '审批通过', color: 'success' })
        await refresh()
      },
      async onRejected() {
        await quoteApprovalCommand('reject')
        toast.add({ title: '审批已驳回，可修改后重新提交', color: 'warning' })
        await refresh()
      }
    }]
  }
  return []
})

usePageWorkflow({
  appCode: 'altoc',
  resourceCode: 'quotation',
  bizId: computed(() => idNum.value ? String(idNum.value) : ''),
  bizTitle: computed(() => quot.value ? `${quot.value.code} ${quot.value.customer_name || ''}` : ''),
  bizUrl: computed(() => {
    if (!quot.value || !import.meta.client) return ''
    return `${window.location.origin}/quotes/${idNum.value}`
  }),
  actions: workflowActions
})

// 业务流转（非审批）按钮
async function markSent() {
  try {
    await quoteStatusCommand('send')
    toast.add({ title: '已标记发送', color: 'success' })
    refresh()
  } catch { toast.add({ title: '操作失败', color: 'error' }) }
}

async function markAccepted() {
  try {
    await quoteStatusCommand('accept')
    toast.add({ title: '已标记接受', color: 'success' })
    refresh()
  } catch { toast.add({ title: '操作失败', color: 'error' }) }
}

async function convertToContract() {
  if (!quot.value || convertingToContract.value) return
  convertingToContract.value = true
  try {
    const res = await $fetch<unknown>('/api/v1/contracts/from-quotation', {
      method: 'POST',
      body: {
        quotation_id: idNum.value,
        name: `${quot.value.code} 合同`,
        template_code: 'sales_software_license'
      }
    })
    const created = (res as ApiResponse<ContractCreateResponse>).data || (res as ContractCreateResponse)
    const contractId = created.id || created.contract?.id
    if (!contractId) {
      throw new Error('合同创建成功但未返回合同ID')
    }
    toast.add({ title: '已转为合同', color: 'success' })
    router.push(`/contracts/${contractId}`)
  } catch (err) {
    toast.add({ title: errorMessage(err, '转合同失败'), color: 'error' })
  } finally {
    convertingToContract.value = false
  }
}

const itemColumns = [
  { accessorKey: 'item_name', header: '名称' },
  { accessorKey: 'specification', header: '规格' },
  { accessorKey: 'unit', header: '单位' },
  { accessorKey: 'quantity', header: '数量' },
  { accessorKey: 'unit_price', header: '单价' },
  { accessorKey: 'amount_tax_inclusive', header: '小计' }
]
</script>

<template>
  <UDashboardPanel id="quote-detail">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.push('/quotes')"
        />
        <div v-if="quot" class="flex items-center gap-2">
          <span class="font-semibold">报价 {{ quot.code }}</span>
          <UBadge :color="QUOTE_STATUS[quot.status]?.color || 'neutral'" variant="subtle" size="sm">
            {{ QUOTE_STATUS[quot.status]?.label || quot.status }}
          </UBadge>
          <span class="text-xs text-muted">v{{ quot.version_no }}</span>
        </div>
        <USkeleton v-else class="h-6 w-48" />
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <template v-if="quot && !isApprovalMode">
          <!-- 仅保留非审批的业务流转按钮；提交审批/通过/驳回 由右侧 WorkflowPanel 驱动 -->
          <UButton
            v-if="quot.status === 'approved'"
            label="标记发送"
            icon="i-lucide-mail"
            variant="soft"
            color="primary"
            @click="markSent"
          />
          <UButton
            v-if="quot.status === 'sent'"
            label="客户已接受"
            icon="i-lucide-check-circle"
            color="success"
            @click="markAccepted"
          />
          <UButton
            v-if="quot.status === 'accepted'"
            label="转为合同"
            icon="i-lucide-file-signature"
            color="primary"
            :loading="convertingToContract"
            @click="convertToContract"
          />
        </template>
      </Teleport>

      <div v-if="status === 'pending'" class="p-6">
        <USkeleton class="h-64 w-full" />
      </div>

      <div v-else-if="quot" class="flex h-full min-h-0">
        <!-- 主内容区 -->
        <div class="flex-1 overflow-y-auto p-4 space-y-4 min-w-0">
          <!-- 摘要 -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <UCard>
              <div class="text-center">
                <div class="text-xl font-bold font-mono">
                  {{ formatMoney(quot.amount_tax_inclusive) }}
                </div>
                <div class="text-xs text-muted mt-1">
                  报价金额(含税)
                </div>
              </div>
            </UCard>
            <UCard>
              <div class="text-center">
                <div class="text-xl font-bold font-mono">
                  {{ quot.discount_rate ?? '--' }}%
                </div>
                <div class="text-xs text-muted mt-1">
                  折扣率
                </div>
              </div>
            </UCard>
            <UCard>
              <div class="text-center">
                <div class="text-xl font-bold font-mono">
                  {{ quot.gross_margin_rate ?? '--' }}%
                </div>
                <div class="text-xs text-muted mt-1">
                  毛利率
                </div>
              </div>
            </UCard>
            <UCard>
              <div class="text-center">
                <div class="text-xl font-bold text-sm">
                  {{ quot.valid_until || '--' }}
                </div>
                <div class="text-xs text-muted mt-1">
                  有效期至
                </div>
              </div>
            </UCard>
          </div>

          <!-- 基本信息 -->
          <UCard>
            <template #header>
              <span class="font-semibold text-sm">基本信息</span>
            </template>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
              <div class="flex">
                <span class="text-muted w-24 shrink-0">客户</span>
                <NuxtLink :to="`/customers/${quot.customer_id}`" class="text-primary hover:underline">{{ quot.customer_name }}</NuxtLink>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">商机</span>
                <NuxtLink v-if="quot.opportunity_id" :to="`/opportunities/${quot.opportunity_id}`" class="text-primary hover:underline">{{ quot.opportunity_name }}</NuxtLink>
                <span v-else>-</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">税率</span><span>{{ quot.tax_rate }}%</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">负责人</span><UserName :uid="quot.owner_user_id" />
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">创建时间</span><span class="text-xs">{{ quot.created_at }}</span>
              </div>
              <div v-if="quot.reject_reason" class="flex md:col-span-2">
                <span class="text-muted w-24 shrink-0">驳回原因</span><span class="text-error">{{ quot.reject_reason }}</span>
              </div>
            </div>
          </UCard>

          <!-- 报价明细 -->
          <UCard>
            <template #header>
              <span class="font-semibold text-sm">报价明细 ({{ quot.items?.length || 0 }})</span>
            </template>
            <UTable :data="quot.items || []" :columns="itemColumns">
              <template #quantity-cell="{ row }">
                <span class="font-mono">{{ row.original.quantity }}</span>
              </template>
              <template #unit_price-cell="{ row }">
                <span class="font-mono">{{ formatMoney(row.original.unit_price) }}</span>
              </template>
              <template #amount_tax_inclusive-cell="{ row }">
                <span class="font-mono font-medium">{{ formatMoney(row.original.amount_tax_inclusive) }}</span>
              </template>
              <template #empty>
                <div class="text-center py-6 text-muted text-sm">
                  暂无明细
                </div>
              </template>
            </UTable>
          </UCard>

          <!-- 关联文档 -->
          <DocumentsPanel entity-type="quotation" :entity-id="Number(id)" />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
