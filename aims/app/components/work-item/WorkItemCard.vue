<script setup lang="ts">
import type { WorkItem, WorkItemType, Severity } from '~/types/aims'
import { typeConfig, severityConfig } from '~/config/work-item'

const props = defineProps<{
  item: WorkItem
}>()

const typeCfg = computed(() => typeConfig[props.item.type as WorkItemType])
const severityCfg = computed(() => {
  if (props.item.type === 'bug' && props.item.severity) {
    return severityConfig[props.item.severity as Severity]
  }
  return null
})
</script>

<template>
  <UCard class="hover:ring-1 hover:ring-(--ui-border-accented) transition-shadow">
    <div class="flex flex-col gap-2">
      <!-- 头部：类型图标 + 编号 -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <UIcon :name="typeCfg.icon" :class="['size-4', typeCfg.color]" />
          <span class="text-xs text-(--ui-text-dimmed)">{{ item.itemKey }}</span>
        </div>
        <WorkItemPriorityBadge :priority="item.priority" />
      </div>

      <!-- 标题 -->
      <p class="text-sm font-medium text-(--ui-text) line-clamp-2">
        {{ item.title }}
      </p>

      <!-- 类型特定信息 -->
      <div v-if="item.type === 'bug' && severityCfg" class="flex items-center gap-1">
        <UBadge :color="(severityCfg.color as any)" variant="subtle" size="xs">
          {{ severityCfg.label }}
        </UBadge>
      </div>

      <div v-if="item.type === 'task' && item.estimatedHours" class="flex items-center gap-1 text-xs text-(--ui-text-dimmed)">
        <UIcon name="i-lucide-clock" class="size-3" />
        <span>{{ item.estimatedHours }}h</span>
      </div>

      <!-- 底部：状态 + 负责人 -->
      <div class="flex items-center justify-between pt-1 border-t border-(--ui-border)">
        <WorkItemStatusBadge :status="item.status" />
        <div class="flex items-center gap-1">
          <CommonUserAvatar
            v-if="item.assigneeUid"
            :uid="item.assigneeUid"
            :name="item.assigneeName || ''"
            size="xs"
          />
          <span v-if="item.assigneeName" class="text-xs text-(--ui-text-dimmed)">
            {{ item.assigneeName }}
          </span>
        </div>
      </div>
    </div>
  </UCard>
</template>
