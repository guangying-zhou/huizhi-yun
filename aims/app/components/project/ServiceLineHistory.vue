<script setup lang="ts">
import type { AimsProject } from '~/types/aims'

interface ServiceLineItem {
  id: number
  project_code?: string
  name: string
  lifecycle_status?: string
  service_period_seq?: number
  service_period_start?: string
  service_period_end?: string
  service_period_label?: string
  total_work_items?: number
  completed_work_items?: number
  total_hours?: number
}

interface ServiceLineHistoryResponse {
  serviceLineCode: string
  items: ServiceLineItem[]
  cumulative: {
    projectCount: number
    totalWorkItems: number
    completedWorkItems: number
    totalHours: number
    slaTicketCount: number
    slaMetCount: number
    slaAchievementRate: number
  }
}

const props = defineProps<{ project: AimsProject }>()
const history = ref<ServiceLineHistoryResponse | null>(null)
const loading = ref(false)

async function loadHistory() {
  if (!props.project.serviceLineCode) return
  loading.value = true
  try {
    const response = await $fetch<{ code: number, data: ServiceLineHistoryResponse }>(
      `/api/v1/service-lines/${encodeURIComponent(props.project.serviceLineCode)}`
    )
    history.value = response.code === 0 ? response.data : null
  } catch {
    history.value = null
  } finally {
    loading.value = false
  }
}

watch(() => props.project.serviceLineCode, () => void loadHistory(), { immediate: true })

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}
</script>

<template>
  <UCard v-if="project.serviceLineCode">
    <template #header>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-history" class="size-4 text-primary" />
          <span class="font-semibold">服务链历史</span>
          <UBadge color="neutral" variant="subtle" size="xs">
            {{ project.serviceLineCode }}
          </UBadge>
        </div>
        <span v-if="history" class="text-xs text-muted">共 {{ history.cumulative.projectCount }} 个服务年度</span>
      </div>
    </template>

    <div v-if="loading" class="flex justify-center py-6">
      <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
    </div>
    <div v-else-if="history" class="space-y-4">
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div class="rounded-lg bg-elevated/50 p-3">
          <p class="text-xs text-muted">
            累计工作项
          </p>
          <p class="mt-1 text-xl font-semibold">
            {{ history.cumulative.completedWorkItems }}/{{ history.cumulative.totalWorkItems }}
          </p>
        </div>
        <div class="rounded-lg bg-elevated/50 p-3">
          <p class="text-xs text-muted">
            累计确认工时
          </p>
          <p class="mt-1 text-xl font-semibold">
            {{ history.cumulative.totalHours.toFixed(1) }}h
          </p>
        </div>
        <div class="rounded-lg bg-elevated/50 p-3">
          <p class="text-xs text-muted">
            SLA 达成率
          </p>
          <p class="mt-1 text-xl font-semibold">
            {{ history.cumulative.slaTicketCount ? percent(history.cumulative.slaAchievementRate) : '-' }}
          </p>
        </div>
        <div class="rounded-lg bg-elevated/50 p-3">
          <p class="text-xs text-muted">
            当前年度
          </p>
          <p class="mt-1 truncate text-sm font-semibold">
            {{ project.servicePeriodLabel || '-' }}
          </p>
        </div>
      </div>

      <div class="flex gap-3 overflow-x-auto pb-1">
        <NuxtLink
          v-for="item in history.items"
          :key="item.id"
          :to="`/projects/${item.id}`"
          class="min-w-48 rounded-lg border p-3 transition-colors hover:border-primary"
          :class="item.id === project.id ? 'border-primary bg-primary/5' : 'border-default'"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium">{{ item.service_period_label || `第 ${item.service_period_seq} 年` }}</span>
            <UBadge
              v-if="item.id === project.id"
              color="primary"
              variant="subtle"
              size="xs"
            >当前</UBadge>
          </div>
          <p class="mt-1 truncate text-xs text-muted">{{ item.name }}</p>
          <p class="mt-2 text-xs text-muted">{{ item.service_period_start }} — {{ item.service_period_end }}</p>
        </NuxtLink>
      </div>
    </div>
    <p v-else class="py-4 text-sm text-muted">
      服务链历史暂不可用。
    </p>
  </UCard>
</template>
