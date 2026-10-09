<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

// 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
const { moduleUrl } = useAimsModule()
interface RoutineFlow {
  beneficiaryDeptCode: string
  workItemCount: number
  hours: number
}

interface RoutineReview {
  periodStart: string
  periodEnd: string
  acceptedCount: number
  scopeDistribution: { department: number, crossDept: number }
  unplannedCount: number
  totalHours: number
  unplannedHours: number
  unplannedRatio: number
  crossDepartmentFlows: RoutineFlow[]
}

const props = defineProps<{ projectId: number }>()
const review = ref<RoutineReview | null>(null)
const loading = ref(false)

async function loadReview() {
  loading.value = true
  try {
    const response = await $fetch<{ code: number, data: RoutineReview }>(
      moduleUrl(`/api/v1/projects/${props.projectId}/routine-review`)
    )
    review.value = response.code === 0 ? response.data : null
  } catch {
    review.value = null
  } finally {
    loading.value = false
  }
}

onMounted(loadReview)

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-chart-no-axes-combined" class="size-4 text-primary" />
          <span class="font-semibold">季度回顾</span>
        </div>
        <span v-if="review" class="text-xs text-muted">{{ review.periodStart }} — {{ review.periodEnd }}</span>
      </div>
    </template>

    <div v-if="loading" class="flex justify-center py-6">
      <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
    </div>
    <div v-else-if="review" class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.25fr]">
      <div class="grid grid-cols-2 gap-2">
        <div class="rounded-lg bg-elevated/50 p-3">
          <p class="text-xs text-muted">
            承接量
          </p>
          <p class="mt-1 text-2xl font-semibold">
            {{ review.acceptedCount }}
          </p>
        </div>
        <div class="rounded-lg bg-elevated/50 p-3">
          <p class="text-xs text-muted">
            计划外占比
          </p>
          <p class="mt-1 text-2xl font-semibold">
            {{ percent(review.unplannedRatio) }}
          </p>
        </div>
        <div class="rounded-lg bg-elevated/50 p-3">
          <p class="text-xs text-muted">
            部门事务
          </p>
          <p class="mt-1 text-lg font-semibold">
            {{ review.scopeDistribution.department }}
          </p>
        </div>
        <div class="rounded-lg bg-elevated/50 p-3">
          <p class="text-xs text-muted">
            跨部门协助
          </p>
          <p class="mt-1 text-lg font-semibold">
            {{ review.scopeDistribution.crossDept }}
          </p>
        </div>
      </div>
      <div>
        <p class="mb-2 text-sm font-medium">
          跨部门工时流向
        </p>
        <div v-if="review.crossDepartmentFlows.length" class="space-y-2">
          <div
            v-for="flow in review.crossDepartmentFlows"
            :key="flow.beneficiaryDeptCode"
            class="flex items-center justify-between gap-3 rounded-lg border border-default px-3 py-2 text-sm"
          >
            <span class="truncate">{{ flow.beneficiaryDeptCode }}</span>
            <span class="shrink-0 text-muted">{{ flow.workItemCount }} 项 · {{ flow.hours.toFixed(1) }}h</span>
          </div>
        </div>
        <p v-else class="rounded-lg border border-dashed border-default py-6 text-center text-sm text-muted">
          本季度暂无跨部门确认工时
        </p>
      </div>
    </div>
    <p v-else class="py-4 text-sm text-muted">
      季度回顾暂不可用。
    </p>
  </UCard>
</template>
