<script setup lang="ts">
const router = useRouter()

const TENDER_STATUS: Record<string, { label: string, color: string }> = {
  info_gathering: { label: '信息收集', color: 'neutral' },
  qualification: { label: '资格审查', color: 'info' },
  bid_preparation: { label: '标书编制', color: 'primary' },
  bid_submitted: { label: '投标提交', color: 'warning' },
  bid_opening: { label: '开标评标', color: 'warning' },
  won: { label: '中标', color: 'success' },
  lost: { label: '落标', color: 'error' },
  review_done: { label: '落标复盘', color: 'neutral' },
  abandoned: { label: '已放弃', color: 'neutral' }
}

const TENDER_TYPE: Record<string, string> = {
  open: '公开招标',
  invited: '邀请招标',
  negotiation: '竞争性谈判',
  single_source: '单一来源',
  inquiry: '询价'
}

const keyword = ref('')
const statusFilter = ref<string | undefined>(undefined)
const page = ref(1)
const pageSize = ref(20)

const queryParams = computed(() => ({
  page: page.value, pageSize: pageSize.value,
  keyword: keyword.value || undefined,
  status: statusFilter.value || undefined
}))

const { data: result, status, refresh } = useFetch('/api/v1/tenders', {
  query: queryParams,
  transform: (res: any) => res.data as { items: any[], total: number }
})

const items = computed(() => result.value?.items || [])
const total = computed(() => result.value?.total || 0)

const columns = [
  { accessorKey: 'code', header: '编号' },
  { accessorKey: 'name', header: '项目名称' },
  { accessorKey: 'customer_name', header: '客户' },
  { accessorKey: 'tender_type', header: '招标类型' },
  { accessorKey: 'budget_amount', header: '预算金额' },
  { accessorKey: 'bid_submission_deadline', header: '投标截止' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'owner_user_id', header: '负责人' },
  { accessorKey: 'actions', header: '' }
]

function onSearch() {
  page.value = 1
  refresh()
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = undefined
  page.value = 1
}
function formatMoney(val: number | null) {
  if (val == null) return '--'
  if (val >= 10000) return (val / 10000).toFixed(1) + '万'
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0 }).format(val)
}

// 判断投标截止日期是否临近（7天内）
function isUrgent(deadline: string | null) {
  if (!deadline) return false
  const diff = new Date(deadline).getTime() - Date.now()
  return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000
}

const statusSelectOptions = computed(() =>
  Object.entries(TENDER_STATUS).map(([v, o]) => ({ label: o.label, value: v }))
)
</script>

<template>
  <UDashboardPanel
    id="tenders"
    :ui="{
      root: '!h-full !min-h-0 !flex-1 !shrink !overflow-hidden',
      body: '!min-h-0 !flex-1 !gap-0 !overflow-hidden !p-0 sm:!p-0'
    }"
  >
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          投标管理
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="新建投标"
          icon="i-lucide-plus"
          color="primary"
          @click="router.push('/tenders/new')"
        />
      </Teleport>

      <div class="altoc-list-page">
        <div class="altoc-list-toolbar flex flex-wrap items-center gap-2 px-4 py-3 border-b border-default">
          <UInput
            v-model="keyword"
            placeholder="搜索项目/客户/编号..."
            icon="i-lucide-search"
            class="w-56"
            @keyup.enter="onSearch"
          />
          <USelect
            v-model="statusFilter"
            :items="statusSelectOptions"
            placeholder="全部状态"
            class="w-32"
            @update:model-value="onSearch"
          />
          <UButton
            label="重置"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="resetFilters"
          />
        </div>

        <div class="altoc-list-table">
          <UTable
            :data="items"
            :columns="columns"
            :loading="status === 'pending'"
            sticky="header"
            class="altoc-sticky-table w-full"
            :ui="{ thead: 'z-20 bg-default' }"
          >
            <template #code-cell="{ row }">
              <NuxtLink :to="`/tenders/${row.original.id}`" class="font-mono text-xs text-primary hover:underline">
                {{ row.original.code }}
              </NuxtLink>
            </template>
            <template #name-cell="{ row }">
              <NuxtLink :to="`/tenders/${row.original.id}`" class="font-medium text-primary hover:underline">
                {{ row.original.name }}
              </NuxtLink>
            </template>
            <template #customer_name-cell="{ row }">
              <TruncatedText :text="row.original.customer_name" :max="16" />
            </template>
            <template #tender_type-cell="{ row }">
              {{ TENDER_TYPE[row.original.tender_type] || row.original.tender_type || '-' }}
            </template>
            <template #budget_amount-cell="{ row }">
              <span class="font-mono">{{ formatMoney(row.original.budget_amount) }}</span>
            </template>
            <template #bid_submission_deadline-cell="{ row }">
              <span class="text-xs" :class="isUrgent(row.original.bid_submission_deadline) ? 'text-error font-medium' : ''">
                {{ row.original.bid_submission_deadline || '-' }}
                <span v-if="isUrgent(row.original.bid_submission_deadline)" class="ml-1">(紧急)</span>
              </span>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="(TENDER_STATUS[row.original.status]?.color || 'neutral') as any" variant="subtle" size="sm">
                {{ TENDER_STATUS[row.original.status]?.label || row.original.status }}
              </UBadge>
            </template>
            <template #owner_user_id-cell="{ row }">
              <UserName :uid="row.original.owner_user_id" />
            </template>
            <template #actions-cell="{ row }">
              <UButton
                icon="i-lucide-eye"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="router.push(`/tenders/${row.original.id}`)"
              />
            </template>
            <template #empty>
              <div class="flex flex-col items-center py-12 text-muted">
                <UIcon name="i-lucide-gavel" class="text-4xl mb-3" />
                <p class="text-sm mb-3">
                  暂无投标项目
                </p>
                <UButton
                  label="创建第一个投标"
                  color="primary"
                  variant="soft"
                  @click="router.push('/tenders/new')"
                />
              </div>
            </template>
          </UTable>
        </div>

        <div v-if="total > 0" class="altoc-list-pagination flex items-center justify-between px-4 py-3 border-t border-default">
          <span class="text-sm text-muted">共 {{ total }} 条</span>
          <UPagination v-model:page="page" :items-per-page="pageSize" :total="total" />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
