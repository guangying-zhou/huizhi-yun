<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

usePageTitle('任务详情')

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
    [key: string]: unknown
  }
}

interface TaskInfo {
  id: number
  instance_id: number
  node_index: number
  node_name: string
  assignee_uid: string
  task_type: string
  status: string
  due_at: string | null
  completed_at: string | null
  created_at: string
}

interface InstanceInfo {
  id: number
  instance_no: string
  resource_code: string
  action_code: string
  action_name: string | null
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

interface TaskDetail {
  task: TaskInfo
  instance: InstanceInfo
  tasks: TaskInfo[]
  actions: ActionRecord[]
}

interface RuntimeInstanceConflictPrincipal {
  kind: string
  uid: string
  matchesActor: boolean
}

interface RuntimeInstanceConflictExplanation {
  requested: {
    appCode: string
    resourceCode: string
    action: string
  }
  principals: RuntimeInstanceConflictPrincipal[]
  hasViolation: boolean
  hasBlockingViolation: boolean
  hasWarningViolation: boolean
  rules: Array<{
    ruleCode?: string
    ruleName?: string
    enforcement?: string
    status?: string
    reasonCode?: string
    message?: string
    counterpart?: {
      permission?: {
        appCode?: string
        resourceCode?: string
        action?: string
      }
    }
    requested?: {
      permission?: {
        appCode?: string
        resourceCode?: string
        action?: string
      }
    }
  }>
}

interface WorkflowInstanceConflictExplainData {
  targetType: 'task'
  taskId: string
  instanceId: string
  instanceNo: string
  action: 'approve' | 'reject' | 'delegate'
  principals: Array<{
    kind: string
    uid: string
  }>
  explanation: RuntimeInstanceConflictExplanation
  title?: string | null
}

const route = useRoute()
const toast = useToast()
const { user: authUser } = useAuth()

const taskId = computed(() => route.params.id as string)

const loading = ref(true)
const detail = ref<TaskDetail | null>(null)
const comment = ref('')
const approving = ref(false)
const rejecting = ref(false)
const conflictModalOpen = ref(false)
const conflictLoading = ref(false)
const conflictResult = ref<WorkflowInstanceConflictExplainData | null>(null)

const task = computed(() => detail.value?.task)
const instance = computed(() => detail.value?.instance)
const flowNodes = computed(() => instance.value?.flow_snapshot?.nodes || [])

// 当前用户是否是任务的审批人且任务待处理
const canApprove = computed(() => {
  if (!task.value || !authUser.value) return false
  return task.value.assignee_uid === authUser.value && task.value.status === 'pending'
})

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
  if (!instance.value) return 'pending'
  if (instance.value.status === 'approved') return 'completed'
  if (instance.value.status === 'rejected') {
    if (nodeIndex < instance.value.current_node) return 'completed'
    if (nodeIndex === instance.value.current_node) return 'rejected'
    return 'pending'
  }
  if (nodeIndex < instance.value.current_node) return 'completed'
  if (nodeIndex === instance.value.current_node) return 'current'
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

const formEntries = computed(() => {
  if (!instance.value?.form_data) return []
  return Object.entries(instance.value.form_data).map(([key, value]) => ({
    label: key,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value ?? '-')
  }))
})

const conflictTargetLabel = computed(() => {
  const title = conflictResult.value?.title || instance.value?.biz_title || instance.value?.instance_no || ''
  return title ? `审批任务：${title}` : '审批任务职责冲突解释'
})

const conflictDecisionColor = (result: RuntimeInstanceConflictExplanation | null | undefined): 'neutral' | 'success' | 'warning' | 'error' => {
  if (!result) return 'neutral'
  if (result.hasBlockingViolation) return 'error'
  if (result.hasWarningViolation || result.hasViolation) return 'warning'
  return 'success'
}

const conflictDecisionLabel = (result: RuntimeInstanceConflictExplanation | null | undefined) => {
  if (!result) return '未解释'
  if (result.hasBlockingViolation) return '阻断风险'
  if (result.hasWarningViolation || result.hasViolation) return '预警风险'
  return '未触发'
}

const conflictRuleStatusColor = (status: unknown): 'neutral' | 'success' | 'warning' => {
  if (status === 'violated') return 'warning'
  if (status === 'satisfied') return 'success'
  return 'neutral'
}

const conflictRuleStatusLabel = (status: unknown) => {
  if (status === 'violated') return '已触发'
  if (status === 'satisfied') return '已通过'
  return '未适用'
}

