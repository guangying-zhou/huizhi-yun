<script setup lang="ts">
import type { ApiResponse, Assignment, DashboardOverview, PerformanceCycle, SummaryMetric } from '~/types'

const { label, color, date } = usePeopleFormat()

const { data: response, error, refresh } = await useFetch<ApiResponse<DashboardOverview>>('/api/v1/dashboard/overview')

const metrics = computed<SummaryMetric[]>(() => response.value?.data.metrics || [])
const quickLinks = computed(() => response.value?.data.quick_links || [])
const activeCycles = computed<PerformanceCycle[]>(() => response.value?.data.active_cycles || [])
const recentAssignments = computed<Assignment[]>(() => response.value?.data.recent_assignments || [])

const cycleColumns = [
  { accessorKey: 'cycle_code', header: '周期' },
  { accessorKey: 'cycle_name', header: '名称' },
  { accessorKey: 'scope_type', header: '范围' },
  { accessorKey: 'period', header: '期间' },
  { accessorKey: 'status_label', header: '状态' }
]

const assignmentColumns = [
  { accessorKey: 'assignment_code', header: '编号' },
  { accessorKey: 'employee_uid', header: '员工' },
  { accessorKey: 'change_label', header: '类型' },
  { accessorKey: 'position_name', header: '岗位' },
  { accessorKey: 'effective_from', header: '生效日' },
  { accessorKey: 'approval_label', header: '审批' }
]

const displayCycles = computed(() => activeCycles.value.map(item => ({
  ...item,
  period: `${date(item.period_start)} ~ ${date(item.period_end)}`,
  status_label: label(item.status)
})))

const displayAssignments = computed(() => recentAssignments.value.map(item => ({
  ...item,
  change_label: label(item.change_type),
  approval_label: label(item.approval_status),
  effective_from: date(item.effective_from)
})))

function handleRefresh() {
  refresh()
}
</script>

<template>
  <UDashboardPanel
    id="people-dashboard"
    grow
  >
    <template #body>
      <Teleport to="#people-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          People 工作台
        </h1>
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
          title="People data-runtime 暂不可用"
          description="页面已按 data-runtime 模式接入，执行 schema 并启用 People adapter 后会显示真实数据。"
        />

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <UCard
            v-for="metric in metrics"
            :key="metric.label"
            variant="subtle"
          >
            <div class="space-y-2">
              <p class="text-sm text-muted">
                {{ metric.label }}
              </p>
              <p class="text-2xl font-semibold">
                {{ metric.value }}
              </p>
              <UBadge
                :color="metric.color || 'neutral'"
                variant="soft"
              >
                {{ metric.hint || '实时汇总' }}
              </UBadge>
            </div>
          </UCard>
        </div>

        <div class="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between gap-3">
                <span class="font-semibold">快捷入口</span>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  {{ quickLinks.length }} 个
                </UBadge>
              </div>
            </template>

            <div
              v-if="quickLinks.length"
              class="grid gap-3 sm:grid-cols-2"
            >
              <NuxtLink
                v-for="link in quickLinks"
                :key="link.to"
                :to="link.to"
                class="rounded-lg border border-default p-4 transition hover:border-primary/60 hover:bg-accented"
              >
                <div class="flex items-start gap-3">
                  <UIcon
                    :name="link.icon"
                    class="mt-0.5 size-5 text-primary"
                  />
                  <div class="min-w-0 space-y-1">
                    <p class="font-medium">
                      {{ link.label }}
                    </p>
                    <p class="text-sm text-muted">
                      {{ link.description }}
                    </p>
                  </div>
                </div>
              </NuxtLink>
            </div>
            <div
              v-else
              class="py-8 text-center text-sm text-muted"
            >
              暂无快捷入口
            </div>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center justify-between gap-3">
                <span class="font-semibold">采集中绩效周期</span>
                <NuxtLink
                  to="/performance-cycles"
                  class="text-sm text-primary hover:underline"
                >
                  查看全部
                </NuxtLink>
              </div>
            </template>

            <div class="overflow-x-auto">
              <UTable
                :data="displayCycles"
                :columns="cycleColumns"
              />
            </div>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">近期任职变更</span>
              <NuxtLink
                to="/assignments"
                class="text-sm text-primary hover:underline"
              >
                查看任职变更
              </NuxtLink>
            </div>
          </template>

          <div class="overflow-x-auto">
            <UTable
              :data="displayAssignments"
              :columns="assignmentColumns"
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
