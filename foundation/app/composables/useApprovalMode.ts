/**
 * 审批模式 composable
 *
 * 从审批中心进入业务页面时，通过 enterApprovalMode() 开启审批模式：
 * - LayoutSidebar 右侧显示 WorkflowPanel
 * - 顶部导航栏显示"返回审批中心"按钮
 * - 业务页面通过 isApprovalMode 隐藏编辑按钮
 *
 * 状态存储在 sessionStorage 中，刷新页面保持，关闭标签页自动清除。
 *
 * 使用方式：
 *   const { isApprovalMode } = useApprovalMode()
 *   <UButton v-if="!isApprovalMode" label="编辑" />
 */

const STORAGE_KEY = 'hzy:approval-mode'

interface ApprovalState {
  taskId?: number
  instanceId?: number
}

// 模块级响应式状态，所有组件共享
const approvalState = ref<ApprovalState | null>(null)
let initialized = false

function numberFromQuery(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function loadFromStorage() {
  if (!import.meta.client || initialized) return
  initialized = true
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) {
      approvalState.value = JSON.parse(raw)
    }
  } catch {
    // ignore
  }
}

function saveToStorage() {
  if (!import.meta.client) return
  try {
    if (approvalState.value) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(approvalState.value))
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // ignore
  }
}

function loadFromRouteQuery() {
  if (!import.meta.client) return

  try {
    const route = useRoute()
    const taskId = numberFromQuery(route.query.hzy_approval_task_id)
    const instanceId = numberFromQuery(route.query.hzy_approval_instance_id)
    if (taskId) {
      approvalState.value = { taskId }
      saveToStorage()
    } else if (instanceId) {
      approvalState.value = { instanceId }
      saveToStorage()
    }
  } catch {
    // ignore
  }
}

export function useApprovalMode() {
  loadFromStorage()
  loadFromRouteQuery()

  const isApprovalMode = computed(() => !!approvalState.value)

  const approvalTaskId = computed(() => approvalState.value?.taskId || null)

  const approvalInstanceId = computed(() => approvalState.value?.instanceId || null)

  function enterApprovalMode(state: ApprovalState) {
    approvalState.value = state
    saveToStorage()
  }

  function exitApprovalMode() {
    approvalState.value = null
    saveToStorage()
  }

  return {
    isApprovalMode,
    approvalTaskId,
    approvalInstanceId,
    enterApprovalMode,
    exitApprovalMode
  }
}
