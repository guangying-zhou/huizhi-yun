<script setup lang="ts">
import type { ApiResponse, EnvironmentItem, ListPayload, SummaryMetric } from '~/types'

const createOpen = ref(false)
const search = ref('')
const selectedStatus = ref<'all' | 'planning' | 'active'>('all')
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()

const query = computed(() => ({
  search: search.value.trim() || undefined,
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))

const { data: response, refresh, status } = await useFetch<ApiResponse<ListPayload<EnvironmentItem>>>('/api/v1/environments', {
  query
})

const metrics = computed<SummaryMetric[]>(() => response.value?.data.summary || [])
const items = computed<EnvironmentItem[]>(() => response.value?.data.items || [])
const displayItems = computed(() => items.value.map(item => ({
  ...item,
  environment_type_label: getLabel('environment_type', item.environment_type),
  status_label: getLabel('environment_status', item.status)
})))
const total = computed(() => response.value?.data.total || 0)
const loading = computed(() => status.value === 'pending')

const columns = [
  { accessorKey: 'environment_code', header: '环境编号' },
  { accessorKey: 'environment_name', header: '环境名称' },
  { accessorKey: 'environment_type_label', header: '类型' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'project_code', header: '项目' }
]

const handleRowSelect = (_event: Event, row: { original: EnvironmentItem }) => {
  navigateTo(`/environments/${row.original.id}`)
}

const handleRefresh = () => refresh()
const handleCreated = async (id: number) => {
  await refresh()
  await navigateTo(`/environments/${id}`)
}
</script>

<template>
  <UDashboardPanel id="environments" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          环境视图
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-plus"
          color="primary"
          variant="soft"
          @click="createOpen = true"
        >
          新增环境
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
        <AssetsPageIntroCard title="环境视图" description="按环境查看项目、客户、合同、责任人与资源投入。" />
        <AssetsSummaryMetricGrid :metrics="metrics" />

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">环境列表</span>
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
                placeholder="搜索环境编号、名称、项目、客户或合同"
              />
              <div class="flex flex-wrap gap-2">
                <UButton :variant="selectedStatus === 'all' ? 'solid' : 'outline'" size="sm" @click="selectedStatus = 'all'">
                  全部
                </UButton>
                <UButton
                  :variant="selectedStatus === 'planning' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'planning'"
                >
                  规划中
                </UButton>
                <UButton
                  :variant="selectedStatus === 'active' ? 'solid' : 'outline'"
                  size="sm"
                  color="neutral"
                  @click="selectedStatus = 'active'"
                >
                  运行中
                </UButton>
              </div>
            </div>
          </div>

          <UTable
            :data="displayItems"
            :columns="columns"
            :loading="loading"
            @select="handleRowSelect"
          />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsEnvironmentCreateSlideover
    :open="createOpen"
    @update:open="createOpen = $event"
    @created="handleCreated"
  />
</template>
