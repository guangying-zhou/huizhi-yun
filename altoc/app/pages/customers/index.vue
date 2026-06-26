<script setup lang="ts">
import { useAccountStore } from '@hzy/foundation/app/stores/account'
import type { ApiResult, Customer, CustomerLevel, Industry, PaginatedResponse, Region } from '~/types/altoc'
import { CUSTOMER_STATUS_OPTIONS } from '~/types/altoc'
import { unwrapApiList, unwrapApiPage } from '~/utils/apiResponse'

const router = useRouter()
const toast = useToast()
const nuxtApp = useNuxtApp()
const accountStore = useAccountStore(nuxtApp.$pinia)

// 筛选条件
const keyword = ref('')
const statusFilter = ref<string | undefined>(undefined)
const industryFilter = ref<string | undefined>(undefined)
const regionFilter = ref<string | undefined>(undefined)
const levelFilter = ref<number | undefined>(undefined)

// 分页
const page = ref(1)
const pageSize = ref(20)

// 加载配置数据
const { data: industries } = useFetch('/api/v1/config/industries', {
  transform: (res: ApiResult<Industry[]> | unknown) => unwrapApiList<Industry>(res)
})
const { data: regions } = useFetch('/api/v1/config/regions', {
  transform: (res: ApiResult<Region[]> | unknown) => unwrapApiList<Region>(res)
})
const { data: levels } = useFetch('/api/v1/config/customer-levels', {
  transform: (res: ApiResult<CustomerLevel[]> | unknown) => unwrapApiList<CustomerLevel>(res)
})

// 构建查询参数
const queryParams = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  keyword: keyword.value || undefined,
  status: statusFilter.value || undefined,
  industry_code: industryFilter.value || undefined,
  region_code: regionFilter.value || undefined,
  customer_level_id: levelFilter.value || undefined
}))

// 加载客户列表
const { data: result, status, refresh } = useFetch('/api/v1/customers', {
  query: queryParams,
  transform: (res: ApiResult<PaginatedResponse<Customer>> | unknown) => unwrapApiPage<Customer>(res)
})

const items = computed(() => result.value?.items || [])
const total = computed(() => result.value?.total || 0)

watch(items, async (rows) => {
  const ownerUids = [...new Set(rows.map(row => row.owner_user_id).filter(Boolean))]
  if (ownerUids.length === 0) return

  try {
    await accountStore.fetchUsersBatch(ownerUids)
  } catch {
    // UserName 组件会按单个 uid 兜底加载；这里不阻断客户列表渲染。
  }
}, { immediate: true })

// 表格列定义
const columns = [
  { accessorKey: 'code', header: '编号' },
  { accessorKey: 'name', header: '客户名称' },
  { accessorKey: 'customer_level_name', header: '等级' },
  { accessorKey: 'industry_name', header: '行业' },
  { accessorKey: 'region_name', header: '区域' },
  { accessorKey: 'location', header: '所在地' },
  { accessorKey: 'owner_user_id', header: '负责人' },
  { accessorKey: 'last_follow_up_at', header: '最近跟进' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'actions', header: '' }
]

// 搜索（重置分页）
function onSearch() {
  page.value = 1
  refresh()
}

// 重置筛选
function resetFilters() {
  keyword.value = ''
  statusFilter.value = undefined
  industryFilter.value = undefined
  regionFilter.value = undefined
  levelFilter.value = undefined
  page.value = 1
}

