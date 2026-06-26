<script setup lang="ts">
/**
 * WorkflowPanel — 流程操作面板
 *
 * 三种输入模式（三选一）：
 * - task 模式：传 taskId，审批中心处理任务
 * - instance 模式：传 instanceId，查看实例详情
 * - launch 模式：传 launchPayload，发起审批（自动检测已有实例）
 */
import type {
  WorkflowTaskDetail,
  WorkflowCapabilities,
  WorkflowAction,
  WorkflowSnapshotNode,
  WorkflowLaunchPayload,
  WorkflowStatus
} from '../types/workflow'
import type { WorkflowHistoryItem } from '../composables/useWorkflow'
// fetchTaskDetail, fetchInstanceDetail, approveTask, rejectTask, fetchInstanceByBiz, prepareInstance, createInstance, fetchInstanceHistoryByBiz are auto-imported from useWorkflow

const props = defineProps<{
  taskId?: number
  instanceId?: number
  launchPayload?: WorkflowLaunchPayload
  /** launch 模式：页面是否满足提交条件 */
  canSubmit?: boolean
  /** launch 模式：完整性检查问题列表 */
  completenessIssues?: string[]
  /** launch 模式：提交前钩子 */
  beforeSubmit?: () => Promise<void>
}>()

const emit = defineEmits<{
  submitted: [payload: { instanceId: number }]
  approved: [payload: { taskId: number, instanceId: number, instanceStatus?: string }]
  rejected: [payload: { taskId: number, instanceId: number }]
  cancelled: [payload: { instanceId: number }]
  error: [payload: { message: string }]
  instanceFound: [payload: { found: boolean, status?: string }]
}>()

const loading = ref(true)
const error = ref<string | null>(null)

// 数据
const task = ref<WorkflowTaskDetail['task'] | null>(null)
const instance = ref<WorkflowTaskDetail['instance'] | null>(null)
const tasks = ref<WorkflowTaskDetail['tasks']>([])
const actions = ref<WorkflowAction[]>([])
const capabilities = ref<WorkflowCapabilities | null>(null)
const status = ref<WorkflowStatus | null>(null)
const nodes = ref<WorkflowSnapshotNode[]>([])
const currentNode = ref(0)

// launch 模式：是否处于待提交状态（无已有实例）
const isLaunchReady = ref(false)

// 审批表单
const decisionComment = ref('')
const submitting = ref(false)

// launch 模式：提交说明
const launchComment = ref('')

// 审批历史
const historyItems = ref<WorkflowHistoryItem[]>([])
const historyLoading = ref(false)
const expandedHistoryId = ref<number | null>(null)

interface WorkflowCreateResultData {
  id?: number | string | null
  instance_id?: number | string | null
  instanceId?: number | string | null
  workflow_instance_id?: number | string | null
  status?: WorkflowStatus | string | null
  data?: WorkflowCreateResultData | null
}

function resolveWorkflowCreateData(response: unknown): WorkflowCreateResultData {
  const root = response as { data?: WorkflowCreateResultData | null } | null
  const data = root?.data || {}
  return data.data || data
}

function normalizePositiveNumber(value: unknown) {
  const numeric = Number(value || 0)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0
}

const approvalTitle = computed(() => {
  if (isLaunchReady.value && props.launchPayload) {
    return props.launchPayload.actionName || props.launchPayload.bizTitle || '提交审批'
  }
  return instance.value?.action_name || props.launchPayload?.actionName || instance.value?.action_code || '审批事项'
})

function extractErrorMessage(err: unknown, fallback: string) {
  if (typeof err === 'object' && err !== null) {
    const withMessage = err as { message?: string, data?: { message?: string } }
    return withMessage.data?.message || withMessage.message || fallback
  }
  return fallback
}

