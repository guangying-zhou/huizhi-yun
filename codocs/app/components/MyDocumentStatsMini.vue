<script setup lang="ts">
interface StatsResponse {
  code: number
  data: {
    myDocumentCount: number
    myTotalSize: number
    allDocumentCount: number
    allTotalSize: number
    countRatio: number
    sizeRatio: number
  }
}

defineProps<{
  collapsed?: boolean
}>()

const { data, pending } = await useFetch<StatsResponse>('/api/documents/stats/my', {
  key: 'my-document-stats-mini',
  server: false,
  default: () => ({
    code: 0,
    data: {
      myDocumentCount: 0,
      myTotalSize: 0,
      allDocumentCount: 0,
      allTotalSize: 0,
      countRatio: 0,
      sizeRatio: 0
    }
  })
})

const stats = computed(() => data.value.data)

const formatSize = (bytes: number) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

const formatPercent = (ratio: number) => {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0%'
  const value = ratio * 100
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`
}

const displayText = computed(() =>
  `${stats.value.myDocumentCount} · ${formatSize(stats.value.myTotalSize)}（${formatPercent(stats.value.sizeRatio)}）`
)
</script>

<template>
  <div
    class="px-3 pb-1.5"
    :class="collapsed ? 'flex justify-center px-0.5' : ''"
  >
    <div
      class="flex min-h-8 items-center rounded-lg text-xs text-muted"
      :class="collapsed ? 'w-9 justify-center px-0' : 'w-full gap-1.5 px-2'"
      :title="displayText"
    >
      <template v-if="pending">
        <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-dimmed" />
        <span v-if="!collapsed" class="truncate">统计中...</span>
      </template>
      <template v-else-if="collapsed">
        <UIcon name="i-lucide-files" class="size-4 text-dimmed" />
      </template>
      <template v-else>
        <UIcon name="i-lucide-files" class="size-4 shrink-0 text-dimmed" />
        <span class="font-medium text-default">{{ stats.myDocumentCount }}</span>
        <span>·</span>
        <UIcon name="i-lucide-hard-drive" class="size-4 shrink-0 text-dimmed" />
        <span class="truncate">{{ formatSize(stats.myTotalSize) }}（{{ formatPercent(stats.sizeRatio) }}）</span>
      </template>
    </div>
  </div>
</template>
