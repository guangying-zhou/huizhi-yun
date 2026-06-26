<script setup lang="ts">
interface HomeSummary {
  opportunity?: {
    pipeline_amount?: number | null
  }
  contract?: {
    month_amount?: number | null
  }
  receivable?: {
    month_received?: number | null
    overdue_amount?: number | null
  }
}

interface HomeOpportunity {
  id: number | string
  name: string
  customer_name?: string | null
  stage_name?: string | null
  amount_tax_inclusive?: number | null
  owner_user_id?: string | null
}

interface HomePayment {
  id: number | string
  customer_name?: string | null
  plan_name?: string | null
  planned_payment_date?: string | null
  unreceived_amount?: number | null
}

interface HomePaymentReminder {
  upcoming?: HomePayment[]
  overdue_list?: HomePayment[]
}

const router = useRouter()
const { user: authUser } = useAuth()
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
const displayName = computed(() => {
  const realname = useCookie('auth_realname').value
  return realname || authUser.value || '用户'
})

onMounted(() => {
  void loadPermissions()
})

const canViewDashboard = computed(() => permissionsLoaded.value && hasPermission('dashboard', 'view'))
const canViewOpportunity = computed(() => permissionsLoaded.value && hasPermission('opportunity', 'view'))
const canViewReceivable = computed(() => permissionsLoaded.value && hasPermission('receivable', 'view'))
const canCreateLead = computed(() => permissionsLoaded.value && hasPermission('lead', 'edit'))
const canCreateCustomer = computed(() => permissionsLoaded.value && hasPermission('customer', 'edit'))
const canCreateOpportunity = computed(() => permissionsLoaded.value && hasPermission('opportunity', 'edit'))

function responseData<T>(res: unknown) {
  return (res as { data?: T }).data
}

function responseItems<T>(res: unknown) {
  return responseData<{ items?: T[] }>(res)?.items || []
}

function responsePaymentReminder(res: unknown): HomePaymentReminder {
  const data = responseData<HomePaymentReminder>(res)
  return {
    upcoming: data?.upcoming || [],
    overdue_list: data?.overdue_list || []
  }
}

// 加载看板摘要
const { data: summary, execute: loadSummary } = useFetch('/api/v1/dashboard/summary', {
  server: false,
  immediate: false,
  transform: (res: unknown) => responseData<HomeSummary>(res) || null,
  default: () => null
})

// 最近更新的商机
const { data: activeOpps, execute: loadActiveOpps } = useFetch('/api/v1/opportunities', {
  server: false,
  immediate: false,
  query: { status: 'active', pageSize: 5, sort: 'updated_at', order: 'desc' },
  transform: (res: unknown) => responseItems<HomeOpportunity>(res),
  default: () => [] as HomeOpportunity[]
})

// 回款提醒依赖看板聚合接口，需要 dashboard:view。
const { data: receivableReminder, execute: loadReceivableReminder } = useFetch('/api/v1/dashboard/receivables', {
  server: false,
  immediate: false,
  transform: (res: unknown) => responsePaymentReminder(res),
  default: () => ({ upcoming: [], overdue_list: [] })
})

const upcomingPayments = computed(() => receivableReminder.value?.upcoming?.slice(0, 5) || [])
const overduePayments = computed(() => receivableReminder.value?.overdue_list?.slice(0, 5) || [])

watch(canViewDashboard, (allowed) => {
  if (!allowed) {
    summary.value = null
    receivableReminder.value = { upcoming: [], overdue_list: [] }
    return
  }

  void loadSummary()
  void loadReceivableReminder()
}, { immediate: true })

watch(canViewOpportunity, (allowed) => {
  if (!allowed) {
    activeOpps.value = []
    return
  }

  void loadActiveOpps()
}, { immediate: true })

function emptyOpportunityText() {
  if (!permissionsLoaded.value) return '加载中...'
  return canViewOpportunity.value ? '暂无商机' : '暂无可查看商机'
}

function emptyPaymentText() {
  if (!permissionsLoaded.value) return '加载中...'
  return canViewDashboard.value ? '暂无回款提醒' : '暂无可查看回款提醒'
}

function formatMoney(val: number | null | undefined) {
  if (val == null || val === 0) return '--'
  if (val >= 10000) return (val / 10000).toFixed(1) + '万'
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0 }).format(val)
}

function formatFullMoney(val: number | null | undefined) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 }).format(val)
}
</script>