async function loadData() {
  loading.value = true
  error.value = null
  isLaunchReady.value = false

  // Reset all state fields to avoid showing stale data when switching between
  // different (taskId / instanceId / launchPayload) inputs.
  instance.value = null
  task.value = null
  tasks.value = []
  actions.value = []
  capabilities.value = null
  status.value = null
  nodes.value = []
  currentNode.value = 0

  try {
    if (props.taskId) {
      const res = await fetchTaskDetail(props.taskId)
      if (res.code === 0 && res.data) {
        task.value = res.data.task
        instance.value = res.data.instance
        tasks.value = res.data.tasks
        actions.value = res.data.actions
        capabilities.value = res.data.capabilities
        status.value = res.data.instance.status
        nodes.value = res.data.instance.flow_snapshot?.nodes || []
        currentNode.value = res.data.instance.current_node
      }
    } else if (props.instanceId) {
      const res = await fetchInstanceDetail(props.instanceId)
      if (res.code === 0 && res.data) {
        instance.value = res.data
        tasks.value = res.data.tasks
        actions.value = res.data.actions
        capabilities.value = res.data.capabilities
        status.value = res.data.status
        nodes.value = res.data.flow_snapshot?.nodes || []
        currentNode.value = res.data.current_node

        // instance 模式下，查找当前用户的 pending task（用于审批操作）
        const { user } = useAuth()
        const currentUid = user.value
        if (currentUid && res.data.tasks?.length) {
          const myPendingTask = res.data.tasks.find(
            t => t.assignee_uid === currentUid && t.status === 'pending'
          )
          if (myPendingTask) {
            task.value = myPendingTask
          }
        }
      }
    } else if (props.launchPayload) {
      // launch 模式：先查是否已有实例
      try {
        const bizRes = await fetchInstanceByBiz({
          app_code: props.launchPayload.appCode,
          resource_code: props.launchPayload.resourceCode,
          biz_id: props.launchPayload.bizId,
          action_code: props.launchPayload.actionCode,
          include_history: true
        })

        if (bizRes.code === 0 && bizRes.data) {
          const data = bizRes.data
          emit('instanceFound', { found: true, status: data.status })

          // 已完结的实例（approved/cancelled）视为可重新发起
          // rejected 实例走 resubmit 流程，仍显示 instance 视图
          if (data.status === 'approved' || data.status === 'cancelled') {
            // 已完结的实例视为可重新发起
            isLaunchReady.value = true
          } else {
            // 进行中或已驳回 → 切换到 instance 视图
            instance.value = {
              id: data.instance_id,
              instance_no: data.instance_no,
              app_code: data.app_code,
              resource_code: data.resource_code,
              action_code: data.action_code,
              action_name: data.biz_title || null,
              biz_id: data.biz_id,
              biz_title: data.biz_title,
              biz_url: data.biz_url,
              initiator_uid: data.initiator_uid,
              status: data.status,
              current_node: data.current_node,
              flow_snapshot: data.flow_snapshot,
              completed_at: data.completed_at,
              created_at: data.created_at
            }
            actions.value = data.actions || []
            capabilities.value = data.capabilities || null
            status.value = data.status
            nodes.value = data.flow_snapshot?.nodes || []
            currentNode.value = data.current_node

            // 查找当前用户的 pending task
            const { user } = useAuth()
            const currentUid = user.value
            // 需要通过 instanceDetail 获取 tasks
            const existingInstanceData = data as WorkflowCreateResultData
            const existingInstanceId = normalizePositiveNumber(existingInstanceData.instance_id || existingInstanceData.id)
            try {
              if (!existingInstanceId) {
                throw new Error('Workflow 返回的实例缺少实例 ID')
              }
              const detailRes = await fetchInstanceDetail(existingInstanceId)
              if (detailRes.code === 0 && detailRes.data) {
                tasks.value = detailRes.data.tasks
                actions.value = detailRes.data.actions
                capabilities.value = detailRes.data.capabilities
                // 更新 action_name（by-biz 不返回此字段）
                if (detailRes.data.action_name && instance.value) {
                  instance.value = { ...instance.value, action_name: detailRes.data.action_name }
                }
                if (currentUid && detailRes.data.tasks?.length) {
                  const myPendingTask = detailRes.data.tasks.find(
                    t => t.assignee_uid === currentUid && t.status === 'pending'
                  )
                  if (myPendingTask) {
                    task.value = myPendingTask
                  }
                }
              }
            } catch {
              // fetchInstanceDetail 失败不影响主流程
            }
          }
        } else {
          // 无实例 → 进入待提交状态
          isLaunchReady.value = true
          emit('instanceFound', { found: false })
        }
      } catch {
        // 查询失败当作无实例处理
        isLaunchReady.value = true
      }
    }
  } catch (err: unknown) {
    error.value = extractErrorMessage(err, '加载失败')
    emit('error', { message: error.value! })
  } finally {
    loading.value = false
  }

  // launch 模式下异步加载审批历史（不阻塞主流程）
  if (props.launchPayload) {
    loadHistory()
  }
}

