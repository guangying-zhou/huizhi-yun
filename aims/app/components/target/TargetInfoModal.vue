<script setup lang="ts">
/**
 * 目标只读信息弹窗 — 用于 in_progress / in_review / completed 列卡片点击
 *
 * 只展示信息，不提供编辑入口。后续可扩展完成进度、工时统计等。
 */
import type { WorkItem } from '~/types/aims'
import {
  getStatusColor,
  getStatusLabel,
  priorityConfig,
  reviewLevelLabel,
  deliverableTypeLabel,
  deliverableTypeIcon
} from '~/config/work-item'

interface DeliverableItem {
  id: number
  name: string
  description: string | null
  acceptanceCriteria: string | null
  deliverableType: string
  required: boolean
  status: string
}

interface ChildTask {
  id: number
  itemKey: string
  title: string
  status: string
  assigneeUid: string | null
  assigneeName?: string | null
  estimatedHours: number | null
  startDate: string | null
  dueDate: string | null
}

const props = defineProps<{
  open: boolean
  workItem: WorkItem | null
}>()

defineEmits<{
  'update:open': [value: boolean]
}>()

const deliverables = ref<DeliverableItem[]>([])
const children = ref<ChildTask[]>([])
const loading = ref(false)

const { users: accountUsers } = useAccountUsers()
const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const user of accountUsers.value) {
    if (user.realName?.trim()) {
      map.set(user.uid, user.realName.trim())
    }
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '未指派'
  return userNameMap.value.get(uid) || uid
}

async function loadDeliverables(workItemId: number) {
  try {
    const res = await $fetch<{ code: number, data: DeliverableItem[] }>(
      '/api/v1/deliverables',
      { params: { entity_type: 'work_item', entity_id: workItemId } }
    )
    if (res.code === 0) {
      deliverables.value = res.data
    }
  } catch {
    deliverables.value = []
  }
}

async function loadChildren(workItemId: number) {
  try {
    const res = await $fetch<{ code: number, data: ChildTask[] }>(
      `/api/v1/work-items/${workItemId}/children`
    )
    if (res.code === 0) {
      children.value = res.data
    }
  } catch {
    children.value = []
  }
}

async function loadAll(workItemId: number) {
  loading.value = true
  try {
    await Promise.all([loadDeliverables(workItemId), loadChildren(workItemId)])
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.open, props.workItem?.id] as const,
  async ([open, id]) => {
    if (open && id) {
      await loadAll(id as number)
    }
  },
  { immediate: true }
)

/** "追加任务"按钮是否可见：仅目标在执行中/待审视/已完成时允许追加（草稿/规划/已归档不开放） */
const canAppend = computed(() => {
  if (!props.workItem) return false
  return ['in_progress', 'in_review'].includes(props.workItem.status)
})

function gotoAppend() {
  if (!props.workItem) return
  const wi = props.workItem
  navigateTo(`/projects/${wi.projectId}/work-items/${wi.id}/breakdown`)
}

const reviewLevel = computed(() => {
  if (!props.workItem) return null
  return (props.workItem as WorkItem & { reviewLevel?: number }).reviewLevel ?? null
})

const priorityInfo = computed(() => {
  if (!props.workItem) return null
  return priorityConfig[props.workItem.priority as keyof typeof priorityConfig] || null
})

const totalTaskCount = computed(() => children.value.length)
const completedTaskCount = computed(() =>
  children.value.filter(c => c.status === 'completed').length
)
const allTasksCompleted = computed(() =>
  totalTaskCount.value > 0 && completedTaskCount.value === totalTaskCount.value
)
</script>

