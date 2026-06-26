<script setup lang="ts">
import type { ApiResponse, FinancePerformanceAmount, PerformanceCycleDetail } from '~/types'

const route = useRoute()
const cycleCode = computed(() => String(route.params.code || ''))
const { label, color, date, money } = usePeopleFormat()
const toast = useToast()
const { ensurePeoplePermission } = usePeopleAuthorization()
const collecting = ref(false)
const confirming = ref(false)
const closing = ref(false)

const { data: response, error, refresh } = await useFetch<ApiResponse<PerformanceCycleDetail>>(() => `/api/v1/performance-cycles/${cycleCode.value}/detail`, {
  watch: [cycleCode]
})

interface FinancePerformanceAmountList {
  data?: FinancePerformanceAmount[]
  total?: number
  page?: number
  pageSize?: number
  warning?: string
}

const detail = computed(() => response.value?.data)
const cycle = computed(() => detail.value?.cycle)
const summary = computed(() => detail.value?.summary || {})
const rows = computed(() => detail.value?.contribution_snapshots || [])
const financeAmountQuery = computed(() => ({
  cycleCode: cycle.value?.cycle_code || cycleCode.value,
  projectCode: cycle.value?.project_code || undefined,
  periodStart: cycle.value?.period_start || undefined,
  periodEnd: cycle.value?.period_end || undefined,
  page: 1,
  pageSize: 100
}))

const {
  data: financeAmountResponse,
  error: financeAmountError,
  refresh: refreshFinanceAmounts
} = await useFetch<ApiResponse<FinancePerformanceAmountList>>(peopleApiPath('/api/admin/performance-amounts'), {
  query: financeAmountQuery,
  immediate: false,
  watch: false
})

const financeAmountRows = computed(() => (financeAmountResponse.value?.data.data || []).map(item => ({
  ...item,
  base_amount_display: money(item.base_amount),
  performance_amount_display: money(item.performance_amount),
  contribution_base_amount_display: money(item.contribution_base_amount),
  calculated_at_display: date(item.calculated_at)
})))
const financeAmountTotal = computed(() => financeAmountResponse.value?.data.total || financeAmountRows.value.length)
const financeAmountSum = computed(() => financeAmountRows.value.reduce((sum, row) => {
  const amount = Number(row.performance_amount || 0)
  return Number.isFinite(amount) ? sum + amount : sum
}, 0))
const canConfirmCycle = computed(() => {
  const status = cycle.value?.status
  return Boolean(cycle.value && !['confirmed', 'closed', 'cancelled'].includes(String(status || '')))
})
const canCloseCycle = computed(() => cycle.value?.status === 'confirmed')

const columns = [
  { accessorKey: 'employee_name', header: '员工' },
  { accessorKey: 'employee_uid', header: 'UID' },
  { accessorKey: 'project_code', header: '项目' },
  { accessorKey: 'role_code', header: '角色' },
  { accessorKey: 'work_hours', header: '工时' },
  { accessorKey: 'contribution_score', header: '贡献分' },
  { accessorKey: 'source_app', header: '来源应用' },
  { accessorKey: 'source_biz_type', header: '来源类型' },
  { accessorKey: 'source_biz_id', header: '来源对象' }
]

const financeAmountColumns = [
  { accessorKey: 'employee_name', header: '员工' },
  { accessorKey: 'employee_uid', header: 'UID' },
  { accessorKey: 'period_month', header: '月份' },
  { accessorKey: 'performance_type', header: '类型' },
  { accessorKey: 'base_amount_display', header: '基础金额' },
  { accessorKey: 'performance_amount_display', header: '绩效金额' },
  { accessorKey: 'status', header: 'Finance 状态' },
  { accessorKey: 'calculated_at_display', header: '计算时间' }
]

watch(cycle, async (value) => {
  if (!value) return
  await refreshFinanceAmounts()
}, { immediate: true })

async function handleRefresh() {
  await refresh()
  if (cycle.value) await refreshFinanceAmounts()
}

function errorMessage(error: unknown) {
  const payload = error as { data?: { message?: string }, message?: string }
  return payload.data?.message || payload.message || '请稍后重试'
}

async function handleCollectContributions() {
  if (collecting.value || !cycle.value) return
  if (!cycle.value.project_code) {
    toast.add({
      title: '暂不支持汇集',
      description: '当前只支持项目范围的绩效周期从 Aims 汇集贡献。',
      color: 'warning'
    })
    return
  }

  const authorization = await ensurePeoplePermission('performance_cycles', 'edit')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要绩效周期编辑权限后才能汇集贡献。',
      color: 'warning'
    })
    return
  }

  collecting.value = true
  try {
    const result = await $fetch<ApiResponse<{
      timeEntryRows?: number
      contributionItems?: number
      synced?: number
    }>>(peopleApiPath(`/api/admin/performance-cycles/${encodeURIComponent(cycle.value.cycle_code)}/collect`), {
      method: 'POST',
      body: {
        activeRoleCode: authorization.switchedRoleCode || authorization.snapshot?.activeRoleCode || '',
        defaultContributionScore: 80
      }
    })

    toast.add({
      title: '已汇集 Aims 贡献',
      description: `读取 ${result.data?.timeEntryRows || 0} 条工时，写入 ${result.data?.synced ?? result.data?.contributionItems ?? 0} 条贡献快照。`,
      color: 'success'
    })
    await handleRefresh()
  } catch (error) {
    toast.add({
      title: '汇集贡献失败',
      description: errorMessage(error),
      color: 'error'
    })
  } finally {
    collecting.value = false
  }
}