async function handleLaunchSubmit() {
  if (!props.launchPayload) return
  submitting.value = true
  try {
    // 1. 执行 beforeSubmit 钩子
    if (props.beforeSubmit) {
      await props.beforeSubmit()
    }

    // 2. prepare: 匹配路由
    const prepareRes = await prepareInstance({
      app_code: props.launchPayload.appCode,
      resource_code: props.launchPayload.resourceCode,
      action_code: props.launchPayload.actionCode,
      biz_id: props.launchPayload.bizId,
      biz_title: props.launchPayload.bizTitle,
      biz_url: props.launchPayload.bizUrl,
      biz_context: props.launchPayload.bizContext,
      form_data: props.launchPayload.formData
    })

    const prepareData = prepareRes.data as { action_def: { id: number }, matched_routes: Array<{ id: number }> } | null
    if (prepareRes.code !== 0 || !prepareData?.matched_routes?.length) {
      emit('error', { message: '未找到匹配的审批流程，请联系管理员配置。' })
      return
    }

    const { action_def, matched_routes } = prepareData
    const matchedRoute = matched_routes[0]!

    // 3. create instance: 发起审批
    const createRes = await createInstance({
      action_def_id: action_def.id,
      route_id: matchedRoute.id,
      biz_id: props.launchPayload.bizId,
      biz_title: props.launchPayload.bizTitle,
      biz_url: props.launchPayload.bizUrl,
      biz_context: {
        ...props.launchPayload.bizContext,
        comment: launchComment.value || undefined
      },
      form_data: props.launchPayload.formData,
      callback_url: props.launchPayload.callbackUrl
    })

    if (createRes.code === 0) {
      const createData = resolveWorkflowCreateData(createRes)
      const createdInstanceId = normalizePositiveNumber(
        createData.instance_id || createData.instanceId || createData.workflow_instance_id || createData.id
      )
      if (!createdInstanceId) {
        console.error('[WorkflowPanel] createInstance response missing instance id:', createRes)
        emit('error', { message: 'Workflow 已返回成功，但缺少实例 ID' })
        return
      }
      const createdStatus = (createData.status || 'running') as WorkflowStatus
      emit('submitted', { instanceId: createdInstanceId })
      // 自审批自动通过场景：发起即完成，直接触发 approved 事件
      if (createdStatus === 'approved') {
        emit('approved', {
          taskId: 0,
          instanceId: createdInstanceId,
          instanceStatus: createdStatus
        })
      }
      launchComment.value = ''
      // 刷新为 instance 视图
      await loadData()
    }
  } catch (err: unknown) {
    emit('error', { message: extractErrorMessage(err, '发起审批失败') })
  } finally {
    submitting.value = false
  }
}

async function handleApprove() {
  if (!task.value) {
    console.warn('[WorkflowPanel] handleApprove: task is null, taskId=', props.taskId)
    emit('error', { message: '任务数据未加载，请刷新重试' })
    return
  }
  submitting.value = true
  try {
    const res = await approveTask(task.value.id, {
      comment: decisionComment.value || undefined
    })
    if (res.code === 0) {
      emit('approved', {
        taskId: task.value.id,
        instanceId: task.value.instance_id,
        instanceStatus: res.data.instance_status
      })
      decisionComment.value = ''
      await loadData()
    }
  } catch (err: unknown) {
    emit('error', { message: extractErrorMessage(err, '审批失败') })
  } finally {
    submitting.value = false
  }
}

async function handleReject() {
  if (!task.value || !decisionComment.value.trim()) return
  submitting.value = true
  try {
    const res = await rejectTask(task.value.id, {
      comment: decisionComment.value
    })
    if (res.code === 0) {
      emit('rejected', { taskId: task.value.id, instanceId: task.value.instance_id })
      decisionComment.value = ''
      await loadData()
    }
  } catch (err: unknown) {
    emit('error', { message: extractErrorMessage(err, '驳回失败') })
  } finally {
    submitting.value = false
  }
}

