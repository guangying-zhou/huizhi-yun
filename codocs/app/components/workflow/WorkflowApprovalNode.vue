<template>
  <Handle type="target" :position="Position.Left" />
  <div
    class="px-3 py-2.5 rounded-xl border-2 bg-white w-44 select-none transition-shadow"
    :class="selected
      ? 'border-primary-500 shadow-lg shadow-primary-100'
      : 'border-gray-200 hover:border-gray-300'"
  >
    <div class="flex items-center gap-1.5 mb-1.5">
      <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary-100 text-primary-700 text-xs font-bold shrink-0">
        {{ data.index + 1 }}
      </span>
      <span class="text-sm font-medium text-gray-900 truncate">{{ data.name }}</span>
    </div>
    <div class="flex items-center gap-1 text-xs text-gray-500 mb-0.5">
      <UIcon name="i-lucide-user" class="w-3 h-3 shrink-0" />
      <span>{{ roleLabel }}</span>
    </div>
    <div class="flex items-center gap-1 text-xs text-gray-400">
      <UIcon name="i-lucide-check-circle" class="w-3 h-3 shrink-0" />
      <span>{{ passLabel }}</span>
    </div>
  </div>
  <Handle type="source" :position="Position.Right" />
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{
  data: {
    index: number
    name: string
    role: string
    pass_type: string
    pass_count: number
    pass_total?: number
  }
  selected: boolean
}>()

const ROLE_LABELS: Record<string, string> = {
  dept_manager: '部门经理',
  supervisor: '分管领导',
  admin: '管理员'
}

const roleLabel = computed(() => ROLE_LABELS[props.data.role] ?? props.data.role)

const passLabel = computed(() => {
  if (props.data.pass_type === 'any') return '任一人通过'
  if (props.data.pass_type === 'ratio') return `${props.data.pass_count}/${props.data.pass_total ?? '?'} 人通过`
  return '全部通过'
})
</script>