// 删除客户
async function deleteCustomer(customer: Customer) {
  if (!confirm(`确定删除客户「${customer.name}」？`)) return
  try {
    await $fetch(`/api/v1/customers/${customer.id}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', color: 'success' })
    refresh()
  } catch (err: unknown) {
    const message = (err as { data?: { statusMessage?: string } }).data?.statusMessage
    toast.add({ title: message || '删除失败', color: 'error' })
  }
}

function getStatusColor(status: string) {
  return CUSTOMER_STATUS_OPTIONS.find(o => o.value === status)?.color || 'neutral'
}

function getStatusLabel(status: string) {
  return CUSTOMER_STATUS_OPTIONS.find(o => o.value === status)?.label || status
}

// 状态筛选选项
const statusSelectOptions = computed(() =>
  CUSTOMER_STATUS_OPTIONS.map(o => ({ label: o.label, value: o.value }))
)
const industrySelectOptions = computed(() =>
  (industries.value || []).map(i => ({ label: i.name, value: i.code }))
)
const industryNameByCode = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const i of (industries.value || [])) m[i.code] = i.name
  return m
})
const regionNameByCode = computed<Record<string, string>>(() => {
  const m: Record<string, string> = {}
  for (const r of (regions.value || [])) m[r.code] = r.name
  return m
})
const regionSelectOptions = computed(() =>
  (regions.value || []).map(r => ({ label: r.name, value: r.code }))
)
const levelSelectOptions = computed(() =>
  (levels.value || []).map(l => ({ label: l.name, value: l.id }))
)
</script>

<template>
  <UDashboardPanel
    id="customers"
    :ui="{
      root: '!h-full !min-h-0 !flex-1 !shrink !overflow-hidden',
      body: '!min-h-0 !flex-1 !gap-0 !overflow-hidden !p-0 sm:!p-0'
    }"
  >
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          客户管理
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="新建客户"
          icon="i-lucide-plus"
          color="primary"
          @click="router.push('/customers/new')"
        />
      </Teleport>

      <div class="altoc-list-page min-w-0">
        <!-- 筛选栏 -->
        <div class="altoc-list-toolbar flex flex-wrap items-center gap-2 px-4 py-3 border-b border-default">
          <UInput
            v-model="keyword"
            placeholder="搜索客户名称/编号..."
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
          <USelect
            v-model="industryFilter"
            :items="industrySelectOptions"
            placeholder="全部行业"
            class="w-36"
            @update:model-value="onSearch"
          />
          <USelect
            v-model="regionFilter"
            :items="regionSelectOptions"
            placeholder="全部区域"
            class="w-32"
            @update:model-value="onSearch"
          />
          <USelect
            v-model="levelFilter"
            :items="levelSelectOptions"
            placeholder="全部等级"
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

        <!-- 数据表格 -->
        <div class="altoc-list-table p-2">
          <UTable
            :data="items"
            :columns="columns"
            :loading="status === 'pending'"
            sticky="header"
            class="altoc-sticky-table w-full"
            :ui="{ base: 'w-full min-w-[1080px]', thead: 'z-20 bg-default' }"
          >
            <template #code-cell="{ row }">
              <span class="font-mono text-xs text-muted">{{ row.original.code }}</span>
            </template>

            <template #name-cell="{ row }">
              <NuxtLink
                :to="`/customers/${row.original.id}`"
                class="font-medium text-primary hover:underline"
              >
                <TruncatedText :text="row.original.name" :max="16" />
              </NuxtLink>
              <span v-if="row.original.short_name" class="text-xs text-muted ml-1">({{ row.original.short_name }})</span>
            </template>

            <template #customer_level_name-cell="{ row }">
              <span>{{ row.original.customer_level_name || '-' }}</span>
            </template>

            <template #industry_name-cell="{ row }">
              <span>{{ (row.original.industry_code && industryNameByCode[row.original.industry_code]) || '-' }}</span>
            </template>

            <template #region_name-cell="{ row }">
              <span>{{ (row.original.region_code && regionNameByCode[row.original.region_code]) || '-' }}</span>
            </template>

            <template #location-cell="{ row }">
              <span>{{ [row.original.province, row.original.city].filter(Boolean).join(' / ') || '-' }}</span>
            </template>

            <template #owner_user_id-cell="{ row }">
              <UserName :uid="row.original.owner_user_id" />
            </template>

            <template #last_follow_up_at-cell="{ row }">
              <span class="text-xs text-muted">{{ row.original.last_follow_up_at || '-' }}</span>
            </template>

            <template #status-cell="{ row }">
              <UBadge :color="getStatusColor(row.original.status)" variant="subtle" size="sm">
                {{ getStatusLabel(row.original.status) }}
              </UBadge>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex items-center gap-1">
                <UButton
                  icon="i-lucide-eye"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="router.push(`/customers/${row.original.id}`)"
                />
                <UButton
                  icon="i-lucide-pencil"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  @click="router.push(`/customers/${row.original.id}/edit`)"
                />
                <UButton
                  icon="i-lucide-trash-2"
                  variant="ghost"
                  color="error"
                  size="xs"
                  @click="deleteCustomer(row.original)"
                />
              </div>
            </template>

            <template #empty>
              <div class="flex flex-col items-center py-12 text-muted">
                <UIcon name="i-lucide-building-2" class="text-4xl mb-3" />
                <p class="text-sm mb-3">
                  暂无客户数据
                </p>
                <UButton
                  label="创建第一个客户"
                  color="primary"
                  variant="soft"
                  @click="router.push('/customers/new')"
                />
              </div>
            </template>
          </UTable>
        </div>

        <!-- 分页 -->
        <div v-if="total > 0" class="altoc-list-pagination flex items-center justify-between px-4 py-3 border-t border-default">
          <span class="text-sm text-muted">共 {{ total }} 条</span>
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="total"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
