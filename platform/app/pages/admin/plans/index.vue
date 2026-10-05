<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({
  layout: 'platform'
})

usePageTitle('订阅计划')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface PlanRow {
  id: number
  planCode: string
  planName: string
  planTier: string
  priceModel: string
  basePrice: number | null
  currency: string | null
  billingCycle: string | null
  description: string | null
  status: string
  appCount: number
  capabilityCount: number
  activeSubscriberCount: number
  createdAt: string
  updatedAt: string
}

interface PlanListResponse {
  items: PlanRow[]
  total: number
  page: number
  pageSize: number
}

const TIER_TONE: Record<string, 'neutral' | 'info' | 'primary' | 'warning'> = {
  starter: 'neutral',
  standard: 'info',
  advanced: 'primary',
  enterprise: 'warning'
}

const TIER_LABEL: Record<string, string> = {
  starter: '基础（Starter）',
  standard: '标准（Standard）',
  advanced: '高级（Advanced）',
  enterprise: '企业（Enterprise · 全站独立部署）'
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  suspended: 'warning',
  disabled: 'neutral',
  draft: 'neutral'
}

const router = useRouter()
const toast = useToast()

const q = ref('')
const tier = ref<string>('all')
const status = ref<string>('all')
const page = ref(1)
const pageSize = 20

const tierItems = [
  { label: '档位：全部', value: 'all' },
  { label: '基础 Starter', value: 'starter' },
  { label: '标准 Standard', value: 'standard' },
  { label: '高级 Advanced', value: 'advanced' },
  { label: '企业 Enterprise', value: 'enterprise' }
]

const statusItems = [
  { label: '状态：全部', value: 'all' },
  { label: 'active', value: 'active' },
  { label: 'suspended', value: 'suspended' },
  { label: 'disabled', value: 'disabled' },
  { label: 'draft', value: 'draft' }
]

const listQuery = computed(() => ({
  keyword: q.value || undefined,
  tier: tier.value === 'all' ? undefined : tier.value,
  status: status.value === 'all' ? undefined : status.value,
  page: page.value,
  pageSize
}))

const { data, pending, error, refresh } = usePlatformData<ApiEnvelope<PlanListResponse>>(
  '/api/platform/ops/plans',
  { query: () => listQuery.value, watch: [listQuery] }
)

await refresh()

const rows = computed<PlanRow[]>(() => (data.value?.data.items || []) as PlanRow[])
const total = computed(() => data.value?.data.total || 0)

const columns: TableColumn<PlanRow>[] = [
  { accessorKey: 'plan', header: '计划' },
  { accessorKey: 'planTier', header: '档位' },
  { accessorKey: 'priceModel', header: '计费' },
  { accessorKey: 'appCount', header: '应用', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'capabilityCount', header: '能力', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'activeSubscriberCount', header: '活跃租户', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'status', header: '状态' },
  { id: 'actions', header: '', meta: { class: { th: 'w-10', td: 'w-10 text-right' } } }
]

watch([q, tier, status], () => {
  page.value = 1
})

function clearFilters() {
  q.value = ''
  tier.value = 'all'
  status.value = 'all'
}

function go(planCode: string) {
  router.push(`/admin/plans/${encodeURIComponent(planCode)}`)
}

function selectRow(_event: Event, row: { original: PlanRow }) {
  go(row.original.planCode)
}

function rowMenuItems(plan: PlanRow) {
  return [[
    { label: '查看详情', icon: 'i-lucide-panel-right-open', onSelect: () => go(plan.planCode) },
    { label: '编辑', icon: 'i-lucide-pencil', onSelect: () => go(plan.planCode) },
    { label: '复制 code', icon: 'i-lucide-copy', onSelect: () => copyCode(plan.planCode) }
  ]]
}

function copyCode(code: string) {
  navigator.clipboard?.writeText(code)
  toast.add({ title: '已复制', description: code, color: 'success' })
}

function formatPrice(plan: PlanRow) {
  if (plan.basePrice === null || plan.basePrice === undefined) return '面议'
  const currency = plan.currency || 'CNY'
  const cycle = plan.billingCycle ? ` / ${plan.billingCycle}` : ''
  return `${currency} ${plan.basePrice.toLocaleString()}${cycle}`
}

