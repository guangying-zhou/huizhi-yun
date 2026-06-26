<script setup lang="ts">
interface TaskImpact {
  id: number
  itemKey: string
  title: string
  status: string
  assigneeUid: string | null
  type: string
  impactCategory: 'safe_to_update' | 'user_choice' | 'force_change_request'
}

const props = defineProps<{
  reqId: number
}>()

const emit = defineEmits<{
  resolved: [actions: TaskAction[]]
}>()

interface TaskAction {
  taskId: number
  action: 'direct_update' | 'change_request'
  crMilestoneId?: number
  crAssigneeUid?: string
}

const loading = ref(true)
const tasks = ref<TaskImpact[]>([])
const recommendation = ref('')
const actions = ref<Map<number, string>>(new Map())

async function fetchImpact() {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: { linkedTasks: TaskImpact[], recommendation: string } }>(
      `/api/v1/requirements/${props.reqId}/change-impact`
    )
    if (res.code === 0) {
      tasks.value = res.data.linkedTasks
      recommendation.value = res.data.recommendation

      for (const t of tasks.value) {
        if (t.impactCategory === 'safe_to_update') {
          actions.value.set(t.id, 'direct_update')
        } else if (t.impactCategory === 'force_change_request') {
          actions.value.set(t.id, 'change_request')
        }
      }
      emitResolved()
    }
  } finally {
    loading.value = false
  }
}

onMounted(fetchImpact)

function setAction(taskId: number, action: string) {
  actions.value.set(taskId, action)
  emitResolved()
}

const allResolved = computed(() => {
  return tasks.value.every(t => actions.value.has(t.id))
})

function emitResolved() {
  if (!allResolved.value) return
  const result: TaskAction[] = []
  for (const [taskId, action] of actions.value) {
    result.push({ taskId, action: action as 'direct_update' | 'change_request' })
  }
  emit('resolved', result)
}

const impactLabel: Record<string, string> = {
  safe_to_update: '可直接更新',
  user_choice: '请选择处理方式',
  force_change_request: '需生成变更任务'
}

const impactColor: Record<string, string> = {
  safe_to_update: 'success',
  user_choice: 'warning',
  force_change_request: 'error'
}

const taskStatusLabel: Record<string, string> = {
  planning: '计划中',
  todo: '待办',
  in_progress: '进行中',
  in_review: '评审中',
  completed: '已完成'
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-2 text-sm font-semibold">
      <UIcon
        name="i-lucide-alert-triangle"
        class="size-4 text-warning"
      />
      关联任务影响分析
    </div>

    <div
      v-if="loading"
      class="flex justify-center py-4"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="w-5 h-5 animate-spin text-muted"
      />
    </div>

    <div
      v-else-if="tasks.length === 0"
      class="text-sm text-muted py-4 text-center"
    >
      该需求尚未关联任务，可直接变更
    </div>

    <div
      v-else
      class="space-y-2"
    >
      <div
        v-for="task in tasks"
        :key="task.id"
        class="p-3 rounded-lg border border-default space-y-2"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs text-muted">{{ task.itemKey }}</span>
            <span class="text-sm font-medium">{{ task.title }}</span>
          </div>
          <UBadge
            :color="(impactColor[task.impactCategory] as any)"
            variant="subtle"
            size="xs"
          >
            {{ impactLabel[task.impactCategory] }}
          </UBadge>
        </div>

        <div class="flex items-center gap-3 text-xs text-muted">
          <span>状态: {{ taskStatusLabel[task.status] || task.status }}</span>
          <span v-if="task.assigneeUid">指派: {{ task.assigneeUid }}</span>
        </div>

        <!-- User choice -->
        <div
          v-if="task.impactCategory === 'user_choice'"
          class="flex items-center gap-3 pt-1"
        >
          <label class="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              :name="`task-${task.id}`"
              :checked="actions.get(task.id) === 'direct_update'"
              @change="setAction(task.id, 'direct_update')"
            >
            直接更新并通知负责人
          </label>
          <label class="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              :name="`task-${task.id}`"
              :checked="actions.get(task.id) === 'change_request'"
              @change="setAction(task.id, 'change_request')"
            >
            生成变更任务
          </label>
        </div>

        <!-- Forced labels -->
        <div
          v-else
          class="text-xs"
          :class="task.impactCategory === 'safe_to_update' ? 'text-success' : 'text-warning'"
        >
          {{ task.impactCategory === 'safe_to_update' ? '✓ 将直接同步更新任务' : '⚠ 将自动生成变更任务' }}
        </div>
      </div>

      <div
        v-if="!allResolved"
        class="text-xs text-warning flex items-center gap-1"
      >
        <UIcon
          name="i-lucide-info"
          class="size-3"
        />
        请为所有任务选择处理方式后才能提交
      </div>
    </div>
  </div>
</template>