<template>
  <UDashboardPanel id="home" :ui="{ body: 'sm:gap-3 sm:p-2 m-0' }">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          汇智云经营
        </h1>
      </Teleport>

      <div class="p-4 space-y-4">
        <div class="flex items-center justify-between">
          <div class="text-lg font-semibold">
            你好，{{ displayName }}
          </div>
          <div class="flex items-center gap-2">
            <UButton
              v-if="canCreateLead"
              variant="soft"
              color="primary"
              icon="i-lucide-target"
              label="新建线索"
              size="sm"
              @click="router.push('/leads/new')"
            />
            <UButton
              v-if="canCreateCustomer"
              variant="soft"
              color="primary"
              icon="i-lucide-building-2"
              label="新建客户"
              size="sm"
              @click="router.push('/customers/new')"
            />
            <UButton
              v-if="canCreateOpportunity"
              variant="soft"
              color="primary"
              icon="i-lucide-trending-up"
              label="新建商机"
              size="sm"
              @click="router.push('/opportunities/new')"
            />
            <UButton
              v-if="canViewDashboard"
              variant="soft"
              color="neutral"
              icon="i-lucide-layout-dashboard"
              label="经营看板"
              size="sm"
              @click="router.push('/dashboard')"
            />
          </div>
        </div>

        <!-- 经营概览 KPI -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <UCard class="cursor-pointer hover:border-primary transition-colors" @click="router.push('/opportunities')">
            <div class="text-center">
              <div class="text-2xl font-bold font-[Geist] tabular-nums">
                {{ formatMoney(summary?.opportunity?.pipeline_amount) }}
              </div>
              <div class="text-xs text-muted mt-1">
                管线金额
              </div>
            </div>
          </UCard>
          <UCard class="cursor-pointer hover:border-primary transition-colors" @click="router.push('/contracts')">
            <div class="text-center">
              <div class="text-2xl font-bold font-[Geist] tabular-nums">
                {{ formatMoney(summary?.contract?.month_amount) }}
              </div>
              <div class="text-xs text-muted mt-1">
                本月合同额
              </div>
            </div>
          </UCard>
          <UCard class="cursor-pointer hover:border-primary transition-colors" @click="router.push('/payments')">
            <div class="text-center">
              <div class="text-2xl font-bold font-[Geist] tabular-nums text-success">
                {{ formatMoney(summary?.receivable?.month_received) }}
              </div>
              <div class="text-xs text-muted mt-1">
                本月回款额
              </div>
            </div>
          </UCard>
          <UCard
            class="cursor-pointer hover:border-primary transition-colors"
            @click="router.push('/payments?status=overdue')"
          >
            <div class="text-center">
              <div
                class="text-2xl font-bold font-[Geist] tabular-nums"
                :class="(summary?.receivable?.overdue_amount || 0) > 0 ? 'text-error' : ''"
              >
                {{ formatMoney(summary?.receivable?.overdue_amount) }}
              </div>
              <div class="text-xs text-muted mt-1">
                逾期应收
              </div>
            </div>
          </UCard>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- 我的商机 -->
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-semibold text-sm">最近更新的商机</span>
                <NuxtLink v-if="canViewOpportunity" to="/opportunities" class="text-xs text-primary hover:underline">查看全部</NuxtLink>
              </div>
            </template>
            <div v-if="activeOpps?.length" class="divide-y divide-default">
              <NuxtLink
                v-for="opp in activeOpps"
                :key="opp.id"
                :to="`/opportunities/${opp.id}`"
                class="flex items-center justify-between py-2.5 hover:bg-elevated/50 -mx-4 px-4 transition-colors"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-sm truncate">{{ opp.name }}</div>
                  <div class="text-xs text-muted">{{ opp.customer_name }} · {{ opp.stage_name }}</div>
                </div>
                <div class="text-right ml-3 shrink-0">
                  <div class="font-mono text-sm">{{ formatFullMoney(opp.amount_tax_inclusive) }}</div>
                  <div class="text-xs text-muted"><UserName :uid="opp.owner_user_id" /></div>
                </div>
              </NuxtLink>
            </div>
            <div v-else class="text-center py-6 text-muted text-sm">
              <p>{{ emptyOpportunityText() }}</p>
              <NuxtLink v-if="canCreateOpportunity" to="/opportunities/new" class="text-primary hover:underline text-xs mt-1 inline-block">创建第一个商机</NuxtLink>
            </div>
          </UCard>

          <!-- 回款提醒 -->
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-semibold text-sm">回款提醒</span>
                <NuxtLink v-if="canViewReceivable" to="/payments" class="text-xs text-primary hover:underline">查看全部</NuxtLink>
              </div>
            </template>
            <!-- 逾期 -->
            <div v-if="overduePayments?.length" class="mb-3">
              <div class="text-xs text-error font-medium mb-1">
                已逾期
              </div>
              <div class="space-y-1">
                <div
                  v-for="item in overduePayments"
                  :key="item.id"
                  class="flex items-center justify-between py-1.5 cursor-pointer hover:bg-elevated/50 -mx-4 px-4 rounded transition-colors"
                  @click="router.push(`/payments/${item.id}`)"
                >
                  <div class="min-w-0 flex-1">
                    <div class="text-sm truncate">
                      {{ item.customer_name }}
                    </div>
                    <div class="text-xs text-muted">
                      {{ item.plan_name }}
                    </div>
                  </div>
                  <div class="text-right ml-3 shrink-0">
                    <div class="font-mono text-xs text-error">
                      {{ formatFullMoney(item.unreceived_amount) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <!-- 即将到期 -->
            <div v-if="upcomingPayments?.length">
              <div class="text-xs text-warning font-medium mb-1">
                未来30天到期
              </div>
              <div class="space-y-1">
                <div
                  v-for="item in upcomingPayments"
                  :key="item.id"
                  class="flex items-center justify-between py-1.5 cursor-pointer hover:bg-elevated/50 -mx-4 px-4 rounded transition-colors"
                  @click="router.push(`/payments/${item.id}`)"
                >
                  <div class="min-w-0 flex-1">
                    <div class="text-sm truncate">
                      {{ item.customer_name }}
                    </div>
                    <div class="text-xs text-muted">
                      {{ item.plan_name }} · {{ item.planned_payment_date }}
                    </div>
                  </div>
                  <div class="text-right ml-3 shrink-0">
                    <div class="font-mono text-xs">
                      {{ formatFullMoney(item.unreceived_amount) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-if="!overduePayments?.length && !upcomingPayments?.length" class="text-center py-6 text-muted text-sm">
              {{ emptyPaymentText() }}
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
