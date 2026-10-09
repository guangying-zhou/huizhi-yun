<template>
  <Handle type="target" :position="Position.Left" />
  <div
    class="px-3 py-2.5 rounded-xl border-2 bg-white dark:bg-gray-900 w-48 select-none transition-shadow"
    :class="selected
      ? 'border-primary-500 shadow-lg shadow-primary-100'
      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
  >
    <div class="flex items-center gap-1.5 mb-1.5">
      <span
        class="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0"
        :class="data.type === 'countersign'
          ? 'bg-warning-100 text-warning-700'
          : 'bg-primary-100 text-primary-700'"
      >
        {{ data.index + 1 }}
      </span>
      <span class="text-sm font-medium text-default truncate">{{ data.name }}</span>
    </div>

    <!-- 节点类型 -->
    <div class="flex items-center gap-1 text-xs text-muted mb-0.5">
      <UIcon :name="typeIcon" class="w-3 h-3 shrink-0" />
      <span>{{ typeLabel }}</span>
    </div>

    <!-- 审批人/委员会信息 -->
    <div class="flex items-center gap-1 text-xs text-dimmed">
      <UIcon name="i-lucide-users" class="w-3 h-3 shrink-0" />
      <span>{{ assigneeSummary }}</span>
    </div>

    <!-- 审批模式（会签） -->
    <div v-if="data.type === 'countersign' && modeLabel" class="flex items-center gap-1 text-xs text-info mt-0.5">
      <UIcon name="i-lucide-vote" class="w-3 h-3 shrink-0" />
      <span>{{ modeLabel }}</span>
    </div>
  </div>
  <Handle type="source" :position="Position.Right" />
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

interface AssigneeDef {
  type: string
  uid?: string
  code?: string
  scope?: string
  dept_code?: string
}

const props = defineProps<{
  data: {
    index: number
    name: string
    type: string
    approve_mode?: string
    min_pass_count?: number
    assignees: AssigneeDef[]
    skip_when?: Record<string, unknown>
  }
  selected: boolean
}>()

const ASSIGNEE_LABELS: Record<string, string> = {
  dept_manager: '部门负责人',
  dept_leader: '分管领导',
  initiator_leader: '上级领导',
  user: '指定用户',
  role: '按角色',
  initiator: '发起人'
}

const typeIcon = computed(() => {
  return props.data.type === 'countersign'
    ? 'i-lucide-users'
    : 'i-lucide-check-circle'
})

const typeLabel = computed(() => {
  return props.data.type === 'countersign' ? '会签' : '审批'
})

const assigneeSummary = computed(() => {
  const list = props.data.assignees || []
  if (list.length === 0) return '未设置'
  const a = list[0]!
  if (props.data.type === 'countersign') {
    // 会签显示委员会 dept_code
    return a.dept_code ? `委员会: ${a.dept_code}` : '未选择委员会'
  }
  return ASSIGNEE_LABELS[a.type] || a.type
})

const modeLabel = computed(() => {
  if (props.data.type !== 'countersign') return ''
  const modes: Record<string, string> = {
    all: '全签',
    majority: '多数票签（2/3）',
    half: '过半票签（1/2）',
    review: `审阅签（≥${props.data.min_pass_count || 1}人）`
  }
  return modes[props.data.approve_mode || 'all'] || ''
})
</script>