<template>
  <UModal
    :open="open"
    :ui="{ content: 'sm:max-w-3xl' }"
    @update:open="$emit('update:open', $event)"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-info" class="size-5 text-primary" />
        <h3 class="text-lg font-semibold">
          {{ workItem?.itemKey }} · {{ workItem?.title }}
        </h3>
      </div>
    </template>

    <template #body>
      <div v-if="workItem" class="p-4 space-y-4">
        <!-- 状态 & 优先级 -->
        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            :color="(getStatusColor(workItem.status) as any)"
            variant="subtle"
          >
            {{ getStatusLabel(workItem.status) }}
          </UBadge>
          <UBadge
            v-if="priorityInfo"
            :color="(priorityInfo.color as any)"
            variant="soft"
          >
            {{ priorityInfo.label }}
          </UBadge>
          <UBadge v-if="reviewLevel !== null" color="neutral" variant="subtle">
            评审：{{ reviewLevelLabel[reviewLevel] || '一般' }}
          </UBadge>
        </div>

        <!-- 基本信息 -->
        <div class="grid gap-3 md:grid-cols-5">
          <div class="rounded-lg border border-default bg-elevated/30 px-3 py-2">
            <div class="text-xs uppercase tracking-wide text-dimmed">
              里程碑
            </div>
            <div class="mt-1 text-sm font-medium truncate">
              {{ workItem.milestoneName || '-' }}
            </div>
          </div>
          <div class="rounded-lg border border-default bg-elevated/30 px-3 py-2">
            <div class="text-xs uppercase tracking-wide text-dimmed">
              控制工时
            </div>
            <div class="mt-1 text-sm font-medium">
              {{ workItem.estimatedHours || '-' }}h
            </div>
          </div>
          <div class="rounded-lg border border-default bg-elevated/30 px-3 py-2">
            <div class="text-xs uppercase tracking-wide text-dimmed">
              开始日期
            </div>
            <div class="mt-1 text-sm font-medium">
              {{ workItem.startDate ? workItem.startDate.slice(0, 10) : '-' }}
            </div>
          </div>
          <div class="rounded-lg border border-default bg-elevated/30 px-3 py-2">
            <div class="text-xs uppercase tracking-wide text-dimmed">
              结束日期
            </div>
            <div class="mt-1 text-sm font-medium">
              {{ workItem.dueDate ? workItem.dueDate.slice(0, 10) : '-' }}
            </div>
          </div>
          <div class="rounded-lg border border-default bg-elevated/30 px-3 py-2">
            <div class="text-xs uppercase tracking-wide text-dimmed">
              任务完成
            </div>
            <div class="mt-1 flex items-center gap-2">
              <span class="text-sm font-medium">
                {{ completedTaskCount }} / {{ totalTaskCount }}
              </span>
              <UBadge
                v-if="allTasksCompleted"
                color="success"
                variant="subtle"
                size="xs"
              >
                全部完成
              </UBadge>
            </div>
          </div>
        </div>

        <MarkdownContent
          v-if="workItem.description"
          :markdown="workItem.description"
          class="rounded-md bg-elevated/40 p-3 text-sm"
        />

        <!-- 成果要求 -->
        <div class="rounded-lg border border-default p-3 space-y-2">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-clipboard-check" class="size-4 text-primary" />
            <span class="text-sm font-medium">成果要求</span>
            <span class="text-xs text-muted">{{ deliverables.length }} 条</span>
          </div>
          <div v-if="loading" class="text-center text-sm text-muted py-3">
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin inline" />
          </div>
          <div v-else-if="deliverables.length === 0" class="text-center text-sm text-muted py-3">
            无成果要求
          </div>
          <div
            v-for="d in deliverables"
            :key="d.id"
            class="rounded-md border border-default p-2"
          >
            <div class="flex items-center gap-2">
              <UIcon
                :name="deliverableTypeIcon[d.deliverableType] || 'i-lucide-pocket-knife'"
                class="size-4 text-muted shrink-0"
              />
              <span class="font-medium text-sm truncate">{{ d.name }}</span>
              <UBadge variant="subtle" color="neutral" size="xs">
                {{ deliverableTypeLabel[d.deliverableType] || d.deliverableType }}
              </UBadge>
            </div>
            <div v-if="d.description" class="ml-6 mt-1 text-xs text-muted whitespace-pre-wrap">
              {{ d.description }}
            </div>
            <div v-if="d.acceptanceCriteria" class="ml-6 mt-1 text-xs text-muted">
              验收标准：{{ d.acceptanceCriteria }}
            </div>
          </div>
        </div>

        <!-- 已分配任务 -->
        <div class="rounded-lg border border-default p-3 space-y-2">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-list-checks" class="size-4 text-primary" />
            <span class="text-sm font-medium">已分配任务</span>
            <span class="text-xs text-muted">{{ children.length }} 项</span>
          </div>
          <div v-if="loading" class="text-center text-sm text-muted py-3">
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin inline" />
          </div>
          <div v-else-if="children.length === 0" class="text-center text-sm text-muted py-3">
            暂无任务分配
          </div>
          <div
            v-for="c in children"
            :key="c.id"
            class="flex items-center gap-2 rounded-md border border-default px-2 py-1.5"
          >
            <UBadge color="neutral" variant="subtle" size="xs">
              {{ c.itemKey }}
            </UBadge>
            <span class="text-sm truncate flex-1">{{ c.title }}</span>
            <span class="text-xs text-muted shrink-0">{{ getUserName(c.assigneeUid) }}</span>
            <span v-if="c.estimatedHours" class="text-xs text-muted shrink-0">{{ c.estimatedHours }}h</span>
            <UBadge
              :color="(getStatusColor(c.status) as any)"
              variant="subtle"
              size="xs"
            >
              {{ getStatusLabel(c.status) }}
            </UBadge>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <UButton
          v-if="canAppend"
          icon="i-lucide-plus"
          label="追加任务"
          color="primary"
          variant="soft"
          @click="gotoAppend"
        />
        <div v-else />
        <UButton
          label="关闭"
          color="neutral"
          variant="soft"
          @click="$emit('update:open', false)"
        />
      </div>
    </template>
  </UModal>
</template>
