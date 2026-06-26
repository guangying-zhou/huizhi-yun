<script setup lang="ts">
import type { ButtonProps, PricingPlanProps } from '@nuxt/ui'

definePageMeta({
  layout: 'console'
})

usePageTitle('订阅计划')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface PlanItem {
  id: number
  planCode: string
  planName: string
  planTier: string
  priceModel: string
  basePrice: number | null
  currency: string | null
  billingCycle: string | null
  description: string | null
  appCount: number
  appNames: string[]
  capabilityCount: number
  capabilityNames: string[]
}

interface CurrentSubscription {
  id: number
  subscriptionNo: string
  planCode: string
  planName: string | null
  planTier: string | null
  status: string
  source: string
  startedAt: string | null
  endedAt: string | null
  currentOrderId: number | null
}

interface PendingOrder {
  orderNo: string
  planCode: string
  planName: string | null
  status: string
  paymentMethod: string | null
  totalAmount: number | null
  currency: string | null
  placedAt: string
  paidAt: string | null
  effectiveFrom: string | null
  effectiveUntil: string | null
}

interface SubscriptionPlansResponse {
  trialDays: number
  bankTransferAccount: {
    accountName: string
    bankName: string
    accountNo: string
    remark: string
  }
  currentSubscription: CurrentSubscription | null
  pendingOrder: PendingOrder | null
  plans: PlanItem[]
}

interface FetchLikeError {
  data?: {
    message?: string
    statusMessage?: string
  }
  message?: string
}

type PaymentMethod = 'bank_transfer' | 'wechat_pay' | 'alipay'

const TIER_LABEL: Record<string, string> = {
  starter: '标准',
  standard: '标准',
  pro: '专业',
  advanced: '旗舰',
  enterprise: '企业'
}

const TIER_RANK: Record<string, number> = {
  starter: 1,
  standard: 1,
  pro: 2,
  advanced: 3,
  enterprise: 4
}

const PAYMENT_METHOD_ITEMS = [
  {
    label: '对公转账',
    value: 'bank_transfer',
    description: '提交订单后由平台管理员确认到账，确认后企业方可配置应用。'
  },
  {
    label: '微信支付',
    value: 'wechat_pay',
    description: '当前按模拟支付成功处理，后续可接入正式支付渠道。'
  },
  {
    label: '支付宝',
    value: 'alipay',
    description: '当前按模拟支付成功处理，后续可接入正式支付渠道。'
  }
]

const { currentTenantCode } = useTenantContext()
const toast = useToast()

const selectedPlan = ref<PlanItem | null>(null)
const paymentOpen = ref(false)
const paymentPending = ref(false)
const paymentMethod = ref<PaymentMethod>('bank_transfer')

const query = computed(() => ({
  tenantCode: currentTenantCode.value || undefined
}))

const { data, pending, error, refresh } = usePlatformData<ApiEnvelope<SubscriptionPlansResponse>>(
  '/api/platform/tenant-admin/subscription-plans',
  { query: () => query.value, watch: [query] }
)

await refresh()

const response = computed<SubscriptionPlansResponse | null>(() => data.value?.data || null)
const plans = computed<PlanItem[]>(() => (response.value?.plans || []) as PlanItem[])
const currentSubscription = computed<CurrentSubscription | null>(() => response.value?.currentSubscription || null)
const pendingOrder = computed<PendingOrder | null>(() => response.value?.pendingOrder || null)
const trialDays = computed(() => response.value?.trialDays || 30)
const bankTransferAccount = computed(() => response.value?.bankTransferAccount || null)

