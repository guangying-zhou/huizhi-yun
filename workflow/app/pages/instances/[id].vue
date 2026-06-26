<script setup lang="ts">
import { format } from 'date-fns'

definePageMeta({
  layout: 'default'
})

usePageTitle('流程详情')

interface FlowNode {
  name: string
  type?: string
  assignees?: unknown[]
  resolved_assignees?: { uid: string, name: string }[]
  skip_when?: unknown
  [key: string]: unknown
}

interface FlowSnapshot {
  nodes: FlowNode[]
  config?: {
    reject_strategy?: string
    allow_resubmit?: boolean
    [key: string]: unknown
  }
}

interface TaskInfo {
  id: number
  node_index: number
  node_name: string
  assignee_uid: string
  task_type: string
  status: string
  due_at: string | null
  completed_at: string | null
  created_at: string
}

interface ActionRecord {
  id: number
  task_id: number
  actor_uid: string
  action: string
  comment: string | null
  attachments: unknown
  created_at: string
}

interface InstanceDetail {
  id: number
  instance_no: string
  resource_code: string
  action_code: string
  biz_id: string
  biz_title: string
  biz_url: string | null
  biz_context: Record<string, unknown>
  form_data: Record<string, unknown>
  attachments: { name: string, url: string }[] | null
  initiator_uid: string
  status: string
  current_node: number
  flow_snapshot: FlowSnapshot
  completed_at: string | null
  created_at: string
  updated_at: string
  tasks: TaskInfo[]
  actions: ActionRecord[]
}

const route = useRoute()
const toast = useToast()
const { user: authUser } = useAuth()

const instanceId = computed(() => route.params.id as string)

const loading = ref(true)
const detail = ref<InstanceDetail | null>(null)
const resubmitting = ref(false)

const flowNodes = computed(() => detail.value?.flow_snapshot?.nodes || [])

const canResubmit = computed(() => {
  if (!detail.value || !authUser.value) return false
  if (detail.value.status !== 'rejected') return false
  if (detail.value.initiator_uid !== authUser.value) return false
  const config = detail.value.flow_snapshot?.config
  if (config?.allow_resubmit === false) return false
  return true
})

const formEntries = computed(() => {
  if (!detail.value?.form_data) return []
  return Object.entries(detail.value.form_data).map(([key, value]) => ({
    label: key,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value ?? '-')
  }))
})

const formatDate = (date: string | null) => {
  if (!date) return '-'
  return format(new Date(date), 'yyyy-MM-dd HH:mm')
}

const getStatusColor = (status: string): 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' => {
  const colors: Record<string, 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'> = {
    running: 'warning',
    approved: 'success',
    rejected: 'error',
    cancelled: 'neutral'
  }
  return colors[status] || 'neutral'
}

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    running: '进行中',
    approved: '已通过',
    rejected: '已驳回',
    cancelled: '已取消'
  }
  return labels[status] || status
}

const getActionLabel = (action: string) => {
  const labels: Record<string, string> = {
    approve: '通过',
    reject: '驳回',
    submit: '提交',
    resubmit: '重新提交',
    delegate: '转办',
    cancel: '取消'
  }
  return labels[action] || action
}

const getActionColor = (action: string): 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' => {
  const colors: Record<string, 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'> = {
    approve: 'success',
    reject: 'error',
    submit: 'primary',
    resubmit: 'info',
    delegate: 'warning',
    cancel: 'neutral'
  }
  return colors[action] || 'neutral'
}

const getNodeStatus = (nodeIndex: number) => {
  if (!detail.value) return 'pending'
  if (detail.value.status === 'approved') return 'completed'
  if (detail.value.status === 'rejected') {
    if (nodeIndex < detail.value.current_node) return 'completed'
    if (nodeIndex === detail.value.current_node) return 'rejected'
    return 'pending'
  }
  if (nodeIndex < detail.value.current_node) return 'completed'
  if (nodeIndex === detail.value.current_node) return 'current'
  return 'pending'
}

const getNodeIcon = (status: string) => {
  switch (status) {
    case 'completed': return 'i-lucide-check-circle'
    case 'current': return 'i-lucide-circle-dot'
    case 'rejected': return 'i-lucide-x-circle'
    default: return 'i-lucide-circle'
  }
}

