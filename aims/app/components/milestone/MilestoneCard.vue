<script setup lang="ts">
import type { Milestone, PivrStage } from '~/types/aims'
import { pivrPhases, milestoneStatusConfig } from '~/config/milestone'

const props = defineProps<{
  milestone: Milestone
}>()

const pivrCfg = computed(() => {
  if (props.milestone.pivrStage) {
    return pivrPhases[props.milestone.pivrStage as PivrStage]
  }
  return null
})

const statusCfg = computed(() => milestoneStatusConfig[props.milestone.status] || { label: props.milestone.status, color: 'neutral' })

const progress = computed(() => props.milestone.progress ?? 0)

function formatDate(date: string | null): string {
  if (!date) return '--'
  return date.slice(0, 10)
}
</script>

<template>
  <UCard class="hover:ring-1 hover:ring-(--ui-border-accented) transition-shadow">
    <div class="flex flex-col gap-3">
      <!-- 头部：PIVR 标签 + 状态 -->
      <div class="flex items-center justify-between">
        <UBadge
          v-if="pivrCfg"
          :color="(pivrCfg.color as any)"
          variant="subtle"
          size="sm"
        >
          <UIcon :name="pivrCfg.icon" class="size-3" />
          {{ milestone.pivrStage }} - {{ pivrCfg.label }}
        </UBadge>
        <UBadge
          :color="(statusCfg.color as any)"
          variant="subtle"
          size="sm"
        >
          {{ statusCfg.label }}
        </UBadge>
      </div>

      <!-- 名称 -->
      <p class="text-sm font-medium text-(--ui-text)">
        {{ milestone.name }}
      </p>

      <!-- 日期 -->
      <div class="flex items-center gap-2 text-xs text-(--ui-text-dimmed)">
        <UIcon name="i-lucide-calendar" class="size-3" />
        <span>{{ formatDate(milestone.startDate) }} ~ {{ formatDate(milestone.endDate) }}</span>
      </div>

      <!-- 进度条 -->
      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between text-xs">
          <span class="text-(--ui-text-dimmed)">进度</span>
          <span class="font-medium">{{ progress }}%</span>
        </div>
        <div class="h-1.5 w-full rounded-full bg-(--ui-bg-accented)">
          <div
            class="h-full rounded-full bg-(--ui-primary) transition-all"
            :style="{ width: `${progress}%` }"
          />
        </div>
      </div>
    </div>
  </UCard>
</template>