const pricingPlans = computed<PricingPlanProps[]>(() => plans.value.map((plan) => {
  const current = currentSubscription.value
  const isCurrent = current?.planCode === plan.planCode
  const isPending = pendingOrder.value?.planCode === plan.planCode
  const isStandard = isStandardPlan(plan)
  const recommendStandard = isStandard && !current
  const features = [
    `${plan.appCount} 个可用应用`,
    ...plan.appNames.slice(0, 5),
    ...plan.capabilityNames.slice(0, 3)
  ]

  return {
    title: plan.planName,
    description: plan.description || `${TIER_LABEL[plan.planTier] || plan.planTier}套餐`,
    badge: planBadge(plan, isCurrent, isPending, recommendStandard),
    price: formatPrice(plan),
    billingCycle: formatBillingCycle(plan.billingCycle),
    billingPeriod: '新订阅含30天免费试用',
    features,
    terms: trialTerms(plan),
    highlight: isCurrent || isPending || recommendStandard,
    scale: recommendStandard,
    button: {
      label: planButtonLabel(plan),
      icon: isCurrent ? (canRenew.value ? 'i-lucide-refresh-cw' : 'i-lucide-check') : isPending ? 'i-lucide-clock' : 'i-lucide-arrow-right',
      color: isCurrent && !canRenew.value ? 'neutral' as const : isPending ? 'warning' as const : 'primary' as const,
      variant: isCurrent && !canRenew.value ? 'soft' as const : 'solid' as const,
      disabled: (isCurrent && !canRenew.value) || isPending || paymentPending.value,
      onClick: () => openPayment(plan)
    }
  }
}))

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  active: '使用中',
  trialing: '试用中',
  trial: '试用中',
  grace: '宽限期',
  expired: '已过期',
  cancelled: '已取消',
  canceled: '已取消',
  suspended: '已暂停',
  pending: '待生效'
}

function subscriptionStatusLabel(status: string | null | undefined) {
  if (!status) return ''
  return SUBSCRIPTION_STATUS_LABEL[status] || status
}

const summaryItems = computed(() => [
  {
    label: '当前套餐',
    value: currentSubscription.value?.planName || currentSubscription.value?.planCode || '未订阅',
    detail: subscriptionStatusLabel(currentSubscription.value?.status) || '请选择一个套餐开始试用'
  },
  {
    label: '试用/订阅到期',
    value: currentSubscription.value?.endedAt ? formatDate(currentSubscription.value.endedAt) : '未开始',
    detail: currentSubscription.value?.startedAt ? `${formatDate(currentSubscription.value.startedAt)} 起` : `${trialDays.value}天免费试用`
  },
  {
    label: '待处理订单',
    value: pendingOrder.value?.orderNo || '无',
    detail: pendingOrder.value ? `${pendingOrder.value.planName || pendingOrder.value.planCode} · 待确认到账` : '对公转账订单会在这里显示'
  }
])

const fetchErrorMessage = computed(() => errorMessage(error.value, '订阅计划加载失败'))
const selectedPlanTrialEnd = computed(() => addDays(new Date(), trialDays.value))

const subscriptionExpiry = computed(() => {
  const ended = currentSubscription.value?.endedAt
  if (!ended) return null
  const endDate = new Date(ended)
  if (Number.isNaN(endDate.getTime())) return null
  const days = Math.ceil((endDate.getTime() - Date.now()) / 86400000)
  if (days < 0) {
    return { color: 'error' as const, title: '订阅已到期', description: `已于 ${formatDate(ended)} 到期，请尽快续订以恢复服务。` }
  }
  if (days <= 7) {
    return { color: 'error' as const, title: `订阅将在 ${days} 天后到期`, description: `到期日 ${formatDate(ended)}，请尽快续订，避免影响企业正常使用。` }
  }
  if (days <= 30) {
    return { color: 'warning' as const, title: `订阅将在 ${days} 天后到期`, description: `到期日 ${formatDate(ended)}，建议提前安排续订。` }
  }
  return null
})

const canRenew = computed(() => Boolean(currentSubscription.value && !pendingOrder.value && currentPlan()))

const pendingPlanItem = computed(() => {
  const code = pendingOrder.value?.planCode
  return code ? plans.value.find(plan => plan.planCode === code) || null : null
})

const paymentReminderActions = computed<ButtonProps[]>(() => {
  const plan = pendingPlanItem.value
  if (!plan) return []
  return [{
    label: '查看付款信息',
    color: 'warning' as const,
    variant: 'solid' as const,
    onClick: () => openPayment(plan)
  }]
})

const renewAlertActions = computed<ButtonProps[]>(() => {
  const plan = currentPlan()
  if (!plan) return []
  return [{
    label: '立即续订',
    color: subscriptionExpiry.value?.color || 'primary',
    variant: 'solid' as const,
    onClick: () => openPayment(plan)
  }]
})

function errorMessage(errorValue: unknown, fallback: string) {
  const err = errorValue as FetchLikeError | null
  return err?.data?.message || err?.data?.statusMessage || err?.message || fallback
}

