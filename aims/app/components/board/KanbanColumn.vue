<script setup lang="ts">
import type { WorkItem } from '~/types/aims'

defineProps<{
  title: string
  color: string
  items: WorkItem[]
  status: string
}>()

defineEmits<{
  'card-click': [item: WorkItem]
}>()
</script>

<template>
  <div class="flex flex-col min-w-64 max-w-80 bg-(--ui-bg-elevated) rounded-lg">
    <!-- 列头 -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-(--ui-border)">
      <div class="flex items-center gap-2">
        <span
          class="size-2 rounded-full"
          :class="`bg-(--ui-${color})`"
        />
        <span class="text-sm font-medium text-(--ui-text)">{{ title }}</span>
      </div>
      <span class="text-xs text-(--ui-text-dimmed) bg-(--ui-bg-accented) px-1.5 py-0.5 rounded-full">
        {{ items.length }}
      </span>
    </div>

    <!-- 卡片列表 -->
    <div class="flex flex-col gap-2 p-2 overflow-y-auto max-h-[calc(100vh-16rem)]">
      <BoardKanbanCard
        v-for="item in items"
        :key="item.id"
        :item="item"
        @click="$emit('card-click', item)"
      />
      <CommonEmptyState
        v-if="items.length === 0"
        icon="i-lucide-inbox"
        title="暂无工作项"
        description=""
      />
    </div>
  </div>
</template>