async function handleCycleAction(action: 'confirm' | 'close') {
  if (!cycle.value) return
  const pending = action === 'confirm' ? confirming : closing
  if (pending.value) return

  const authorization = await ensurePeoplePermission('performance_cycles', 'edit')
  if (!authorization.authorized) {
    toast.add({
      title: '当前角色无权限',
      description: '需要绩效周期编辑权限后才能执行该操作。',
      color: 'warning'
    })
    return
  }

  pending.value = true
  try {
    await $fetch<ApiResponse<Record<string, unknown>>>(peopleApiPath(`/api/admin/performance-cycles/${encodeURIComponent(cycle.value.cycle_code)}/${action}`), {
      method: 'POST',
      body: {
        activeRoleCode: authorization.switchedRoleCode || authorization.snapshot?.activeRoleCode || ''
      }
    })

    toast.add({
      title: action === 'confirm' ? '绩效周期已确认' : '绩效周期已关闭',
      description: action === 'confirm' ? '贡献快照已同步标记为确认。' : '该周期已进入归档关闭状态。',
      color: 'success'
    })
    await handleRefresh()
  } catch (error) {
    toast.add({
      title: action === 'confirm' ? '确认周期失败' : '关闭周期失败',
      description: errorMessage(error),
      color: 'error'
    })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="people-performance-cycle-detail"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <div class="flex min-w-0 items-center gap-2">
          <UButton
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="ghost"
            size="sm"
            to="/performance-cycles"
          />
          <h1 class="truncate text-base font-semibold">
            {{ cycle?.cycle_name || cycleCode }}
          </h1>
        </div>
      </Teleport>
      <Teleport to="#people-layout-header-actions">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="handleRefresh"
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
          title="绩效周期详情暂不可用"
        />

        <UCard v-if="cycle">
          <div class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-xl font-semibold">
                  {{ cycle.cycle_name }}
                </h2>
                <UBadge
                  :color="color(cycle.status)"
                  variant="soft"
                >
                  {{ label(cycle.status) }}
                </UBadge>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  {{ cycle.scope_type }}
                </UBadge>
              </div>
              <div class="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div><span class="text-muted">周期编码</span> {{ cycle.cycle_code }}</div>
                <div><span class="text-muted">项目</span> {{ cycle.project_code || '-' }}</div>
                <div><span class="text-muted">期间</span> {{ date(cycle.period_start) }} ~ {{ date(cycle.period_end) }}</div>
                <div><span class="text-muted">Workflow</span> {{ cycle.workflow_instance_id || '-' }}</div>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                icon="i-lucide-download"
                color="primary"
                variant="soft"
                :loading="collecting"
                :disabled="!cycle.project_code"
                @click="handleCollectContributions"
              >
                汇集贡献
              </UButton>
              <UButton
                icon="i-lucide-badge-check"
                color="success"
                variant="soft"
                :loading="confirming"
                :disabled="!canConfirmCycle"
                @click="handleCycleAction('confirm')"
              >
                确认周期
              </UButton>
              <UButton
                icon="i-lucide-archive"
                color="neutral"
                variant="soft"
                :loading="closing"
                :disabled="!canCloseCycle"
                @click="handleCycleAction('close')"
              >
                关闭周期
              </UButton>
            </div>
          </div>
        </UCard>

        <div class="grid gap-3 md:grid-cols-4">
          <UCard variant="subtle">
            <p class="text-sm text-muted">
              覆盖员工
            </p>
            <p class="mt-2 text-2xl font-semibold">
              {{ summary.employee_count || 0 }}
            </p>
          </UCard>
          <UCard variant="subtle">
            <p class="text-sm text-muted">
              参与项目
            </p>
            <p class="mt-2 text-2xl font-semibold">
              {{ summary.project_count || 0 }}
            </p>
          </UCard>
          <UCard variant="subtle">
            <p class="text-sm text-muted">
              工时合计
            </p>
            <p class="mt-2 text-2xl font-semibold">
              {{ summary.work_hours || 0 }}h
            </p>
          </UCard>
          <UCard variant="subtle">
            <p class="text-sm text-muted">
              平均贡献分
            </p>
            <p class="mt-2 text-2xl font-semibold">
              {{ summary.avg_score || '-' }}
            </p>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <span class="font-semibold">Finance 绩效金额快照</span>
                <p class="mt-1 text-xs text-muted">
                  只引用 Finance 金额口径，不改变 People 绩效终态
                </p>
              </div>
              <div class="text-right text-xs text-muted">
                <div>{{ financeAmountTotal }} 条</div>
                <div>{{ money(financeAmountSum) }}</div>
              </div>
            </div>
          </template>
          <UAlert
            v-if="financeAmountError"
            color="warning"
            variant="soft"
            icon="i-lucide-circle-alert"
            title="Finance 绩效金额暂不可用"
            description="请确认 Finance 已生成绩效金额快照，且 People runtime 已获得 finance:read 服务授权。"
            class="mb-3"
          />
          <div class="overflow-x-auto">
            <UTable
              :data="financeAmountRows"
              :columns="financeAmountColumns"
            />
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">贡献快照</span>
              <span class="text-xs text-muted">保留 source_app / source_biz_type / source_biz_id / source_refs 追溯</span>
            </div>
          </template>
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