function formatPrice(plan: PlanItem) {
  if (plan.basePrice === null || plan.basePrice === undefined || Number(plan.basePrice) === 0) {
    return '面议'
  }

  const currency = plan.currency === 'CNY' || !plan.currency ? '¥' : `${plan.currency} `
  return `${currency}${Number(plan.basePrice).toLocaleString()}`
}

function formatBillingCycle(cycle: string | null) {
  if (cycle === 'annual') return '/年'
  if (cycle === 'monthly') return '/月'
  return cycle ? `/${cycle}` : ''
}

function formatDate(value: string | Date | null) {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function planRank(plan: PlanItem | null | undefined) {
  return plan ? TIER_RANK[plan.planTier] || 0 : 0
}

function currentPlan() {
  const code = currentSubscription.value?.planCode
  return code ? plans.value.find(plan => plan.planCode === code) || null : null
}

function isStandardPlan(plan: PlanItem) {
  const code = plan.planCode.toLowerCase()
  const tier = plan.planTier.toLowerCase()
  return code === 'standard' || tier === 'standard'
}

function planBadge(
  plan: PlanItem,
  isCurrent: boolean,
  isPending: boolean,
  isStandard: boolean
): PricingPlanProps['badge'] {
  if (isCurrent) {
    return { label: '当前订阅', color: 'success', variant: 'subtle' }
  }

  if (isPending) {
    return { label: '待确认到账', color: 'warning', variant: 'subtle' }
  }

  if (isStandard) {
    return { label: '推荐', color: 'primary', variant: 'subtle' }
  }

  return TIER_LABEL[plan.planTier] || plan.planTier
}

function planButtonLabel(plan: PlanItem) {
  if (currentSubscription.value?.planCode === plan.planCode) {
    return canRenew.value ? '续订' : '当前套餐'
  }
  if (pendingOrder.value?.planCode === plan.planCode) return '等待确认'
  if (!currentSubscription.value) return '开始试用'

  return planRank(plan) >= planRank(currentPlan()) ? '升级' : '降级'
}

function trialTerms(plan: PlanItem) {
  if (currentSubscription.value?.planCode === plan.planCode && currentSubscription.value?.endedAt) {
    return `当前订阅到期日：${formatDate(currentSubscription.value.endedAt)}`
  }

  if (pendingOrder.value?.planCode === plan.planCode) {
    return '对公转账到账确认后开始30天试用'
  }

  return `新订阅预计试用至 ${formatDate(selectedPlanTrialEnd.value)}`
}

function openPayment(plan: PlanItem) {
  selectedPlan.value = plan
  paymentMethod.value = 'bank_transfer'
  paymentOpen.value = true
}

async function submitSubscription() {
  if (!selectedPlan.value || !currentTenantCode.value) {
    return
  }

  paymentPending.value = true
  try {
    const response = await platformFetchJson<ApiEnvelope<{ order: { orderNo: string, activationRequired: boolean }, subscription: { status: string } }>>(
      '/api/platform/tenant-admin/subscription-plans/subscribe',
      {
        method: 'POST',
        query: {
          tenantCode: currentTenantCode.value
        },
        body: {
          planCode: selectedPlan.value.planCode,
          paymentMethod: paymentMethod.value
        }
      }
    )

    paymentOpen.value = false
    toast.add({
      title: response.data.order.activationRequired ? '订单已提交' : '订阅已生效',
      description: response.data.order.activationRequired
        ? `订单 ${response.data.order.orderNo} 等待平台确认到账。`
        : `${selectedPlan.value.planName} 已进入试用期。`,
      color: response.data.order.activationRequired ? 'warning' : 'success'
    })
    await refresh()
  } catch (caught) {
    toast.add({
      title: '订阅失败',
      description: errorMessage(caught, '请稍后重试'),
      color: 'error'
    })
  } finally {
    paymentPending.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="tenant-subscription-plans"
    :ui="{ body: 'console-page' }"
  >
    <template #body>
      <div class="col gap-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <h1 class="text-xl font-semibold text-highlighted">
              订阅计划
            </h1>
            <p class="mt-1 text-sm text-muted">
              选择或调整企业套餐。新订阅提供30天免费试用，试用到期日会随订阅状态展示。
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="pending"
              @click="() => refresh()"
            >
              刷新
            </UButton>
          </div>
        </div>

        <UAlert
          v-if="!currentTenantCode"
          color="warning"
          variant="soft"
          title="请先选择企业"
          description="订阅计划需要企业上下文，先在左侧顶部企业菜单中选择一个企业。"
        />

        <UAlert
          v-else-if="error"
          color="error"
          variant="soft"
          :title="fetchErrorMessage"
        />

        <UAlert
          v-if="pendingOrder"
          color="warning"
          variant="soft"
          icon="i-lucide-clock"
          title="订阅待付款确认"
          :description="`请在 30 天内完成对公转账付款，平台确认到账后正式生效；逾期未付款订阅将被关闭。订单号 ${pendingOrder.orderNo}`"
          :actions="paymentReminderActions"
        />

        <UAlert
          v-if="subscriptionExpiry"
          :color="subscriptionExpiry.color"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :title="subscriptionExpiry.title"
          :description="subscriptionExpiry.description"
          :actions="renewAlertActions"
        />

        <div class="grid gap-3 md:grid-cols-3">
          <UCard
            v-for="item in summaryItems"
            :key="item.label"
            :ui="{ body: 'p-4 sm:p-4' }"
          >
            <div class="text-xs font-medium text-muted">
              {{ item.label }}
            </div>
            <div class="mt-2 truncate text-lg font-semibold text-highlighted">
              {{ item.value }}
            </div>
            <div class="mt-1 text-xs text-muted">
              {{ item.detail }}
            </div>
          </UCard>
        </div>

        <UPricingPlans
          v-if="pricingPlans.length > 0"
          :plans="pricingPlans"
          scale
          class="items-stretch"
        />

        <UEmpty
          v-else-if="!pending"
          icon="i-lucide-package-open"
          title="暂无可订阅套餐"
          description="平台还没有发布 active 状态的订阅计划。"
          class="py-16"
        />

        <UModal
          v-model:open="paymentOpen"
          :title="selectedPlan ? `${currentSubscription?.planCode === selectedPlan.planCode ? '续订' : '订阅'} ${selectedPlan.planName}` : '订阅套餐'"
          :ui="{ content: 'max-w-xl', footer: 'flex justify-end gap-2' }"
        >
          <template #body>
            <div
              v-if="selectedPlan"
              class="space-y-4"
            >
              <div class="rounded-lg border border-default bg-muted/30 p-4">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <div class="text-sm font-semibold text-highlighted">
                      {{ selectedPlan.planName }}
                    </div>
                    <div class="mt-1 text-sm text-muted">
                      {{ selectedPlan.description || selectedPlan.planCode }}
                    </div>
                  </div>
                  <UBadge
                    color="primary"
                    variant="soft"
                  >
                    30天试用
                  </UBadge>
                </div>
                <div class="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
                  <div>试用期限：{{ trialDays }} 天</div>
                  <div>预计到期：{{ formatDate(selectedPlanTrialEnd) }}</div>
                </div>
              </div>

              <UFormField
                label="支付方式"
                required
              >
                <URadioGroup
                  v-model="paymentMethod"
                  :items="PAYMENT_METHOD_ITEMS"
                  variant="card"
                />
              </UFormField>

              <div
                v-if="paymentMethod === 'bank_transfer' && bankTransferAccount"
                class="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm"
              >
                <div class="font-medium text-highlighted">
                  对公转账收款信息
                </div>
                <dl class="mt-3 grid gap-2 text-muted">
                  <div class="flex justify-between gap-4">
                    <dt>户名</dt>
                    <dd class="font-medium text-highlighted">
                      {{ bankTransferAccount.accountName }}
                    </dd>
                  </div>
                  <div class="flex justify-between gap-4">
                    <dt>开户行</dt>
                    <dd class="font-medium text-highlighted">
                      {{ bankTransferAccount.bankName }}
                    </dd>
                  </div>
                  <div class="flex justify-between gap-4">
                    <dt>账号</dt>
                    <dd class="font-mono text-highlighted">
                      {{ bankTransferAccount.accountNo }}
                    </dd>
                  </div>
                  <div class="flex justify-between gap-4">
                    <dt>备注</dt>
                    <dd class="text-right text-highlighted">
                      {{ bankTransferAccount.remark }}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </template>

          <template #footer>
            <UButton
              color="neutral"
              variant="ghost"
              @click="paymentOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="primary"
              :loading="paymentPending"
              @click="submitSubscription"
            >
              确认订阅
            </UButton>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
