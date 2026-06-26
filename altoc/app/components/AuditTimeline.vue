<script setup lang="ts">
/**
 * 审计时间线组件
 * 展示指定业务实体的操作历史（创建/更新/状态变更/审批/删除）
 *
 * Usage:
 *   <AuditTimeline entity-type="opportunity" :entity-id="id" />
 */
const props = defineProps<{
  entityType: string
  entityId: number | string
  limit?: number
}>()

interface AuditLogItem {
  id: number
  entity_type: string
  entity_id: number
  action: 'create' | 'update' | 'delete' | 'status_change' | 'approve' | 'reject'
  old_value: any
  new_value: any
  operator_id: string
  operator_name: string | null
  created_at: string
}

const { data, status, refresh } = useFetch('/api/v1/audit-logs', {
  query: computed(() => ({
    entity_type: props.entityType,
    entity_id: props.entityId,
    limit: props.limit || 50
  })),
  transform: (res: any) => (res.data?.items || []) as AuditLogItem[]
})

defineExpose({ refresh })

const items = computed(() => data.value || [])

function getActionMeta(action: AuditLogItem['action']) {
  switch (action) {
    case 'create': return { label: '创建', color: 'success', icon: 'i-lucide-plus-circle' }
    case 'update': return { label: '更新', color: 'info', icon: 'i-lucide-pencil' }
    case 'status_change': return { label: '状态变更', color: 'primary', icon: 'i-lucide-git-branch' }
    case 'approve': return { label: '审批通过', color: 'success', icon: 'i-lucide-check-circle' }
    case 'reject': return { label: '已驳回', color: 'error', icon: 'i-lucide-x-circle' }
    case 'delete': return { label: '删除', color: 'error', icon: 'i-lucide-trash-2' }
    default: return { label: action, color: 'neutral', icon: 'i-lucide-circle' }
  }
}

function formatTime(val: string | null | undefined) {
  if (!val) return '--'
  const d = new Date(val)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(d)
}

function parseJson(val: any): Record<string, any> | null {
  if (val == null) return null
  if (typeof val === 'object') return val
  try {
    return JSON.parse(val)
  } catch {
    return null
  }
}

function summarize(item: AuditLogItem): string[] {
  const lines: string[] = []
  const oldV = parseJson(item.old_value)
  const newV = parseJson(item.new_value)

  if (item.action === 'create' && newV) {
    // 只展示 2-4 个有意义的字段
    const keys = Object.keys(newV).slice(0, 4)
    for (const k of keys) {
      const v = newV[k]
      if (v != null && v !== '') lines.push(`${k}: ${String(v)}`)
    }
  } else if (item.action === 'delete' && oldV) {
    const keys = Object.keys(oldV).slice(0, 3)
    for (const k of keys) lines.push(`${k}: ${String(oldV[k])}`)
  } else if (newV && oldV) {
    // 只展示真正变更的字段
    for (const k of Object.keys(newV)) {
      const nv = newV[k]
      const ov = oldV[k]
      if (nv == null || nv === '') continue
      if (String(ov) !== String(nv)) {
        lines.push(`${k}: ${ov ?? '--'} → ${nv}`)
      }
    }
  } else if (newV) {
    const keys = Object.keys(newV).slice(0, 3)
    for (const k of keys) {
      const v = newV[k]
      if (v != null && v !== '') lines.push(`${k}: ${String(v)}`)
    }
  }

  return lines.slice(0, 5)
}
</script>

<template>
  <div>
    <div v-if="status === 'pending'" class="py-6 text-center text-sm text-muted">
      加载中...
    </div>
    <div v-else-if="!items.length" class="py-8 text-center">
      <UIcon name="i-lucide-history" class="size-8 text-muted mx-auto mb-2" />
      <p class="text-sm text-muted">
        暂无操作记录
      </p>
    </div>
    <ol v-else class="relative border-l-2 border-default ml-2 space-y-4">
      <li
        v-for="item in items"
        :key="item.id"
        class="ml-4"
      >
        <!-- 圆点标记 -->
        <span
          class="absolute -left-[9px] flex size-4 items-center justify-center rounded-full bg-default ring-2 ring-default"
        >
          <UIcon
            :name="getActionMeta(item.action).icon"
            class="size-3"
            :class="`text-${getActionMeta(item.action).color}`"
          />
        </span>

        <div class="flex items-baseline gap-2 flex-wrap">
          <UBadge
            :label="getActionMeta(item.action).label"
            :color="getActionMeta(item.action).color as any"
            variant="subtle"
            size="sm"
          />
          <span class="text-sm font-medium text-highlighted">
            <UserName :uid="item.operator_id" />
          </span>
          <span class="text-xs text-muted tabular-nums">{{ formatTime(item.created_at) }}</span>
        </div>

        <ul
          v-if="summarize(item).length"
          class="mt-1.5 text-xs text-muted space-y-0.5 pl-1"
        >
          <li
            v-for="(line, i) in summarize(item)"
            :key="i"
            class="font-mono"
          >
            {{ line }}
          </li>
        </ul>
      </li>
    </ol>
  </div>
</template>
