<script setup lang="ts">
import type { ApiResponse, CostSnapshot, ListResponse } from '~/types'

const { money } = usePeopleFormat()
const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()

const keyword = ref('')
const periodMonth = ref(new Date().toISOString().slice(0, 7))
const generating = ref(false)

const query = computed(() => ({
  page: 1,
  page_size: 80,
  keyword: keyword.value || undefined,
  period_month: periodMonth.value || undefined
}))

const { data: response, error, refresh } = await useFetch<ApiResponse<ListResponse<CostSnapshot>>>('/api/v1/cost-snapshots', {
  query,
  watch: [query]
})

const rows = computed(() => (response.value?.data.items || []).map(item => ({
  ...item,
  standard_display: money(item.standard_cost),
  actual_display: money(item.actual_cost)
})))

const totalStandard = computed(() => rows.value.reduce((sum, item) => sum + Number(item.standard_cost || 0), 0))
const totalActual = computed(() => rows.value.reduce((sum, item) => sum + Number(item.actual_cost || 0), 0))

const columns = [
  { accessorKey: 'period_month', header: '月份' },
  { accessorKey: 'employee_uid', header: '员工' },
  { accessorKey: 'standard_display', header: '标准成本' },
  { accessorKey: 'actual_display', header: '实际成本' },
  { accessorKey: 'currency', header: '币种' },
  { accessorKey: 'cost_basis', header: '核算口径' },
  { accessorKey: 'cost_source', header: '口径来源' },
  { accessorKey: 'standard_rate_code', header: '标准规则' },
  { accessorKey: 'source_app', header: '来源应用' },
  { accessorKey: 'source_biz_type', header: '来源类型' },
  { accessorKey: 'source_biz_id', header: '来源对象' }
]

function errorMessage(error: unknown) {
  const payload = error as { data?: { message?: string }, message?: string }
  return payload.data?.message || payload.message || '请稍后重试'
}

async function handleGenerateSnapshots() {
  if (generating.value) return

  const authorization = await ensurePeoplePermission('cost_snapshots', 'admin')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要成本快照管理权限后才能生成月度快照。',
      color: 'warning'
    })
    return
  }

  generating.value = true
  try {
    const result = await $fetch<ApiResponse<{ generated?: number, skipped?: unknown[] }>>(peopleApiPath('/api/admin/cost-snapshots/generate'), {
      method: 'POST',
      body: {
        periodMonth: periodMonth.value,
        activeRoleCode: authorization.switchedRoleCode || authorization.snapshot?.activeRoleCode || ''
      }
    })
    toast.add({
      title: '已生成月度成本快照',
      description: `生成 ${result.data?.generated || 0} 条，跳过 ${(result.data?.skipped || []).length} 条。`,
      color: 'success'
    })
    await refresh()
  } catch (error) {
    toast.add({
      title: '生成成本快照失败',
      description: errorMessage(error),
      color: 'error'
    })
  } finally {
    generating.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="people-cost-snapshots"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          成本快照
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
          title="成本快照暂不可用"
        />

        <div class="grid gap-3 md:grid-cols-3">
          <UCard variant="subtle">
            <p class="text-sm text-muted">
              快照月份
            </p>
            <UInput
              v-model="periodMonth"
              type="month"
              class="mt-2"
            />
          </UCard>
          <UCard variant="subtle">
            <p class="text-sm text-muted">
              标准成本合计
            </p>
            <p class="mt-2 text-2xl font-semibold">
              {{ money(totalStandard) }}
            </p>
          </UCard>
          <UCard variant="subtle">
            <p class="text-sm text-muted">
              实际成本合计
            </p>
            <p class="mt-2 text-2xl font-semibold">
              {{ money(totalActual) }}
            </p>
          </UCard>
        </div>

        <UCard>
          <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <UInput
              v-model="keyword"
              icon="i-lucide-search"
              placeholder="搜索员工 / 来源对象"
              class="w-full md:max-w-md"
            />
            <UButton
              icon="i-lucide-calculator"
              color="primary"
              variant="soft"
              :loading="generating"
              @click="handleGenerateSnapshots"
            >
              生成月度快照
            </UButton>
          </div>

          <div class="overflow-x-auto">
            <UTable
              :data="rows"
              :columns="columns"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
