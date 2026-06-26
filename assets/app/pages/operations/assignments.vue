<script setup lang="ts">
import type { ApiResponse, AssignmentItem, ListPayload, SummaryMetric } from '~/types'

const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const createOpen = ref(false)
const search = ref('')
const selectedStatus = ref<'all' | 'pending' | 'active' | 'completed'>('all')

const query = computed(() => ({
  search: search.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<AssignmentItem>>>('/api/v1/assignments', {
  query
})

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<AssignmentItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  action_type_label: getLabel('assignment_action_type', item.action_type),
  status_label: getLabel('assignment_status', item.status),
  target_type_label: getLabel('assignment_target_type', item.target_type)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'assignment_no', header: '操作编号' },
  { accessorKey: 'asset_code', header: '资产编号' },
  { accessorKey: 'asset_name', header: '资产名称' },
  { accessorKey: 'action_type_label', header: '操作类型' },
  { accessorKey: 'target_ref', header: '目标' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'workflow_instance_id', header: '流程实例' }
]

const handleRefresh = () => refresh()
const handleCreated = async () => {
  await refresh()
}
</script>

<template>
  <UDashboardPanel id="assignments" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          资产操作记录
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          @click="createOpen = true"
        >
          新增操作
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="handleRefresh"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="p-4 space-y-4">
        <AssetsPageIntroCard title="资产操作记录" description="覆盖分配、领用、转移、归还、释放、报废等操作链路。" />
        <AssetsSummaryMetricGrid :metrics="metrics" />
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">记录列表</span>
              <UBadge color="neutral" variant="soft">
                {{ total }} 条
              </UBadge>
            </div>
          </template>
          <div class="mb-4 space-y-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                class="lg:max-w-sm"
                placeholder="搜索操作编号、资产编号、资产名称、动作或目标"
              />
              <div class="flex flex-wrap gap-2">
                <UButton :variant="selectedStatus === 'all' ? 'solid' : 'outline'" size="sm" @click="selectedStatus = 'all'">
                  全部
                </UButton>
                <UButton
                  :variant="selectedStatus === 'pending' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'pending'"
                >
                  待处理
                </UButton>
                <UButton
                  :variant="selectedStatus === 'active' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'active'"
                >
                  进行中
                </UButton>
                <UButton
                  :variant="selectedStatus === 'completed' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'completed'"
                >
                  已完成
                </UButton>
              </div>
            </div>
          </div>
          <UTable :data="displayItems" :columns="columns" :loading="loading" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsAssignmentCreateModal
    :open="createOpen"
    @update:open="createOpen = $event"
    @created="handleCreated"
  />
</template>
