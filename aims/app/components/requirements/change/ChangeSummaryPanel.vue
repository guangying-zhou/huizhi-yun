<script setup lang="ts">
interface VersionSnapshot {
  title: string
  type: string
  priority: string
  source: string
  milestone_id: number | null
}

const props = defineProps<{
  current: {
    title: string
    type: string
    priority: string
    source: string
    milestoneId: number | null
    milestoneName: string | null
  }
  previousSnapshot: VersionSnapshot | null
}>()

interface DiffItem {
  field: string
  label: string
  oldValue: string
  newValue: string
}

const diffs = computed<DiffItem[]>(() => {
  if (!props.previousSnapshot) return []
  const result: DiffItem[] = []
  const prev = props.previousSnapshot
  const cur = props.current

  if (prev.title !== cur.title) {
    result.push({ field: 'title', label: '标题', oldValue: prev.title, newValue: cur.title })
  }
  if (prev.priority !== cur.priority) {
    result.push({ field: 'priority', label: '优先级', oldValue: prev.priority, newValue: cur.priority })
  }
  if (prev.source !== cur.source) {
    result.push({ field: 'source', label: '来源', oldValue: sourceLabel(prev.source), newValue: sourceLabel(cur.source) })
  }
  if (prev.type !== cur.type) {
    result.push({ field: 'type', label: '类型', oldValue: typeLabel(prev.type), newValue: typeLabel(cur.type) })
  }

  return result
})

function sourceLabel(v: string) {
  const map: Record<string, string> = { customer: '客户', internal: '内部', compliance: '合规', regulation: '法规', other: '其他' }
  return map[v] || v
}

function typeLabel(v: string) {
  return v === 'functional' ? '功能需求' : '非功能需求'
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 text-sm font-semibold">
      <UIcon
        name="i-lucide-diff"
        class="size-4 text-info"
      />
      变更摘要
    </div>

    <div
      v-if="diffs.length === 0"
      class="text-sm text-muted py-2"
    >
      暂无字段变更
    </div>

    <div
      v-else
      class="space-y-2"
    >
      <div
        v-for="d in diffs"
        :key="d.field"
        class="flex items-center gap-3 text-sm p-2 rounded bg-elevated"
      >
        <span class="text-muted w-16 shrink-0">{{ d.label }}</span>
        <span class="line-through text-error/70">{{ d.oldValue }}</span>
        <UIcon
          name="i-lucide-arrow-right"
          class="size-3 text-muted"
        />
        <span class="font-medium text-success">{{ d.newValue }}</span>
      </div>
    </div>
  </div>
</template>
