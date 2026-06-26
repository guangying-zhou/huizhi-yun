<script setup lang="ts">
import type { ApiResponse, Assignment, ListResponse } from '~/types'

const { label, color, date } = usePeopleFormat()

const keyword = ref('')

const query = computed(() => ({
  page: 1,
  page_size: 80,
  keyword: keyword.value || undefined
}))

const { data: response, error, refresh } = await useFetch<ApiResponse<ListResponse<Assignment>>>('/api/v1/assignments', {
  query,
  watch: [query]
})

const rows = computed(() => (response.value?.data.items || []).map(item => ({
  ...item,
  change_label: label(item.change_type),
  approval_label: label(item.approval_status),
  effective_period: `${date(item.effective_from)} ~ ${date(item.effective_to) === '-' ? '至今' : date(item.effective_to)}`
})))

const columns = [
  { accessorKey: 'assignment_code', header: '编号' },
  { accessorKey: 'employee_uid', header: '员工' },
  { accessorKey: 'change_label', header: '变更类型' },
  { accessorKey: 'dept_name', header: '部门' },
  { accessorKey: 'position_name', header: '岗位' },
  { accessorKey: 'rank_code', header: '职级' },
  { accessorKey: 'manager_uid', header: '负责人' },
  { accessorKey: 'effective_period', header: '生效期间' },
  { accessorKey: 'approval_label', header: '审批状态' },
  { accessorKey: 'source_app', header: '来源' }
]
</script>

<template>
  <UDashboardPanel
    id="people-assignments"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          任职变更
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
          title="任职变更暂不可用"
        />

        <UCard>
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <UInput
              v-model="keyword"
              icon="i-lucide-search"
              placeholder="搜索员工 / 岗位 / 来源单据"
              class="w-full md:max-w-md"
            />
            <UButton
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
            >
              新增变更
            </UButton>
          </div>
        </UCard>

        <UCard>
          <div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
            >
              <template #change_label-cell="{ row }">
                <UBadge
                  :color="color(row.original.change_type)"
                  variant="soft"
                >
                  {{ row.original.change_label }}
                </UBadge>
              </template>
              <template #approval_label-cell="{ row }">
                <UBadge
                  :color="color(row.original.approval_status)"
                  variant="soft"
                >
                  {{ row.original.approval_label }}
                </UBadge>
              </template>
            </UTable>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
