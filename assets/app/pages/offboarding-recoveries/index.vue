<script setup lang="ts">
import type { ApiResponse, OffboardingRecoveryCaseItem } from '~/types'

usePageTitle('离职资产回收')

interface RecoveryListPayload {
  items: OffboardingRecoveryCaseItem[]
  total: number
}

const router = useRouter()
const selectedStatus = ref<'all' | 'active' | 'cancelled'>('active')
const query = computed(() => ({
  status: selectedStatus.value === 'all' ? undefined : selectedStatus.value
}))
const { data: response, refresh, status } = await useFetch<ApiResponse<RecoveryListPayload>>(
  '/api/v1/offboarding-recoveries',
  { query }
)
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)
const items = computed(() => response.value?.data.items || [])
const total = computed(() => response.value?.data.total || 0)
const unassignedCount = computed(() => items.value.filter(item => (
  item.status === 'active' && !item.recovery_responsible_uid
)).length)
const columns = [
  { accessorKey: 'case_code', header: '回收事项' },
  { accessorKey: 'departed_employee_name', header: '离职员工' },
  { accessorKey: 'offboarded_at', header: '离职时间' },
  { accessorKey: 'recovery_due_at', header: '回收期限' },
  { accessorKey: 'outstanding_count', header: '未归还' },
  { id: 'responsibility', header: '回收责任人' },
  { accessorKey: 'status', header: '状态' }
]

function openCase(_event: Event, row: { original: OffboardingRecoveryCaseItem }) {
  void router.push(`/offboarding-recoveries/${encodeURIComponent(row.original.case_code)}`)
}
</script>

<template>
  <UDashboardPanel id="offboarding-recoveries" grow>
    <template #body>
      <div class="space-y-4 p-4">
        <UAlert
          v-if="unassignedCount > 0"
          color="warning"
          variant="soft"
          icon="i-lucide-user-round-x"
          title="存在未分配回收责任的事项"
          :description="`${unassignedCount} 个有效离职事项不会发送通知，请进入详情分配明确责任人。`"
        />
        <UCard>
          <template #header>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="flex items-center gap-2">
                <span class="font-semibold">回收事项</span>
                <UBadge color="neutral" variant="soft">
                  {{ total }} 项
                </UBadge>
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton size="sm" :variant="selectedStatus === 'active' ? 'solid' : 'outline'" @click="selectedStatus = 'active'">
                  离职投影有效
                </UButton>
                <UButton
                  size="sm"
                  color="neutral"
                  :variant="selectedStatus === 'cancelled' ? 'solid' : 'outline'"
                  @click="selectedStatus = 'cancelled'"
                >
                  已取消
                </UButton>
                <UButton
                  size="sm"
                  color="neutral"
                  :variant="selectedStatus === 'all' ? 'solid' : 'outline'"
                  @click="selectedStatus = 'all'"
                >
                  全部
                </UButton>
              </div>
            </div>
          </template>
          <UTable
            :data="items"
            :columns="columns"
            :loading="status === 'pending'"
            @select="openCase"
          >
            <template #departed_employee_name-cell="{ row }">
              <div class="min-w-36">
                <div>{{ row.original.departed_employee_name || row.original.departed_employee_uid }}</div>
                <div class="text-xs text-muted">
                  {{ row.original.departed_employee_uid }}
                </div>
              </div>
            </template>
            <template #outstanding_count-cell="{ row }">
              <UBadge :color="Number(row.original.outstanding_count) > 0 ? 'error' : 'success'" variant="soft">
                {{ row.original.outstanding_count }} 项
              </UBadge>
            </template>
            <template #responsibility-cell="{ row }">
              <span v-if="row.original.recovery_responsible_uid">{{ row.original.recovery_responsible_uid }}</span>
              <span v-else class="text-warning">未分配（不通知）</span>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="row.original.status === 'active' ? 'info' : 'neutral'" variant="soft">
                {{ row.original.status === 'active' ? '离职投影有效' : '已取消' }}
              </UBadge>
            </template>
            <template #empty>
              <div class="py-8 text-center text-sm text-muted">
                暂无离职回收事项
              </div>
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