/** 加载审批历史（launch 模式下调用） */
async function loadHistory() {
  if (!props.launchPayload) return
  historyLoading.value = true
  try {
    const res = await fetchInstanceHistoryByBiz({
      app_code: props.launchPayload.appCode,
      resource_code: props.launchPayload.resourceCode,
      biz_id: props.launchPayload.bizId
    })
    if (res.code === 0 && res.data) {
      // 排除当前显示中的实例（如果有），只保留已完结的
      const currentId = instance.value?.id
      historyItems.value = res.data.filter(
        h => h.instance_id !== currentId && ['approved', 'rejected', 'cancelled'].includes(h.status)
      )
    }
  } catch {
    // 历史加载失败不影响主流程
  } finally {
    historyLoading.value = false
  }
}

function toggleHistory(id: number) {
  expandedHistoryId.value = expandedHistoryId.value === id ? null : id
}

function formatHistoryAction(action: string) {
  const map: Record<string, string> = {
    submit: '提交',
    approve: '通过',
    reject: '驳回',
    delegate: '委托',
    cancel: '撤销',
    resubmit: '重新提交',
    remind: '催办'
  }
  return map[action] || action
}

function formatHistoryStatus(status: string) {
  const map: Record<string, string> = {
    approved: '已通过',
    rejected: '已驳回',
    cancelled: '已撤销',
    running: '审批中'
  }
  return map[status] || status
}