const fetchErrorMessage = computed(() => {
  const err = error.value as { data?: { message?: string }, message?: string } | null
  return err?.data?.message || err?.message || '订阅计划加载失败'
})
</script>

<template>
  <div>
    <div class="page-h">
      <div>
        <h1>订阅计划</h1>
        <p>管理 Starter / Pro / Advanced 等订阅计划，配置每个计划包含的应用与能力开关。</p>
      </div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="() => refresh()"
        >
          刷新
        </UButton>
        <UButton
          color="primary"
          variant="solid"
          icon="i-lucide-plus"
          to="/admin/plans/new"
        >
          新建订阅计划
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :title="fetchErrorMessage"
      class="mb-4"
    >
      <template #actions>
        <UButton
          color="error"
          variant="ghost"
          size="sm"
          icon="i-lucide-refresh-cw"
          @click="() => refresh()"
        >
          重试
        </UButton>
      </template>
    </UAlert>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索计划名 / code…"
          size="sm"
          class="w-full max-w-70"
        />
        <USelect
          v-model="tier"
          :items="tierItems"
          size="sm"
          class="w-36"
        />
        <USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-36"
        />
        <span class="grow" />
        <span class="mono text-muted text-xs">
          {{ rows.length }} / {{ total }}
        </span>
      </div>

      <UEmpty
        v-if="!pending && rows.length === 0"
        icon="i-lucide-package"
        title="暂无订阅计划"
        description="尝试调整筛选条件，或创建第一个计划。"
        class="py-14"
      >
        <template #actions>
          <UButton
            size="sm"
            @click="clearFilters"
          >
            清空筛选
          </UButton>
          <UButton
            size="sm"
            color="primary"
            to="/admin/plans/new"
          >
            新建计划
          </UButton>
        </template>
      </UEmpty>

      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :loading="pending"
        :on-select="selectRow"
        :ui="{
          root: 'overflow-x-auto',
          th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
          td: 'text-sm text-muted whitespace-nowrap',
          tr: 'cursor-pointer'
        }"
      >
        <template #plan-cell="{ row }">
          <div class="flex items-center gap-2.5">
            <div class="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted">
              <UIcon
                name="i-lucide-package"
                class="size-3.5"
              />
            </div>
            <div class="min-w-0">
              <div class="font-medium text-highlighted">
                {{ row.original.planName }}
              </div>
              <div class="mono text-dimmed text-xs">
                {{ row.original.planCode }}
              </div>
            </div>
          </div>
        </template>

        <template #planTier-cell="{ row }">
          <UBadge
            :color="TIER_TONE[row.original.planTier] || 'neutral'"
            variant="soft"
            size="sm"
          >
            {{ TIER_LABEL[row.original.planTier] || row.original.planTier }}
          </UBadge>
        </template>

        <template #priceModel-cell="{ row }">
          <div class="flex flex-col">
            <span class="text-default text-sm">{{ formatPrice(row.original) }}</span>
            <span class="text-dimmed text-xs">{{ row.original.priceModel }}</span>
          </div>
        </template>

        <template #appCount-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.appCount }}</span>
        </template>

        <template #capabilityCount-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.capabilityCount }}</span>
        </template>

        <template #activeSubscriberCount-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.activeSubscriberCount }}</span>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="STATUS_TONE[row.original.status] || 'neutral'"
            variant="soft"
            size="sm"
          >
            <template #leading>
              <span class="size-1.5 rounded-full bg-current" />
            </template>
            {{ row.original.status }}
          </UBadge>
        </template>

        <template #actions-cell="{ row }">
          <UDropdownMenu :items="rowMenuItems(row.original)">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-ellipsis"
              size="sm"
              square
              @click.stop
            />
          </UDropdownMenu>
        </template>
      </UTable>

      <div
        v-if="rows.length > 0"
        class="tbl-foot"
      >
        <span>共 <b class="text-highlighted font-semibold">{{ total }}</b> 条</span>
        <UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="pageSize"
          size="sm"
          variant="ghost"
          color="neutral"
          :show-edges="false"
        />
      </div>
    </UCard>
  </div>
</template>
