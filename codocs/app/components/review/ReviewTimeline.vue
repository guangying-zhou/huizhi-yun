<template>
  <div class="review-timeline space-y-4">
    <div v-for="(action, index) in sortedActions" :key="index" class="flex gap-3">
      <!-- 图标 -->
      <div class="shrink-0">
        <div
          :class="[
            'w-8 h-8 rounded-full flex items-center justify-center',
            getActionColor(action.action)
          ]"
        >
          <UIcon :name="getActionIcon(action.action)" class="text-white" />
        </div>
      </div>

      <!-- 内容 -->
      <div class="flex-1 pb-4 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ (action.actor_real_name && action.actor_real_name.trim()) || action.actor_uid }}</span>
            <UBadge :color="getActionBadgeColor(action.action)" size="xs">
              {{ getActionLabel(action.action) }}
            </UBadge>
          </div>
          <span class="text-sm text-gray-500">
            {{ formatTime(action.created_at) }}
          </span>
        </div>

        <div class="text-sm text-gray-600 dark:text-gray-400">
          节点：{{ getNodeName(action.node_index) }}
        </div>

        <div v-if="action.comment" class="mt-2 text-sm">
          {{ action.comment }}
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!actions || actions.length === 0" class="text-center py-8 text-gray-500">
      <UIcon name="i-lucide-clock" class="text-3xl mb-2" />
      <p>暂无操作记录</p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface ReviewActionRecord {
  node_index: number
  actor_uid: string
  actor_real_name?: string | null
  action: string
  comment?: string | null
  created_at: string
}

interface ReviewFlowNode {
  index: number
  name: string
}

const props = defineProps<{
  actions: ReviewActionRecord[]
  flowSnapshot: ReviewFlowNode[]
}>()

// 按时间倒序排列
const sortedActions = computed(() => {
  if (!props.actions) return []
  return [...props.actions].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
})

// 获取操作图标
const getActionIcon = (action: string) => {
  const icons: Record<string, string> = {
    approve: 'i-lucide-check',
    reject: 'i-lucide-x',
    remind: 'i-lucide-bell'
  }
  return icons[action] || 'i-lucide-circle'
}

// 获取操作颜色
const getActionColor = (action: string) => {
  const colors: Record<string, string> = {
    approve: 'bg-green-500',
    reject: 'bg-red-500',
    remind: 'bg-blue-500'
  }
  return colors[action] || 'bg-gray-500'
}

type BadgeColor = 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'

// 获取操作标签颜色
const getActionBadgeColor = (action: string): BadgeColor => {
  const colors: Record<string, BadgeColor> = {
    approve: 'success',
    reject: 'error',
    remind: 'info'
  }
  return colors[action] || 'neutral'
}

// 获取操作标签
const getActionLabel = (action: string) => {
  const labels: Record<string, string> = {
    approve: '通过',
    reject: '驳回',
    remind: '提醒'
  }
  return labels[action] || action
}

// 获取节点名称
const getNodeName = (nodeIndex: number) => {
  const node = props.flowSnapshot?.find(n => n.index === nodeIndex)
  return node?.name || `节点${nodeIndex + 1}`
}

// 格式化时间
const formatTime = (time: string) => {
  const date = new Date(time)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // 1分钟内
  if (diff < 60000) {
    return '刚刚'
  }
  // 1小时内
  if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`
  }
  // 24小时内
  if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`
  }
  // 超过24小时
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>
