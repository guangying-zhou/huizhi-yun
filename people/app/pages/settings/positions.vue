<script setup lang="ts">
import type { ApiResponse, ListResponse, Position } from '~/types'

const keyword = ref('')

const query = computed(() => ({
  page: 1,
  page_size: 100,
  keyword: keyword.value || undefined
}))

const { data: response, error, refresh } = await useFetch<ApiResponse<ListResponse<Position>>>('/api/v1/positions', {
  query,
  watch: [query]
})

const rows = computed(() => (response.value?.data.items || []).map(item => ({
  ...item,
  enabled_label: item.enabled ? '启用' : '停用'
})))

const columns = [
  { accessorKey: 'position_code', header: '岗位编码' },
  { accessorKey: 'position_name', header: '岗位名称' },
  { accessorKey: 'job_family', header: '岗位族' },
  { accessorKey: 'description', header: '说明' },
  { accessorKey: 'enabled_label', header: '状态' },
  { accessorKey: 'sort_order', header: '排序' }
]
</script>

<template>
  <UDashboardPanel
    id="people-settings-positions"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          岗位字典
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
          title="岗位字典暂不可用"
        />

        <UCard>
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <UInput
              v-model="keyword"
              icon="i-lucide-search"
              placeholder="搜索岗位编码 / 名称 / 岗位族"
              class="w-full md:max-w-md"
            />
            <UButton
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
            >
              新增岗位
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