const getNodeIconColor = (status: string) => {
  switch (status) {
    case 'completed': return 'text-success'
    case 'current': return 'text-primary'
    case 'rejected': return 'text-error'
    default: return 'text-(--ui-text-dimmed)'
  }
}

const loadDetail = async () => {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: InstanceDetail }>(`/api/v1/instances/${instanceId.value}`)
    detail.value = res.data
  } catch (error) {
    console.error('加载流程详情失败:', error)
    toast.add({
      title: '加载失败',
      description: '无法加载流程详情',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

const handleResubmit = async () => {
  resubmitting.value = true
  try {
    await $fetch(`/api/v1/instances/${instanceId.value}/resubmit`, {
      method: 'POST',
      body: {
        form_data: detail.value?.form_data,
        comment: '重新提交'
      }
    })
    toast.add({
      title: '操作成功',
      description: '已重新提交',
      color: 'success'
    })
    await loadDetail()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: '操作失败',
      description: error.data?.message || '重新提交失败',
      color: 'error'
    })
  } finally {
    resubmitting.value = false
  }
}

onMounted(() => {
  loadDetail()
})
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar>
      <template #left>
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          @click="navigateTo('/instances')"
        >
          返回流程列表
        </UButton>
      </template>
      <template #center>
        <div v-if="detail" class="flex items-center gap-3">
          <h1 class="text-lg font-semibold truncate">
            {{ detail.biz_title }}
          </h1>
          <UBadge :color="getStatusColor(detail.status)">
            {{ getStatusLabel(detail.status) }}
          </UBadge>
        </div>
      </template>
    </UDashboardNavbar>

    <div class="flex-1 overflow-hidden p-4">
      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="animate-spin text-3xl" />
      </div>

      <div v-else-if="detail" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- 左侧：申请信息 -->
        <div class="lg:col-span-2 space-y-4">
          <!-- 基本信息 -->
          <UCard>
            <template #header>
              <h3 class="font-semibold flex items-center gap-2">
                <UIcon name="i-lucide-file-text" />
                申请信息
              </h3>
            </template>

            <div class="space-y-3 text-sm">
              <div class="flex justify-between">
                <span class="text-(--ui-text-muted)">流程编号</span>
                <span class="font-mono">{{ detail.instance_no }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-(--ui-text-muted)">发起人</span>
                <span class="font-medium">{{ detail.initiator_uid }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-(--ui-text-muted)">发起时间</span>
                <span>{{ formatDate(detail.created_at) }}</span>
              </div>
              <div v-if="detail.completed_at" class="flex justify-between">
                <span class="text-(--ui-text-muted)">完成时间</span>
                <span>{{ formatDate(detail.completed_at) }}</span>
              </div>
              <div v-if="detail.biz_url" class="flex justify-between">
                <span class="text-(--ui-text-muted)">关联链接</span>
                <UButton
                  variant="link"
                  color="primary"
                  size="xs"
                  :href="detail.biz_url"
                  target="_blank"
                  trailing-icon="i-lucide-external-link"
                >
                  查看
                </UButton>
              </div>
            </div>
          </UCard>

          <!-- 表单数据 -->
          <UCard v-if="formEntries.length > 0">
            <template #header>
              <h3 class="font-semibold flex items-center gap-2">
                <UIcon name="i-lucide-clipboard-list" />
                表单内容
              </h3>
            </template>

            <div class="space-y-3 text-sm">
              <div v-for="entry in formEntries" :key="entry.label" class="flex justify-between gap-4">
                <span class="text-(--ui-text-muted) shrink-0">{{ entry.label }}</span>
                <span class="text-right break-all">{{ entry.value }}</span>
              </div>
            </div>
          </UCard>

          <!-- 附件 -->
          <UCard v-if="detail.attachments && detail.attachments.length > 0">
            <template #header>
              <h3 class="font-semibold flex items-center gap-2">
                <UIcon name="i-lucide-paperclip" />
                附件
              </h3>
            </template>

            <div class="space-y-2">
              <div
                v-for="(att, idx) in detail.attachments"
                :key="idx"
                class="flex items-center gap-2 text-sm"
              >
                <UIcon name="i-lucide-file" class="text-(--ui-text-muted)" />
                <a
                  :href="att.url"
                  target="_blank"
                  class="text-primary hover:underline"
                >
                  {{ att.name }}
                </a>
              </div>
            </div>
          </UCard>

          <!-- 操作记录 -->
          <UCard v-if="detail.actions.length > 0">
            <template #header>
              <h3 class="font-semibold flex items-center gap-2">
                <UIcon name="i-lucide-history" />
                操作记录
              </h3>
            </template>

            <div class="space-y-4">
              <div
                v-for="action in detail.actions"
                :key="action.id"
                class="flex items-start gap-3 text-sm"
              >
                <UBadge :color="getActionColor(action.action)" variant="subtle" class="shrink-0 mt-0.5">
                  {{ getActionLabel(action.action) }}
                </UBadge>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-medium">{{ action.actor_uid }}</span>
                    <span class="text-(--ui-text-muted)">{{ formatDate(action.created_at) }}</span>
                  </div>
                  <p v-if="action.comment" class="mt-1 text-(--ui-text-muted) whitespace-pre-wrap">
                    {{ action.comment }}
                  </p>
                </div>
              </div>
            </div>
          </UCard>
        </div>

        <!-- 右侧 -->
        <div class="space-y-4">
          <!-- 审批进度 -->
          <UCard>
            <template #header>
              <h3 class="font-semibold flex items-center gap-2">
                <UIcon name="i-lucide-git-branch" />
                审批进度
              </h3>
            </template>

            <div class="space-y-0">
              <div
                v-for="(node, idx) in flowNodes"
                :key="idx"
                class="flex items-start gap-3 relative"
                :class="{ 'pb-4': idx < flowNodes.length - 1 }"
              >
                <!-- 连接线 -->
                <div
                  v-if="idx < flowNodes.length - 1"
                  class="absolute left-[11px] top-[24px] w-0.5 h-[calc(100%-12px)]"
                  :class="getNodeStatus(idx) === 'completed' ? 'bg-success' : 'bg-(--ui-border)'"
                />
                <!-- 图标 -->
                <UIcon
                  :name="getNodeIcon(getNodeStatus(idx))"
                  class="text-xl shrink-0 z-10 bg-(--ui-bg)"
                  :class="getNodeIconColor(getNodeStatus(idx))"
                />
                <!-- 节点信息 -->
                <div class="flex-1 min-w-0 pb-1">
                  <div class="font-medium text-sm">
                    {{ node.name }}
                  </div>
                  <div v-if="node.resolved_assignees?.length" class="text-xs text-(--ui-text-muted) mt-0.5">
                    {{ node.resolved_assignees.map(a => a.name || a.uid).join('、') }}
                  </div>
                  <div v-if="getNodeStatus(idx) === 'current'" class="mt-1">
                    <UBadge color="warning" variant="subtle" size="xs">
                      待审批
                    </UBadge>
                  </div>
                  <div v-else-if="getNodeStatus(idx) === 'rejected'" class="mt-1">
                    <UBadge color="error" variant="subtle" size="xs">
                      已驳回
                    </UBadge>
                  </div>
                </div>
              </div>
            </div>
          </UCard>

          <!-- 状态与操作 -->
          <UCard>
            <template #header>
              <h3 class="font-semibold">
                流程状态
              </h3>
            </template>

            <div class="flex flex-col items-center py-2 text-center">
              <UBadge :color="getStatusColor(detail.status)" size="lg">
                {{ getStatusLabel(detail.status) }}
              </UBadge>
              <p v-if="detail.completed_at" class="text-xs text-(--ui-text-muted) mt-2">
                完成于 {{ formatDate(detail.completed_at) }}
              </p>
            </div>

            <!-- 重新提交按钮 -->
            <div v-if="canResubmit" class="mt-4">
              <UButton
                block
                color="primary"
                icon="i-lucide-refresh-cw"
                :loading="resubmitting"
                @click="handleResubmit"
              >
                重新提交
              </UButton>
            </div>
          </UCard>
        </div>
      </div>
    </div>
  </UDashboardPanel>
</template>
