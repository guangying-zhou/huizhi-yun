<script setup lang="ts">
import type { AimsProject } from '~/types/aims'

const props = defineProps<{
  project: AimsProject & {
    memberCount?: number
    milestoneProgress?: number
    leaderName?: string
  }
}>()

const lifecycleStatusConfig: Record<string, { label: string, color: string }> = {
  draft: { label: '草稿', color: 'neutral' },
  approval_pending: { label: '审批中', color: 'warning' },
  active: { label: '进行中', color: 'success' },
  paused: { label: '已暂停', color: 'warning' },
  completed: { label: '已完成', color: 'primary' },
  archived: { label: '已归档', color: 'neutral' }
}

const categoryConfig: Record<string, string> = {
  product_dev: '产品研发',
  custom_dev: '定制开发',
  delivery: '交付实施',
  maintenance: '运维保障',
  sales: '销售',
  presales: '售前',
  improvement: '改进优化',
  compliance: '合规审计'
}

const statusCfg = computed(() => lifecycleStatusConfig[props.project.lifecycleStatus] || { label: props.project.lifecycleStatus, color: 'neutral' })
const categoryLabel = computed(() => categoryConfig[props.project.category] || props.project.category)
const progress = computed(() => props.project.milestoneProgress ?? 0)
</script>

<template>
  <UCard class="hover:ring-1 hover:ring-(--ui-border-accented) transition-shadow cursor-pointer">
    <div class="flex flex-col gap-3">
      <!-- 头部：名称 + 状态 -->
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-(--ui-text) truncate">
            {{ project.name }}
          </p>
          <p class="text-xs text-(--ui-text-dimmed) mt-0.5">
            {{ project.projectCode }}
          </p>
        </div>
        <UBadge
          :color="(statusCfg.color as any)"
          variant="subtle"
          size="sm"
        >
          {{ statusCfg.label }}
        </UBadge>
      </div>

      <!-- 分类 -->
      <div class="flex items-center gap-2">
        <UBadge color="neutral" variant="outline" size="xs">
          {{ categoryLabel }}
        </UBadge>
      </div>

      <!-- 里程碑进度 -->
      <div v-if="progress > 0" class="flex flex-col gap-1">
        <div class="flex items-center justify-between text-xs">
          <span class="text-(--ui-text-dimmed)">里程碑进度</span>
          <span class="font-medium">{{ progress }}%</span>
        </div>
        <div class="h-1 w-full rounded-full bg-(--ui-bg-accented)">
          <div
            class="h-full rounded-full bg-(--ui-primary) transition-all"
            :style="{ width: `${progress}%` }"
          />
        </div>
      </div>

      <!-- 底部：成员数 + 负责人 -->
      <div class="flex items-center justify-between text-xs text-(--ui-text-dimmed) pt-1 border-t border-(--ui-border)">
        <div class="flex items-center gap-1">
          <UIcon name="i-lucide-users" class="size-3" />
          <span>{{ project.memberCount ?? 0 }} 人</span>
        </div>
        <div v-if="project.leaderName" class="flex items-center gap-1">
          <UIcon name="i-lucide-user" class="size-3" />
          <span>{{ project.leaderName }}</span>
        </div>
      </div>
    </div>
  </UCard>
</template>