const conflictPrincipalLabel = (kind: string) => {
  const labels: Record<string, string> = {
    initiator: '发起人',
    assignee: '审批人',
    actor: '操作人'
  }
  return labels[kind] || kind
}

const permissionText = (permission: { appCode?: string, resourceCode?: string, action?: string } | null | undefined) => {
  if (!permission) return '-'
  return [permission.appCode, permission.resourceCode, permission.action].filter(Boolean).join(':') || '-'
}

const loadDetail = async () => {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: TaskDetail }>(`/api/v1/tasks/${taskId.value}`)
    detail.value = res.data
  } catch (error) {
    console.error('加载任务详情失败:', error)
    toast.add({
      title: '加载失败',
      description: '无法加载任务详情',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

const openConflictExplanation = async (action: 'approve' | 'reject' | 'delegate' = 'approve') => {
  if (!task.value) {
    toast.add({
      title: '职责冲突解释失败',
      description: '任务详情尚未加载。',
      color: 'error'
    })
    return
  }

  conflictResult.value = null
  conflictModalOpen.value = true
  conflictLoading.value = true
  try {
    const response = await $fetch<{ code?: number, data?: WorkflowInstanceConflictExplainData, message?: string }>('/api/v1/authorization/instance-conflict-explain', {
      method: 'POST',
      body: {
        taskId: task.value.id,
        action
      }
    })
    if (!response.data) {
      throw new Error(response.message || '实例职责冲突解释结果为空。')
    }
    conflictResult.value = response.data
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '职责冲突解释失败',
      description: error.data?.message || error.message || '无法解释该审批任务的职责冲突',
      color: 'error'
    })
    conflictModalOpen.value = false
  } finally {
    conflictLoading.value = false
  }
}

const handleApprove = async () => {
  approving.value = true
  try {
    await $fetch(`/api/v1/tasks/${taskId.value}/approve`, {
      method: 'POST',
      body: {
        comment: comment.value || null
      }
    })
    toast.add({
      title: '操作成功',
      description: '审批已通过',
      color: 'success'
    })
    navigateTo('/tasks')
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: '操作失败',
      description: error.data?.message || '审批通过失败',
      color: 'error'
    })
  } finally {
    approving.value = false
  }
}

