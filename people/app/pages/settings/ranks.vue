<script setup lang="ts">
import type { ApiResponse, ListResponse, Rank } from '~/types'

const keyword = ref('')

const query = computed(() => ({
  page: 1,
  page_size: 100,
  keyword: keyword.value || undefined
}))

const { data: response, error, refresh } = await useFetch<ApiResponse<ListResponse<Rank>>>('/api/v1/ranks', {
  query,
  watch: [query]
})

const rows = computed(() => (response.value?.data.items || []).map(item => ({
  ...item,
  enabled_label: item.enabled ? '启用' : '停用'
})))

const columns = [
  { accessorKey: 'rank_code', header: '职级编码' },
  { accessorKey: 'rank_name', header: '职级名称' },
  { accessorKey: 'rank_level', header: '职级层级' },
  { accessorKey: 'description', header: '说明' },
  { accessorKey: 'enabled_label', header: '状态' },
  { accessorKey: 'sort_order', header: '排序' }
]
</script>

<template>
  <UDashboardPanel
    id="people-settings-ranks"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          职级字典
        </h1>
      </Teleport>
      <Teleport to="#people-layout-header-actions">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="() => refresh()"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="space-y-4 p-4">
        <UAlert
          v-if="error"
          color="warning"
          variant="soft"
          icon="i-lucide-database-zap"
          title="职级字典暂不可用"
        />

        <UCard>
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <UInput
              v-model="keyword"
              icon="i-lucide-search"
              placeholder="搜索职级编码 / 名称"
              class="w-full md:max-w-md"
            />
            <UButton
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
            >
              新增职级
            </UButton>
          </div>
        </UCard>

        <UCard>
          <div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
            >
              <template #enabled_label-cell="{ row }">
                <UBadge
                  :color="row.original.enabled ? 'success' : 'neutral'"
                  variant="soft"
                >
                  {{ row.original.enabled_label }}
                </UBadge>
              </template>
            </UTable>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
