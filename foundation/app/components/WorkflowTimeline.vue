<script setup lang="ts">
import type { WorkflowAction, WorkflowSnapshotNode, WorkflowTask } from '../types/workflow'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useAccountStore } from '../stores/account'

const props = defineProps<{
  /** 流程快照节点 */
  nodes: WorkflowSnapshotNode[]
  /** 审批动作记录 */
  actions: WorkflowAction[]
  /** 任务记录 */
  tasks?: WorkflowTask[]
  /** 当前节点索引 */
  currentNode: number
  /** 流程状态 */
  status: string
}>()

const accountStore = useAccountStore()

function getActionLabel(action: string) {
  const map: Record<string, string> = {
    submit: '提交',
    approve: '通过',
    reject: '驳回',
    delegate: '转办',
    cancel: '撤销',
    resubmit: '重新提交',
    remind: '催办'
  }
  return map[action] || action
}

function getActionColor(action: string) {
  const map: Record<string, string> = {
    submit: 'info',
    approve: 'success',
    reject: 'error',
    delegate: 'warning',
    cancel: 'neutral',
    resubmit: 'info',
    remind: 'warning'
  }
  return map[action] || 'neutral'
}

function formatTime(dateStr: string) {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: zhCN })
  } catch {
    return dateStr
  }
}

function getUserName(uid: string) {
  const user = accountStore.getUserByUid(uid)
  return user?.realName || user?.nickname || uid
}

function getActionNodeIndex(action: WorkflowAction) {
  if (typeof action.node_index === 'number') {
    return action.node_index
  }

  if (action.task_id && props.tasks?.length) {
    const relatedTask = props.tasks.find(task => task.id === action.task_id)
    if (relatedTask) {
      return relatedTask.node_index
    }
  }

  return null
}

function toTimestamp(dateStr: string | null | undefined) {
  if (!dateStr) return 0
  return new Date(dateStr).getTime()
}

const taskById = computed(() => {
  const map = new Map<number, WorkflowTask>()
  for (const task of props.tasks || []) {
    map.set(task.id, task)
  }
  return map
})

const resubmitActions = computed(() => {
  return [...props.actions]
    .filter(action => action.action === 'resubmit')
    .sort((a, b) => toTimestamp(a.created_at) - toTimestamp(b.created_at))
})

const currentRoundIndex = computed(() => resubmitActions.value.length)

function getRoundIndexByTime(dateStr: string | null | undefined) {
  const ts = toTimestamp(dateStr)
  let roundIndex = 0
  for (const action of resubmitActions.value) {
    if (ts >= toTimestamp(action.created_at)) {
      roundIndex++
    }
  }
  return roundIndex
}

function getTaskRoundIndex(task: WorkflowTask) {
  return getRoundIndexByTime(task.created_at)
}

function getActionRoundIndex(action: WorkflowAction) {
  if (action.action === 'resubmit') {
    return getRoundIndexByTime(action.created_at)
  }

  if (action.task_id) {
    const task = taskById.value.get(action.task_id)
    if (task) {
      return getTaskRoundIndex(task)
    }
  }

  return getRoundIndexByTime(action.created_at)
}

type TimelineNodeStatus = 'approved' | 'running' | 'rejected' | 'pending'

const timelineRounds = computed(() => {
  const roundCount = resubmitActions.value.length + 1

  return Array.from({ length: roundCount }, (_, roundIndex) => {
    const isCurrentRound = roundIndex === currentRoundIndex.value
    const startAction = roundIndex > 0 ? resubmitActions.value[roundIndex - 1] : null
    const roundTasks = (props.tasks || []).filter(task => getTaskRoundIndex(task) === roundIndex)
    const roundActions = props.actions.filter(action => getActionRoundIndex(action) === roundIndex && action.action !== 'resubmit')

    const nodes = props.nodes.map((node, nodeIndex) => {
      const nodeTasks = roundTasks.filter(task => task.node_index === nodeIndex)
      const nodeActions = roundActions.filter(action => getActionNodeIndex(action) === nodeIndex)
      const approvedAction = [...nodeActions]
        .filter(action => action.action === 'approve')
        .sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at))[0]
      const rejectAction = [...nodeActions]
        .filter(action => action.action === 'reject')
        .sort((a, b) => toTimestamp(b.created_at) - toTimestamp(a.created_at))[0]
      const completedTask = [...nodeTasks]
        .filter(task => task.status === 'completed' && task.completed_at)
        .sort((a, b) => toTimestamp(b.completed_at) - toTimestamp(a.completed_at))[0]

      let status: TimelineNodeStatus = 'pending'
      if (rejectAction) {
        status = 'rejected'
      } else if (approvedAction || completedTask || (isCurrentRound && (nodeIndex < props.currentNode || (props.status === 'approved' && nodeIndex === props.currentNode)))) {
        status = 'approved'
      } else if (isCurrentRound && props.status === 'running' && nodeIndex === props.currentNode) {
        status = 'running'
      }

      return {
        ...node,
        roundIndex,
        index: nodeIndex,
        status,
        approvedTime: rejectAction ? null : (approvedAction?.created_at || completedTask?.completed_at || null),
        rejectTime: rejectAction?.created_at || null,
        rejectComment: rejectAction?.comment || null,
        extraActions: nodeActions.filter(action => action.action !== 'approve' && action.action !== 'reject')
      }
    })

    const rejectedNodeIndex = nodes.findIndex(node => node.status === 'rejected')
    const visibleNodes = rejectedNodeIndex >= 0
      ? nodes.slice(0, rejectedNodeIndex + 1)
      : nodes

    return {
      key: `round-${roundIndex}`,
      roundIndex,
      startedAt: startAction?.created_at || null,
      nodes: visibleNodes
    }
  })
})