const handleReject = async () => {
  if (!comment.value) {
    toast.add({
      title: '请填写意见',
      description: '驳回时必须填写意见',
      color: 'warning'
    })
    return
  }

  rejecting.value = true
  try {
    await $fetch(`/api/v1/tasks/${taskId.value}/reject`, {
      method: 'POST',
      body: {
        comment: comment.value
      }
    })
    toast.add({
      title: '操作成功',
      description: '已驳回',
      color: 'success'
    })
    navigateTo('/tasks')
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: '操作失败',
      description: error.data?.message || '驳回失败',
      color: 'error'
    })
  } finally {
    rejecting.value = false
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
          @click="navigateTo('/tasks')"
        >
          返回任务列表
        </UButton>
      </template>
      <template #center>
        <div v-if="instance" class="flex items-center gap-3">
          <h1 class="text-lg font-semibold truncate">
            {{ instance.biz_title }}
          </h1>
          <UBadge color="info" variant="subtle">
            {{ instance.action_name || instance.action_code }}
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
                <span class="font-mono">{{ instance?.instance_no }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-(--ui-text-muted)">发起人</span>
                <span class="font-medium">{{ instance?.initiator_uid }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-(--ui-text-muted)">提交时间</span>
                <span>{{ formatDateTime(instance?.created_at || null) }}</span>
              </div>
              <div v-if="instance?.biz_url" class="flex justify-between">
                <span class="text-(--ui-text-muted)">关联链接</span>
                <UButton
                  variant="link"
                  color="primary"
                  size="xs"
                  :href="instance.biz_url"
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
          <UCard v-if="instance?.attachments && instance.attachments.length > 0">
            <template #header>
              <h3 class="font-semibold flex items-center gap-2">
                <UIcon name="i-lucide-paperclip" />
                附件
              </h3>
            </template>

            <div class="space-y-2">
              <div
                v-for="(att, idx) in instance.attachments"
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
                    <span class="text-(--ui-text-muted)">{{ formatDateTime(action.created_at) }}</span>
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
                  <!-- 当前节点任务状态 -->
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

          <!-- 审批操作 -->
          <UCard v-if="canApprove">
            <template #header>
              <div class="flex items-center justify-between gap-3">
                <h3 class="font-semibold flex items-center gap-2">
                  <UIcon name="i-lucide-pen-line" />
                  审批操作
                </h3>
                <UButton
                  icon="i-lucide-shield-question"
                  color="info"
                  variant="soft"
                  size="xs"
                  :loading="conflictLoading"
                  @click="openConflictExplanation('approve')"
                >
                  职责冲突解释
                </UButton>
              </div>
            </template>

            <div class="space-y-4">
              <UTextarea
                v-model="comment"
                placeholder="请填写审批意见（驳回时必填）"
                :rows="4"
              />

              <div class="flex gap-3">
                <UButton
                  class="flex-1"
                  color="error"
                  variant="outline"
                  icon="i-lucide-x"
                  :loading="rejecting"
                  :disabled="approving"
                  @click="handleReject"
                >
                  驳回
                </UButton>
                <UButton
                  class="flex-1"
                  color="primary"
                  icon="i-lucide-check"
                  :loading="approving"
                  :disabled="rejecting"
                  @click="handleApprove"
                >
                  通过
                </UButton>
              </div>
            </div>
          </UCard>

          <!-- 任务已处理提示 -->
          <UCard v-else-if="task && task.status === 'completed'">
            <div class="flex flex-col items-center py-4 text-center">
              <UIcon name="i-lucide-check-circle-2" class="text-4xl text-success mb-2" />
              <p class="text-sm font-medium">
                您已处理此任务
              </p>
              <p class="text-xs text-(--ui-text-muted) mt-1">
                处理时间：{{ formatDateTime(task.completed_at) }}
              </p>
            </div>
          </UCard>
        </div>
      </div>
    </div>

    <UModal
      v-model:open="conflictModalOpen"
      title="职责冲突解释"
      :description="conflictTargetLabel"
      :ui="{ content: 'sm:max-w-3xl' }"
    >
      <template #body>
        <div
          v-if="conflictLoading"
          class="flex min-h-36 items-center justify-center gap-2 text-sm text-muted"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-4 animate-spin"
          />
          正在解释职责冲突...
        </div>

        <div
          v-else-if="conflictResult"
          class="space-y-4"
        >
          <UAlert
            :color="conflictDecisionColor(conflictResult.explanation)"
            variant="soft"
            icon="i-lucide-shield-alert"
            :title="conflictDecisionLabel(conflictResult.explanation)"
            :description="`${conflictResult.explanation.requested.appCode}:${conflictResult.explanation.requested.resourceCode}:${conflictResult.explanation.requested.action}`"
          />

          <div class="rounded-lg border border-default bg-muted px-4 py-3">
            <div class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="principal in conflictResult.explanation.principals"
                :key="`${principal.kind}:${principal.uid}`"
                :color="principal.matchesActor ? 'warning' : 'neutral'"
                variant="soft"
                class="font-mono"
              >
                {{ conflictPrincipalLabel(principal.kind) }}={{ principal.uid }}
              </UBadge>
              <span
                v-if="conflictResult.explanation.principals.length === 0"
                class="text-sm text-muted"
              >
                当前审批任务没有可解释的职责主体。
              </span>
            </div>
          </div>

          <div
            v-if="conflictResult.explanation.rules.length > 0"
            class="grid gap-2"
          >
            <div
              v-for="rule in conflictResult.explanation.rules"
              :key="String(rule.ruleCode || rule.ruleName)"
              class="rounded-lg border border-default bg-default px-4 py-3"
            >
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-semibold text-highlighted">
                  {{ rule.ruleName || rule.ruleCode }}
                </p>
                <UBadge
                  :color="conflictRuleStatusColor(rule.status)"
                  variant="soft"
                >
                  {{ conflictRuleStatusLabel(rule.status) }}
                </UBadge>
                <UBadge
                  :color="rule.enforcement === 'enforce' ? 'error' : 'warning'"
                  variant="soft"
                >
                  {{ rule.enforcement || 'warning' }}
                </UBadge>
              </div>
              <p class="mt-2 text-sm text-muted">
                {{ rule.message || rule.reasonCode || '未返回解释消息' }}
              </p>
              <p class="mt-2 font-mono text-xs text-muted">
                {{ permissionText(rule.counterpart?.permission) }}
                /
                {{ permissionText(rule.requested?.permission) }}
              </p>
            </div>
          </div>

          <div
            v-else
            class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
          >
            当前审批任务未命中 active 职责冲突规则。
          </div>
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