function formatHistoryTime(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}`
}

// 初始加载
onMounted(loadData)

// 监听 props 变化重新加载
watch(() => [props.taskId, props.instanceId, props.launchPayload], loadData)

defineExpose({ refresh: loadData })
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 标题 -->
    <div class="shrink-0 border-b border-default px-4 py-3">
      <div class="text-md font-semibold text-highlighted pb-4">
        {{ approvalTitle }}
      </div>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-git-pull-request" class="size-4 text-primary" />
        <span class="font-medium text-sm">审批流程</span>
        <WorkflowBadge v-if="status" :status="status" />
        <UBadge v-else-if="isLaunchReady" color="neutral" variant="subtle">
          未提交
        </UBadge>
      </div>
      <p v-if="instance" class="mt-1 text-xs text-dimmed">
        {{ instance.instance_no }}
      </p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-dimmed" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center px-4">
      <div class="text-center">
        <UIcon name="i-lucide-alert-circle" class="size-8 text-error mb-2" />
        <p class="text-sm text-muted">
          {{ error }}
        </p>
        <UButton
          size="xs"
          variant="ghost"
          class="mt-2"
          @click="loadData"
        >
          重试
        </UButton>
      </div>
    </div>

    <!-- Launch 模式：待提交 -->
    <div v-else-if="isLaunchReady" class="flex-1 overflow-y-auto">
      <div class="px-4 py-4 space-y-4">
        <!-- 完整性检查 -->
        <div v-if="completenessIssues && completenessIssues.length > 0" class="space-y-2">
          <div class="text-xs font-medium text-dimmed uppercase tracking-wide">
            完整性检查
          </div>
          <div
            v-for="issue in completenessIssues"
            :key="issue"
            class="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning"
          >
            {{ issue }}
          </div>
        </div>
        <div v-else-if="completenessIssues" class="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
          已满足提交条件
        </div>

        <!-- 提交说明 -->
        <div class="space-y-2">
          <UTextarea
            v-model="launchComment"
            placeholder="提交说明（选填）"
            :rows="3"
            size="sm"
            class="w-full"
          />
        </div>

        <!-- 提交按钮 -->
        <UButton
          color="primary"
          icon="i-lucide-send"
          class="w-full"
          :loading="submitting"
          :disabled="canSubmit === false"
          @click="handleLaunchSubmit"
        >
          提交审批
        </UButton>
      </div>
    </div>

    <!-- Content：已有实例（时间线 + 审批操作） -->
    <div v-else class="flex-1 overflow-y-auto">
      <!-- 时间线 -->
      <div v-if="nodes.length" class="px-4 py-4">
        <WorkflowTimeline
          :nodes="nodes"
          :actions="actions"
          :tasks="tasks"
          :current-node="currentNode"
          :status="status || 'running'"
        />
      </div>

      <!-- 审批操作区 -->
      <div v-if="capabilities" class="px-4 pb-4">
        <div v-if="capabilities.can_approve || capabilities.can_reject" class="space-y-3 border-t border-default pt-4">
          <UTextarea
            v-model="decisionComment"
            :placeholder="capabilities.can_approve ? '审批意见（通过时可选，驳回时必填）' : '驳回原因（必填）'"
            :rows="3"
            size="sm"
            class="w-full"
          />
        </div>

        <!-- 通过 -->
        <div v-if="capabilities.can_approve" class="space-y-3 pt-4">
          <div class="flex gap-2">
            <UButton
              color="success"
              :loading="submitting"
              icon="i-lucide-check"
              class="flex-1"
              @click="handleApprove"
            >
              通过
            </UButton>
          </div>
        </div>

        <!-- 驳回 -->
        <div v-if="capabilities.can_reject" class="space-y-3" :class="capabilities.can_approve ? 'mt-3' : 'pt-4'">
          <UButton
            color="error"
            :loading="submitting"
            :variant="capabilities.can_approve ? 'outline' : 'solid'"
            :disabled="!decisionComment.trim()"
            icon="i-lucide-x"
            class="w-full"
            @click="handleReject"
          >
            驳回
          </UButton>
        </div>

        <!-- 重新提交 -->
        <div v-if="capabilities.can_resubmit" class="border-t border-default pt-4 mt-3">
          <p class="text-xs text-muted mb-2">
            该审批已被驳回，修改后可重新提交
          </p>
          <UTextarea
            v-model="launchComment"
            placeholder="补充说明（选填）"
            :rows="2"
            size="sm"
            class="w-full mb-3"
          />
          <UButton
            color="primary"
            variant="outline"
            icon="i-lucide-refresh-cw"
            class="w-full"
            :loading="submitting"
            @click="handleLaunchSubmit"
          >
            重新提交
          </UButton>
        </div>

        <!-- 撤销 -->
        <!-- <div v-if="capabilities.can_cancel" class="border-t border-default pt-4 mt-3">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-ban"
            size="sm"
            class="w-full"
          >
            撤销审批
          </UButton>
        </div> -->
      </div>
    </div>

    <!-- 审批历史 -->
    <div v-if="historyItems.length > 0 && !loading" class="shrink-0 border-t border-default">
      <div class="px-4 py-3">
        <div class="flex items-center gap-1.5 text-xs font-medium text-dimmed mb-2">
          <UIcon name="i-lucide-history" class="size-3.5" />
          审批历史
        </div>
        <div class="space-y-1">
          <div
            v-for="item in historyItems"
            :key="item.instance_id"
            class="rounded-md"
          >
            <!-- 摘要行：点击展开 -->
            <button
              class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs hover:bg-elevated/80 transition-colors cursor-pointer"
              @click="toggleHistory(item.instance_id)"
            >
              <UIcon
                :name="item.status === 'approved' ? 'i-lucide-check-circle' : item.status === 'rejected' ? 'i-lucide-x-circle' : 'i-lucide-minus-circle'"
                class="size-3.5 shrink-0"
                :class="item.status === 'approved' ? 'text-success' : item.status === 'rejected' ? 'text-error' : 'text-muted'"
              />
              <span class="flex-1 truncate text-default">
                {{ item.action_name || item.action_code }}
              </span>
              <span class="text-dimmed shrink-0">
                {{ formatHistoryTime(item.completed_at || item.created_at) }}
              </span>
              <UIcon
                name="i-lucide-chevron-down"
                class="size-3 text-dimmed transition-transform shrink-0"
                :class="expandedHistoryId === item.instance_id ? 'rotate-180' : ''"
              />
            </button>

            <!-- 展开详情 -->
            <div
              v-if="expandedHistoryId === item.instance_id"
              class="pl-7 pr-2 pb-2 space-y-1"
            >
              <div class="text-xs text-dimmed">
                {{ item.instance_no }} · {{ formatHistoryStatus(item.status) }}
              </div>
              <div
                v-for="(act, idx) in item.actions"
                :key="idx"
                class="flex items-start gap-1.5 text-xs"
              >
                <span class="text-dimmed shrink-0 w-12">
                  {{ formatHistoryTime(act.created_at) }}
                </span>
                <span class="text-muted">
                  {{ act.node_name ? `${act.node_name}:` : '' }}{{ formatHistoryAction(act.action) }}
                </span>
                <span v-if="act.comment" class="text-dimmed truncate flex-1" :title="act.comment">
                  {{ act.comment }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="historyLoading && !loading" class="shrink-0 border-t border-default px-4 py-3">
      <div class="flex items-center gap-1.5 text-xs text-dimmed">
        <UIcon name="i-lucide-loader-2" class="size-3.5 animate-spin" />
        加载历史...
      </div>
    </div>
  </div>
</template>