// 预加载涉及到的用户信息
onMounted(() => {
  const uids = new Set<string>()
  for (const node of props.nodes) {
    for (const assignee of node.resolved_assignees || []) {
      uids.add(assignee.uid)
    }
  }
  for (const action of props.actions) {
    uids.add(action.actor_uid)
  }
  if (uids.size > 0) {
    accountStore.fetchUsersBatch(Array.from(uids)).catch(() => {})
  }
})
</script>

<template>
  <div class="space-y-4">
    <template v-for="round in timelineRounds" :key="round.key">
      <div
        v-if="round.roundIndex > 0 && round.startedAt"
        class="flex items-center gap-2 pb-1"
      >
        <USeparator class="flex-1" />
        <UBadge color="primary" variant="subtle" size="xs">
          重新提交
        </UBadge>
        <span class="shrink-0 text-[11px] text-dimmed">
          {{ formatTime(round.startedAt) }}
        </span>
      </div>

      <div
        v-for="node in round.nodes"
        :key="`${round.key}-${node.index}`"
        class="relative pl-6 pb-4"
      >
        <div
          v-if="node.index < round.nodes.length - 1"
          class="absolute left-[9px] top-5 bottom-0 w-px"
          :class="node.status === 'approved' ? 'bg-success' : 'bg-default'"
        />

        <div
          class="absolute left-0 top-1 flex size-[18px] items-center justify-center rounded-full border-2"
          :class="{
            'border-success bg-success text-white': node.status === 'approved',
            'border-primary bg-primary text-white': node.status === 'running',
            'border-error bg-error text-white': node.status === 'rejected',
            'border-default bg-default': node.status === 'pending'
          }"
        >
          <UIcon
            v-if="node.status === 'approved'"
            name="i-lucide-check"
            class="size-3"
          />
          <UIcon
            v-else-if="node.status === 'rejected'"
            name="i-lucide-x"
            class="size-3"
          />
          <span v-else class="text-[10px] font-medium">{{ node.index + 1 }}</span>
        </div>

        <div class="min-w-0 text-sm font-medium" :class="node.status === 'running' ? 'text-primary' : node.status !== 'pending' ? 'text-highlighted' : 'text-muted'">
          {{ node.name }}
        </div>

        <div v-if="node.resolved_assignees?.length" class="mt-1 text-xs text-dimmed">
          <span
            v-for="(assignee, aIdx) in node.resolved_assignees"
            :key="assignee.uid"
          >
            {{ getUserName(assignee.uid) }}<span v-if="aIdx < node.resolved_assignees.length - 1">、</span>
          </span>
        </div>

        <p
          v-if="node.approvedTime"
          class="mt-1 text-[11px] text-dimmed"
        >
          {{ formatTime(node.approvedTime) }}
        </p>

        <p
          v-if="node.rejectTime"
          class="mt-1 text-[11px] text-dimmed"
        >
          {{ formatTime(node.rejectTime) }}
        </p>

        <p
          v-if="node.rejectComment"
          class="mt-1 text-xs text-error whitespace-pre-wrap"
        >
          驳回意见：{{ node.rejectComment }}
        </p>

        <div
          v-for="action in node.extraActions"
          :key="`${action.action}-${action.created_at}`"
          class="mt-2 rounded-lg bg-elevated/50 px-3 py-2 text-xs"
        >
          <div class="flex items-center gap-2">
            <UBadge :color="getActionColor(action.action) as any" variant="subtle" size="xs">
              {{ getActionLabel(action.action) }}
            </UBadge>
            <span class="font-medium">{{ getUserName(action.actor_uid) }}</span>
            <span class="text-dimmed">{{ formatTime(action.created_at) }}</span>
          </div>
          <p v-if="action.comment" class="mt-1 whitespace-pre-wrap text-muted">
            {{ action.comment }}
          </p>
        </div>
      </div>
    </template>
  </div>
</template>
