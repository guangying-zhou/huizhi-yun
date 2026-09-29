<script setup lang="ts">
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'
import { useAimsModule } from '../useAimsModule'

type WeeklyReport = Record<string, unknown> & {
  id: number
  entries?: Array<Record<string, unknown>>
  workItems?: Array<Record<string, unknown>>
}
type PeriodPayload = Record<string, unknown> & {
  report?: WeeklyReport | null
}
const route = useRoute()
const { moduleUrl } = useAimsModule()
const projectId = computed(() => String(route.params.id || ''))
const periodKey = computed(() => String(route.params.periodKey || ''))
const payload = ref<PeriodPayload | null>(null)
const loading = ref(true)
const error = ref('')
const report = computed(() => payload.value?.report || null)
function value(...keys: string[]) {
  for (const key of keys) {
    const current = report.value?.[key] ?? payload.value?.[key]
    if (current !== undefined && current !== null && String(current).trim())
      return String(current)
  }
  return '-'
}
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{
      code?: number
      data?: PeriodPayload
    }>(moduleUrl(`/api/v1/projects/${projectId.value}/weekly-reports/${periodKey.value}`))
    if (response.code !== 0 || !response.data)
      throw Error('周报详情暂不可用')
    payload.value = response.data
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '周报详情暂不可用'
  } finally {
    loading.value = false
  }
}
watch([projectId, periodKey], refresh)
onMounted(refresh)
</script>

<template>
  <UDashboardPanel id="enterprise-project-weekly-report-detail" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar>
          <template #actions>
            <UButton
              aria-label="刷新"
              icon="i-lucide-refresh-cw"
              variant="ghost"
              color="neutral"
              size="sm"
              square
              :loading="loading"
              @click="refresh"
            />
          </template>
        </ProjectNavbar>
        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-4 sm:px-6">
          <section class="space-y-5">
            <div>
              <div>
                <UButton
                  :to="moduleUrl(`/projects/${projectId}/weekly-reports`)"
                  variant="link"
                  color="neutral"
                  size="sm"
                  icon="i-lucide-arrow-left"
                >
                  周报列表
                </UButton>
                <h2 class="mt-1 text-xl font-semibold text-highlighted">
                  {{ periodKey }}
                </h2>
                <p class="mt-1 text-sm text-muted">
                  周报详情
                </p>
              </div>
            </div>
            <UAlert
              v-if="error"
              color="error"
              icon="i-lucide-circle-alert"
              title="无法读取周报"
              :description="error"
            />
            <USkeleton v-else-if="loading" class="h-64 w-full" />
            <CommonEmptyState
              v-else-if="!report"
              icon="i-lucide-notebook-tabs"
              title="本周期暂无周报"
              description="该项目在此周期没有已保存的周报。"
            />
            <template v-else>
              <UCard>
                <dl class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt class="text-sm text-muted">
                      状态
                    </dt><dd class="mt-1 font-medium">
                      {{ value('status') }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-sm text-muted">
                      周期
                    </dt><dd class="mt-1 font-medium">
                      {{ value('weekStart') }} 至 {{ value('weekEnd') }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-sm text-muted">
                      锁定工时
                    </dt><dd class="mt-1 font-medium">
                      {{ value('totalHours') }} 小时
                    </dd>
                  </div>
                  <div>
                    <dt class="text-sm text-muted">
                      当前版本
                    </dt><dd class="mt-1 font-medium">
                      {{ value('currentVersionNo') }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-sm text-muted">
                      进度
                    </dt><dd class="mt-1 font-medium">
                      {{ value('completionPercent') }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-sm text-muted">
                      项目阶段
                    </dt><dd class="mt-1 font-medium">
                      {{ value('currentStage') }}
                    </dd>
                  </div>
                </dl>
              </UCard>
              <UCard>
                <template #header>
                  <h2 class="font-semibold">
                    主要工作
                  </h2>
                </template><p class="whitespace-pre-wrap text-sm">
                  {{ value('mainWork') }}
                </p>
              </UCard>
              <UCard>
                <template #header>
                  <h2 class="font-semibold">
                    风险与协同
                  </h2>
                </template><p class="whitespace-pre-wrap text-sm">
                  {{ value('majorRisks') }}
                </p><p class="mt-3 whitespace-pre-wrap text-sm">
                  {{ value('coordinationNeeds') }}
                </p>
              </UCard>
              <UCard>
                <template #header>
                  <h2 class="font-semibold">
                    冻结工时明细
                  </h2>
                </template>
                <UTable
                  :data="report.entries || []"
                  :columns="[
                    { accessorKey: 'uid', header: '人员' }, { accessorKey: 'hours', header: '工时' }, { accessorKey: 'allocationPercent', header: '投入比例' }
                  ]"
                  :loading="loading"
                >
                  <template #empty>
                    <CommonEmptyState title="暂无记录" description="当前范围内没有可显示的记录。" />
                  </template>
                </UTable>
              </UCard>
            </template>
          </section>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
