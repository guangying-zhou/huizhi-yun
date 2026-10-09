<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('日志管理')

type LogTab = 'login' | 'operation' | 'simulation' | 'lifecycle' | 'online'

type ApiResponse<T> = {
  code?: number
  data: T
  message?: string
}

type PagedResponse<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

type LoginLog = {
  id: number
  uid: string | null
  real_name: string | null
  target_app: string | null
  session_id: string | null
  auth_provider: string
  login_type: string
  login_result: number
  failure_reason: string | null
  ip_address: string | null
  location: string | null
  device: string | null
  browser: string | null
  os: string | null
  created_at: string
}

type OperationLog = {
  id: number
  uid: string | null
  real_name: string | null
  source_app: string | null
  session_id: string | null
  target_type?: string | null
  target_key?: string | null
  action: string
  detail: string | null
  ip_address: string | null
  created_at: string
}

type LifecycleActionMetric = {
  action: string
  total: number
  success: number
  failed: number
  latestAt: string | null
}

type LifecycleTrendMetric = {
  date: string
  total: number
  success: number
  failed: number
  retry: number
}

type LifecycleMetrics = {
  total: number
  success: number
  failed: number
  retry: number
  retrySuccess: number
  retryFailed: number
  pendingFailure: number
  affectedUsers: number
  latestFailureAt: string | null
  lastSuccessAt: string | null
  byAction: LifecycleActionMetric[]
  trend: LifecycleTrendMetric[]
  generatedAt: string
}

type LifecycleOperation = {
  operationId: string
  operationCode: 'console.platform.employment-sync.v1' | 'console.platform.offboarding-revoke.v1'
  uid: string
  status: string
  attemptCount: number
  lastErrorCode: string | null
  lastErrorClass: string | null
  createdAt: string
  updatedAt: string
  succeededAt: string | null
}

type LifecycleAttempt = {
  operationId: string
  attemptNo: number
  status: string
  errorCode: string | null
  startedAt: string
  finishedAt: string | null
}

type OnlineUser = {
  uid: string
  sourceApp: string
  page: string | null
  status: 'active' | 'idle'
  lastSeen: string
}

const toast = useToast()
const route = useRoute()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const ACTION_FILTER_ALL = 'all'
const activeTab = ref<LogTab>('login')
const loading = ref(false)
const onlineLoading = ref(false)
const lifecycleMetricsLoading = ref(false)
const lifecycleOperationsLoading = ref(false)
const lifecycleAttemptsLoading = ref(false)
const lifecycleRetrying = ref(false)
const onlineTimer = ref<ReturnType<typeof setInterval> | null>(null)

const appOptions = ref([{ label: '全部应用', value: 'all' }])
const loginLogs = ref<LoginLog[]>([])
const operationLogs = ref<OperationLog[]>([])
const lifecycleMetrics = ref<LifecycleMetrics | null>(null)
const lifecycleOperations = ref<LifecycleOperation[]>([])
const selectedLifecycleOperation = ref<LifecycleOperation | null>(null)
const lifecycleAttempts = ref<LifecycleAttempt[]>([])
const onlineUsers = ref<OnlineUser[]>([])
const selectedLoginLog = ref<LoginLog | null>(null)
const selectedOperationLog = ref<OperationLog | null>(null)
const showLoginDetail = ref(false)
const showOperationDetail = ref(false)
const showLifecycleTimeline = ref(false)

if (!permissionsLoaded.value) {
  await loadPermissions()
}

const loginFilters = ref({
  uid: '',
  target_app: 'all',
  session_id: '',
  login_result: 'all',
  login_type: 'all',
  start_date: '',
  end_date: ''
})

const operationFilters = ref({
  uid: '',
  source_app: 'all',
  session_id: '',
  action: '',
  start_date: '',
  end_date: ''
})

const loginPagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 })
const operationPagination = ref({ page: 1, pageSize: 20, total: 0, totalPages: 0 })

const resultOptions = [
  { label: '全部结果', value: 'all' },
  { label: '成功', value: '1' },
  { label: '失败', value: '0' }
]

const typeOptions = [
  { label: '全部方式', value: 'all' },
  { label: '密码登录', value: 'password' },
  { label: 'SSO 登录', value: 'sso' },
  { label: '企业微信登录', value: 'wecom' },
  { label: '钉钉登录', value: 'dingtalk' },
  { label: '其他 OAuth 登录', value: 'oauth' },
  { label: 'OIDC 登录', value: 'oidc' }
]

const simulationActionOptions = [
  { label: '全部模拟动作', value: ACTION_FILTER_ALL },
  { label: '创建会话', value: 'simulation.create' },
  { label: '退出会话', value: 'simulation.delete' },
  { label: '会话过期', value: 'simulation.expired' },
  { label: '策略失效', value: 'simulation.invalidated' },
  { label: '授权拒绝', value: 'simulation.denied' },
  { label: '创建失败', value: 'simulation.failed' },
  { label: '高危拦截', value: 'simulation.blocked' }
]

const lifecycleActionOptions = [
  { label: '全部生命周期动作', value: ACTION_FILTER_ALL },
  { label: '主岗位授权同步', value: 'directory.user.employment.from_people' },
  { label: '离职授权回收', value: 'directory.user.disable.from_people' },
  { label: '主岗位同步重试', value: 'directory.user.employment_authorization.retry' },
  { label: '离职回收重试', value: 'directory.user.offboarding_authorization.retry' }
]

const operationSourceOptions = computed(() => {
  const existing = appOptions.value.some(item => item.value === 'authorization_simulation')
  return existing
    ? appOptions.value
    : [...appOptions.value, { label: '授权模拟', value: 'authorization_simulation' }]
})

const loginColumns = [
  { accessorKey: 'uid', header: '用户' },
  { accessorKey: 'target_app', header: '目标应用' },
  { accessorKey: 'session_id', header: '会话' },
  { accessorKey: 'login_type', header: '方式' },
  { accessorKey: 'login_result', header: '结果' },
  { accessorKey: 'ip_address', header: 'IP' },
  { accessorKey: 'created_at', header: '时间' },
  { id: 'actions', header: '操作' }
]

const operationColumns = [
  { accessorKey: 'uid', header: '操作者' },
  { accessorKey: 'source_app', header: '领域' },
  { accessorKey: 'session_id', header: '请求/会话' },
  { accessorKey: 'action', header: '动作' },
  { accessorKey: 'ip_address', header: 'IP' },
  { accessorKey: 'created_at', header: '时间' },
  { id: 'actions', header: '操作' }
]

const lifecycleOperationColumns = [
  { accessorKey: 'uid', header: '用户' },
  { accessorKey: 'operationCode', header: '生命周期动作' },
  { accessorKey: 'status', header: '投递状态' },
  { accessorKey: 'attemptCount', header: '尝试次数' },
  { accessorKey: 'lastErrorCode', header: '稳定错误码' },
  { accessorKey: 'updatedAt', header: '更新时间' },
  { id: 'actions', header: '时间线' }
]

const lifecycleAttemptColumns = [
  { accessorKey: 'attemptNo', header: '第几次' },
  { accessorKey: 'status', header: '结果' },
  { accessorKey: 'errorCode', header: '稳定错误码' },
  { accessorKey: 'startedAt', header: '开始时间' },
  { accessorKey: 'finishedAt', header: '结束时间' }
]

const onlineColumns = [
  { accessorKey: 'uid', header: '用户' },
  { accessorKey: 'sourceApp', header: '所在应用' },
  { accessorKey: 'page', header: '当前页面' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'lastSeen', header: '最后活跃' }
]

const onlineStats = computed(() => {
  const active = onlineUsers.value.filter(item => item.status === 'active').length
  return {
    active,
    idle: onlineUsers.value.length - active,
    total: onlineUsers.value.length
  }
})

const lifecycleStats = computed(() => {
  const metrics = lifecycleMetrics.value
  if (metrics) {
    return {
      ...metrics,
      currentPage: operationLogs.value.length
    }
  }

  return {
    total: operationPagination.value.total,
    success: 0,
    currentPage: operationLogs.value.length,
    failed: 0,
    retry: 0,
    retrySuccess: 0,
    retryFailed: 0,
    pendingFailure: 0,
    affectedUsers: 0,
    latestFailureAt: null,
    lastSuccessAt: null,
    byAction: [],
    trend: [],
    generatedAt: ''
  }
})

const lifecycleTrendMax = computed(() => {
  const trend = lifecycleStats.value.trend || []
  return Math.max(1, ...trend.map(item => item.total || 0))
})

const formattedOperationDetail = computed(() => {
  const detail = selectedOperationLog.value?.detail
  if (!detail) return '-'
  return JSON.stringify(parseOperationDetail(detail), null, 2)
})

const selectedLifecycleRetry = computed(() => {
  const log = selectedOperationLog.value
  if (!log || log.source_app !== 'directory') return null
  if (log.action === 'directory.user.employment.from_people') {
    return { phase: 'employment_authorization_sync' as const, uid: log.target_key || '' }
  }
  if (log.action === 'directory.user.disable.from_people') {
    return { phase: 'offboarding_authorization_reclaim' as const, uid: log.target_key || '' }
  }
  return null
})

const canRetryLifecycleAuthorization = computed(() => (
  permissionsLoaded.value && hasPermission('authorization_lifecycle', 'admin')
))

function displayUser(uid: string | null, realName?: string | null) {
  if (!uid) return '-'
  return realName ? `${realName} (${uid})` : uid
}

function appLabel(appCode: string | null | undefined) {
  if (!appCode) return '-'
  return operationSourceOptions.value.find(item => item.value === appCode)?.label || appCode
}

function loginTypeLabel(log: Pick<LoginLog, 'auth_provider' | 'login_type'>) {
  const provider = String(log.auth_provider || '').trim()
  const loginType = String(log.login_type || '').trim()
  if (provider === 'wecom' || loginType === 'wecom') return '企业微信登录'
  if (provider === 'dingtalk' || loginType === 'dingtalk') return '钉钉登录'

  const labels: Record<string, string> = {
    password: '密码登录',
    sso: 'SSO 登录',
    oauth: 'OAuth 登录',
    oidc: 'OIDC 登录'
  }
  return labels[loginType] || loginType || '-'
}

function lifecycleActionLabel(action: string) {
  return lifecycleActionOptions.find(item => item.value === action)?.label || action
}

function lifecycleOperationLabel(operationCode: LifecycleOperation['operationCode']) {
  return operationCode === 'console.platform.employment-sync.v1'
    ? '主岗位授权同步'
    : '离职授权回收'
}

function lifecycleTrendBarHeight(item: LifecycleTrendMetric) {
  const ratio = Number(item.total || 0) / lifecycleTrendMax.value
  return `${Math.max(8, Math.round(ratio * 64))}px`
}

function lifecycleTrendDateLabel(value: string) {
  return value.slice(5) || value
}

async function refreshLifecycleDiagnostics() {
  await Promise.all([loadLifecycleMetrics(), loadLifecycleOperations()])
}

function parseOperationDetail(detail: string | null | undefined): Record<string, unknown> {
  if (!detail) return {}
  try {
    const parsed = JSON.parse(detail)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { detail: parsed }
  } catch {
    return { detail }
  }
}

function queryText(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  return String(raw || '').trim()
}

function operationActionQueryValue(useAllSentinel = false) {
  const action = operationFilters.value.action
  if (!action || (useAllSentinel && action === ACTION_FILTER_ALL)) return undefined
  return action
}

function queryTab(): LogTab {
  const tab = queryText(route.query.tab)
  if (tab === 'login' || tab === 'operation' || tab === 'simulation' || tab === 'lifecycle' || tab === 'online') return tab
  if (queryText(route.query.action_group) === 'lifecycle_authorization') return 'lifecycle'
  if (queryText(route.query.source_app) || queryText(route.query.action) || queryText(route.query.session_id)) return 'operation'
  return 'login'
}

function applyInitialRouteFilters() {
  const tab = queryTab()
  activeTab.value = tab

  if (tab === 'login') {
    loginFilters.value = {
      uid: queryText(route.query.uid),
      target_app: queryText(route.query.target_app) || 'all',
      session_id: queryText(route.query.session_id),
      login_result: queryText(route.query.login_result) || 'all',
      login_type: queryText(route.query.login_type) || 'all',
      start_date: queryText(route.query.start_date),
      end_date: queryText(route.query.end_date)
    }
    return
  }

  if (tab === 'operation' || tab === 'simulation' || tab === 'lifecycle') {
    operationFilters.value = {
      uid: queryText(route.query.uid),
      source_app: tab === 'simulation'
        ? 'authorization_simulation'
        : tab === 'lifecycle' ? 'directory' : queryText(route.query.source_app) || 'all',
      session_id: queryText(route.query.session_id),
      action: tab === 'operation' ? queryText(route.query.action) : queryText(route.query.action) || ACTION_FILTER_ALL,
      start_date: queryText(route.query.start_date),
      end_date: queryText(route.query.end_date)
    }
  }
}

async function loadAppOptions() {
  try {
    const res = await $fetch<{ data?: { items?: Array<{ appCode: string, appName: string }> } }>('/api/user/applications')
    const items = res.data?.items || []
    appOptions.value = [
      { label: '全部应用', value: 'all' },
      ...items.map(item => ({ label: item.appName || item.appCode, value: item.appCode }))
    ]
  } catch {
    appOptions.value = [{ label: '全部应用', value: 'all' }]
  }
}

async function loadLoginLogs(page = 1) {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<PagedResponse<LoginLog>>>('/api/v1/login-logs', {
      query: {
        page,
        pageSize: loginPagination.value.pageSize,
        uid: loginFilters.value.uid || undefined,
        target_app: loginFilters.value.target_app === 'all' ? undefined : loginFilters.value.target_app,
        session_id: loginFilters.value.session_id || undefined,
        login_result: loginFilters.value.login_result === 'all' ? undefined : loginFilters.value.login_result,
        login_type: loginFilters.value.login_type === 'all' ? undefined : loginFilters.value.login_type,
        start_date: loginFilters.value.start_date || undefined,
        end_date: loginFilters.value.end_date || undefined
      }
    })
    loginLogs.value = res.data.items
    loginPagination.value = {
      page: res.data.page,
      pageSize: res.data.pageSize,
      total: res.data.total,
      totalPages: res.data.totalPages
    }
  } catch (error) {
    toast.add({ color: 'error', title: '加载登录日志失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    loading.value = false
  }
}

async function loadOperationLogs(page = 1) {
  loading.value = true
  try {
    const simulationAudit = activeTab.value === 'simulation'
    const lifecycleAudit = activeTab.value === 'lifecycle'
    const res = await $fetch<ApiResponse<PagedResponse<OperationLog>>>('/api/v1/operation-logs', {
      query: {
        page,
        pageSize: operationPagination.value.pageSize,
        uid: operationFilters.value.uid || undefined,
        source_app: lifecycleAudit
          ? 'directory'
          : simulationAudit
            ? 'authorization_simulation'
            : operationFilters.value.source_app === 'all' ? undefined : operationFilters.value.source_app,
        action_group: lifecycleAudit ? 'lifecycle_authorization' : undefined,
        session_id: operationFilters.value.session_id || undefined,
        action: operationActionQueryValue(simulationAudit || lifecycleAudit),
        start_date: operationFilters.value.start_date || undefined,
        end_date: operationFilters.value.end_date || undefined
      }
    })
    operationLogs.value = res.data.items
    operationPagination.value = {
      page: res.data.page,
      pageSize: res.data.pageSize,
      total: res.data.total,
      totalPages: res.data.totalPages
    }
    if (lifecycleAudit) await refreshLifecycleDiagnostics()
  } catch (error) {
    toast.add({ color: 'error', title: '加载操作日志失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    loading.value = false
  }
}

async function loadLifecycleMetrics() {
  lifecycleMetricsLoading.value = true
  try {
    const res = await $fetch<ApiResponse<LifecycleMetrics>>('/api/v1/operation-logs/lifecycle-metrics', {
      query: {
        uid: operationFilters.value.uid || undefined,
        source_app: 'directory',
        session_id: operationFilters.value.session_id || undefined,
        action: operationActionQueryValue(true),
        start_date: operationFilters.value.start_date || undefined,
        end_date: operationFilters.value.end_date || undefined
      }
    })
    lifecycleMetrics.value = res.data
  } catch (error) {
    lifecycleMetrics.value = null
    toast.add({ color: 'error', title: '加载生命周期指标失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    lifecycleMetricsLoading.value = false
  }
}

async function loadLifecycleOperations() {
  lifecycleOperationsLoading.value = true
  try {
    const res = await $fetch<ApiResponse<{ items: LifecycleOperation[] }>>('/api/v1/console/authorization-lifecycle/operations', {
      query: {
        uid: operationFilters.value.uid || undefined,
        limit: 20
      }
    })
    lifecycleOperations.value = res.data.items
  } catch (error) {
    lifecycleOperations.value = []
    toast.add({ color: 'error', title: '加载生命周期投递记录失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    lifecycleOperationsLoading.value = false
  }
}

async function viewLifecycleOperationTimeline(operation: LifecycleOperation) {
  selectedLifecycleOperation.value = operation
  lifecycleAttempts.value = []
  showLifecycleTimeline.value = true
  lifecycleAttemptsLoading.value = true
  try {
    const res = await $fetch<ApiResponse<{ operationId: string, items: LifecycleAttempt[] }>>(
      `/api/v1/console/authorization-lifecycle/operations/${encodeURIComponent(operation.operationId)}/attempts`
    )
    if (res.data.operationId === operation.operationId) lifecycleAttempts.value = res.data.items
  } catch (error) {
    toast.add({ color: 'error', title: '加载投递尝试时间线失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    lifecycleAttemptsLoading.value = false
  }
}

async function loadOnlineUsers() {
  onlineLoading.value = true
  try {
    const res = await $fetch<{ data?: { items?: OnlineUser[] } }>('/api/v1/heartbeat/online')
    onlineUsers.value = res.data?.items || []
  } catch (error) {
    onlineUsers.value = []
    toast.add({
      color: 'error',
      title: '加载在线用户失败',
      description: error instanceof Error ? error.message : String(error)
    })
  } finally {
    onlineLoading.value = false
  }
}

function handleSearch() {
  if (activeTab.value === 'login') {
    loadLoginLogs(1)
  } else if (activeTab.value === 'operation' || activeTab.value === 'simulation' || activeTab.value === 'lifecycle') {
    loadOperationLogs(1)
  } else {
    loadOnlineUsers()
  }
}

function resetFilters() {
  if (activeTab.value === 'login') {
    loginFilters.value = { uid: '', target_app: 'all', session_id: '', login_result: 'all', login_type: 'all', start_date: '', end_date: '' }
    loadLoginLogs(1)
  } else if (activeTab.value === 'simulation') {
    operationFilters.value = { uid: '', source_app: 'authorization_simulation', session_id: '', action: ACTION_FILTER_ALL, start_date: '', end_date: '' }
    loadOperationLogs(1)
  } else if (activeTab.value === 'lifecycle') {
    operationFilters.value = { uid: '', source_app: 'directory', session_id: '', action: ACTION_FILTER_ALL, start_date: '', end_date: '' }
    loadOperationLogs(1)
  } else {
    operationFilters.value = { uid: '', source_app: 'all', session_id: '', action: '', start_date: '', end_date: '' }
    loadOperationLogs(1)
  }
}

function switchTab(tab: LogTab) {
  const previousTab = activeTab.value
  activeTab.value = tab
  if (tab === 'login' && loginLogs.value.length === 0) loadLoginLogs()
  if (tab === 'operation') {
    if (previousTab === 'simulation' || previousTab === 'lifecycle') {
      operationFilters.value = { uid: '', source_app: 'all', session_id: '', action: '', start_date: '', end_date: '' }
    }
    if (operationLogs.value.length === 0 || previousTab === 'simulation' || previousTab === 'lifecycle') loadOperationLogs()
  }
  if (tab === 'simulation') {
    operationFilters.value = {
      ...operationFilters.value,
      source_app: 'authorization_simulation',
      action: ACTION_FILTER_ALL
    }
    loadOperationLogs()
  }
  if (tab === 'lifecycle') {
    operationFilters.value = {
      ...operationFilters.value,
      source_app: 'directory',
      action: ACTION_FILTER_ALL
    }
    loadOperationLogs()
  }
  if (tab === 'online') loadOnlineUsers()
}

function viewLoginDetail(log: LoginLog) {
  selectedLoginLog.value = log
  showLoginDetail.value = true
}

function viewOperationDetail(log: OperationLog) {
  selectedOperationLog.value = log
  showOperationDetail.value = true
}

async function retryLifecycleAuthorization() {
  const retry = selectedLifecycleRetry.value
  if (!retry?.uid || !selectedOperationLog.value) return
  if (!canRetryLifecycleAuthorization.value) {
    toast.add({ color: 'error', title: '无权限', description: '需要授权生命周期管理权限' })
    return
  }

  lifecycleRetrying.value = true
  try {
    await $fetch('/api/v1/console/authorization-lifecycle/retry', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        phase: retry.phase,
        uid: retry.uid
      }
    })
    toast.add({ color: 'success', title: '已重试授权处理' })
    showOperationDetail.value = false
    await loadOperationLogs(operationPagination.value.page)
  } catch (error) {
    toast.add({ color: 'error', title: '重试失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    lifecycleRetrying.value = false
  }
}

function viewSessionOperations(sessionId: string | null) {
  if (!sessionId) return
  showLoginDetail.value = false
  operationFilters.value = { uid: '', source_app: 'all', session_id: sessionId, action: '', start_date: '', end_date: '' }
  switchTab('operation')
  loadOperationLogs(1)
}

function pageLogin(delta: number) {
  const nextPage = loginPagination.value.page + delta
  if (nextPage < 1 || nextPage > loginPagination.value.totalPages) return
  loadLoginLogs(nextPage)
}

function pageOperation(delta: number) {
  const nextPage = operationPagination.value.page + delta
  if (nextPage < 1 || nextPage > operationPagination.value.totalPages) return
  loadOperationLogs(nextPage)
}

onMounted(() => {
  applyInitialRouteFilters()
  loadAppOptions()
  if (activeTab.value === 'login') {
    loadLoginLogs()
  } else if (activeTab.value === 'operation' || activeTab.value === 'simulation' || activeTab.value === 'lifecycle') {
    loadOperationLogs()
  } else {
    loadOnlineUsers()
  }
  onlineTimer.value = setInterval(() => {
    if (activeTab.value === 'online') loadOnlineUsers()
  }, 30_000)
})

onUnmounted(() => {
  if (onlineTimer.value) clearInterval(onlineTimer.value)
})
</script>

<template>
  <UDashboardPanel id="admin-logs" :ui="dashboardPanelUi">
    <template #body>
      <div class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <UButtonGroup>
            <UButton
              icon="i-lucide-log-in"
              label="登录日志"
              :color="activeTab === 'login' ? 'primary' : 'neutral'"
              :variant="activeTab === 'login' ? 'solid' : 'subtle'"
              @click="switchTab('login')"
            />
            <UButton
              icon="i-lucide-scroll-text"
              label="操作日志"
              :color="activeTab === 'operation' ? 'primary' : 'neutral'"
              :variant="activeTab === 'operation' ? 'solid' : 'subtle'"
              @click="switchTab('operation')"
            />
            <UButton
              icon="i-lucide-shield-alert"
              label="授权模拟"
              :color="activeTab === 'simulation' ? 'primary' : 'neutral'"
              :variant="activeTab === 'simulation' ? 'solid' : 'subtle'"
              @click="switchTab('simulation')"
            />
            <UButton
              icon="i-lucide-user-check"
              label="授权生命周期"
              :color="activeTab === 'lifecycle' ? 'primary' : 'neutral'"
              :variant="activeTab === 'lifecycle' ? 'solid' : 'subtle'"
              @click="switchTab('lifecycle')"
            />
            <UButton
              icon="i-lucide-activity"
              label="在线用户"
              :color="activeTab === 'online' ? 'primary' : 'neutral'"
              :variant="activeTab === 'online' ? 'solid' : 'subtle'"
              @click="switchTab('online')"
            />
          </UButtonGroup>

          <div v-if="activeTab !== 'online'" class="flex flex-wrap items-center justify-end gap-2">
            <template v-if="activeTab === 'login'">
              <UInput
                v-model="loginFilters.uid"
                size="sm"
                placeholder="用户"
                class="w-32"
              />
              <USelect
                v-model="loginFilters.target_app"
                size="sm"
                :items="appOptions"
                value-key="value"
                class="w-36"
              />
              <UInput
                v-model="loginFilters.session_id"
                size="sm"
                placeholder="会话ID"
                class="w-40"
              />
              <USelect
                v-model="loginFilters.login_result"
                size="sm"
                :items="resultOptions"
                value-key="value"
                class="w-28"
              />
              <USelect
                v-model="loginFilters.login_type"
                size="sm"
                :items="typeOptions"
                value-key="value"
                class="w-32"
              />
              <UInput
                v-model="loginFilters.start_date"
                size="sm"
                type="date"
                class="w-36"
              />
              <UInput
                v-model="loginFilters.end_date"
                size="sm"
                type="date"
                class="w-36"
              />
            </template>
            <template v-else>
              <UInput
                v-model="operationFilters.uid"
                size="sm"
                placeholder="操作者"
                class="w-32"
              />
              <USelect
                v-if="activeTab === 'operation'"
                v-model="operationFilters.source_app"
                size="sm"
                :items="operationSourceOptions"
                value-key="value"
                class="w-36"
              />
              <USelect
                v-else-if="activeTab === 'lifecycle'"
                v-model="operationFilters.action"
                size="sm"
                :items="lifecycleActionOptions"
                value-key="value"
                class="w-40"
              />
              <USelect
                v-else
                v-model="operationFilters.action"
                size="sm"
                :items="simulationActionOptions"
                value-key="value"
                class="w-36"
              />
              <UInput
                v-model="operationFilters.session_id"
                size="sm"
                placeholder="请求/会话"
                class="w-40"
              />
              <UInput
                v-if="activeTab === 'operation'"
                v-model="operationFilters.action"
                size="sm"
                placeholder="动作"
                class="w-40"
              />
              <UInput
                v-model="operationFilters.start_date"
                size="sm"
                type="date"
                class="w-36"
              />
              <UInput
                v-model="operationFilters.end_date"
                size="sm"
                type="date"
                class="w-36"
              />
            </template>
            <UButton
              icon="i-lucide-search"
              size="sm"
              label="搜索"
              @click="handleSearch"
            />
            <UButton
              icon="i-lucide-rotate-ccw"
              size="sm"
              color="neutral"
              variant="ghost"
              label="重置"
              @click="resetFilters"
            />
          </div>

          <div v-else class="flex items-center gap-2 text-sm text-muted">
            <span>在线 {{ onlineStats.active }}</span>
            <span>空闲 {{ onlineStats.idle }}</span>
            <span>合计 {{ onlineStats.total }}</span>
            <UButton
              icon="i-lucide-refresh-cw"
              size="sm"
              color="neutral"
              variant="ghost"
              :loading="onlineLoading"
              @click="loadOnlineUsers"
            />
          </div>
        </div>

        <div v-if="activeTab === 'lifecycle'" class="space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="text-sm text-muted">
              最近失败 {{ formatDateTime(lifecycleStats.latestFailureAt) }} · 最近成功 {{ formatDateTime(lifecycleStats.lastSuccessAt) }}
            </div>
            <UButton
              icon="i-lucide-refresh-cw"
              size="sm"
              color="neutral"
              variant="ghost"
              :loading="lifecycleMetricsLoading"
              @click="refreshLifecycleDiagnostics"
            />
          </div>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <UCard :ui="{ body: 'p-3' }">
              <div class="text-xs text-muted">
                总记录
              </div>
              <div class="mt-1 text-xl font-semibold">
                {{ lifecycleStats.total }}
              </div>
            </UCard>
            <UCard :ui="{ body: 'p-3' }">
              <div class="text-xs text-muted">
                影响成员
              </div>
              <div class="mt-1 text-xl font-semibold">
                {{ lifecycleStats.affectedUsers }}
              </div>
            </UCard>
            <UCard :ui="{ body: 'p-3' }">
              <div class="text-xs text-muted">
                成功
              </div>
              <div class="mt-1 text-xl font-semibold text-success">
                {{ lifecycleStats.success }}
              </div>
            </UCard>
            <UCard :ui="{ body: 'p-3' }">
              <div class="text-xs text-muted">
                失败
              </div>
              <div class="mt-1 text-xl font-semibold text-error">
                {{ lifecycleStats.failed }}
              </div>
            </UCard>
            <UCard :ui="{ body: 'p-3' }">
              <div class="text-xs text-muted">
                待重试
              </div>
              <div class="mt-1 text-xl font-semibold text-warning">
                {{ lifecycleStats.pendingFailure }}
              </div>
            </UCard>
            <UCard :ui="{ body: 'p-3' }">
              <div class="text-xs text-muted">
                重试成功
              </div>
              <div class="mt-1 text-xl font-semibold">
                {{ lifecycleStats.retrySuccess }} / {{ lifecycleStats.retry }}
              </div>
            </UCard>
          </div>
          <div v-if="lifecycleStats.byAction.length > 0" class="flex flex-wrap gap-2">
            <UBadge
              v-for="item in lifecycleStats.byAction"
              :key="item.action"
              color="neutral"
              variant="subtle"
            >
              {{ lifecycleActionLabel(item.action) }} {{ item.success }}/{{ item.total }}
            </UBadge>
          </div>
          <UCard v-if="lifecycleStats.trend.length > 0" :ui="{ body: 'p-3' }">
            <div class="mb-3 flex items-center justify-between gap-2">
              <div class="text-sm font-medium">
                授权生命周期趋势
              </div>
              <div class="text-xs text-muted">
                最近 {{ lifecycleStats.trend.length }} 天
              </div>
            </div>
            <div class="flex items-end gap-3 overflow-x-auto pb-1">
              <div
                v-for="item in lifecycleStats.trend"
                :key="item.date"
                class="flex w-14 shrink-0 flex-col items-center gap-1"
              >
                <div class="flex h-16 w-4 items-end rounded bg-muted/50">
                  <div
                    class="w-full rounded bg-primary"
                    :style="{ height: lifecycleTrendBarHeight(item) }"
                  />
                </div>
                <div class="font-mono text-[11px] text-muted">
                  {{ lifecycleTrendDateLabel(item.date) }}
                </div>
                <div class="text-xs font-medium">
                  {{ item.total }}
                </div>
                <div class="flex gap-1 text-[11px]">
                  <span class="text-success">{{ item.success }}</span>
                  <span class="text-error">{{ item.failed }}</span>
                  <span class="text-warning">{{ item.retry }}</span>
                </div>
              </div>
            </div>
          </UCard>
        </div>

        <UCard v-if="activeTab === 'lifecycle'" :ui="{ body: 'p-0' }">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div>
                <div class="text-sm font-medium">
                  Console → Platform 投递时间线
                </div>
                <div class="mt-1 text-xs text-muted">
                  仅显示当前租户与部署内的安全投递状态；按用户筛选时使用精确 UID。
                </div>
              </div>
              <UButton
                icon="i-lucide-refresh-cw"
                size="sm"
                color="neutral"
                variant="ghost"
                :loading="lifecycleOperationsLoading"
                @click="loadLifecycleOperations"
              />
            </div>
          </template>
          <UTable
            :data="lifecycleOperations"
            :columns="lifecycleOperationColumns"
            :loading="lifecycleOperationsLoading"
          >
            <template #empty>
              <CommonEmptyState icon="i-lucide-activity" title="暂无授权生命周期操作" />
            </template>
            <template #operationCode-cell="{ row }">
              <span>{{ lifecycleOperationLabel(row.original.operationCode) }}</span>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="row.original.status === 'succeeded' ? 'success' : row.original.status === 'dead_letter' ? 'error' : 'warning'" variant="subtle">
                {{ row.original.status }}
              </UBadge>
            </template>
            <template #lastErrorCode-cell="{ row }">
              <span class="font-mono text-xs">{{ row.original.lastErrorCode || '-' }}</span>
            </template>
            <template #updatedAt-cell="{ row }">
              {{ formatDateTime(row.original.updatedAt) }}
            </template>
            <template #actions-cell="{ row }">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-list-tree"
                aria-label="查看投递尝试时间线"
                @click="viewLifecycleOperationTimeline(row.original)"
              />
            </template>
          </UTable>
          <template #footer>
            <div class="text-sm text-muted">
              最多显示最近 20 条投递记录。
            </div>
          </template>
        </UCard>

        <UCard v-if="activeTab === 'login'" :ui="{ body: 'p-0' }">
          <UTable
            :data="loginLogs"
            :columns="loginColumns"
            :loading="loading"
            class="h-[calc(100vh-260px)]"
          >
            <template #empty>
              <CommonEmptyState icon="i-lucide-log-in" title="暂无登录日志" />
            </template>
            <template #uid-cell="{ row }">
              <span>{{ displayUser(row.original.uid, row.original.real_name) }}</span>
            </template>
            <template #target_app-cell="{ row }">
              <UBadge color="neutral" variant="subtle">
                {{ appLabel(row.original.target_app) }}
              </UBadge>
            </template>
            <template #login_result-cell="{ row }">
              <UBadge :color="row.original.login_result === 1 ? 'success' : 'error'" variant="subtle">
                {{ row.original.login_result === 1 ? '成功' : '失败' }}
              </UBadge>
            </template>
            <template #login_type-cell="{ row }">
              <span>{{ loginTypeLabel(row.original) }}</span>
            </template>
            <template #created_at-cell="{ row }">
              {{ formatDateTime(row.original.created_at) }}
            </template>
            <template #actions-cell="{ row }">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-eye"
                @click="viewLoginDetail(row.original)"
              />
            </template>
          </UTable>
          <template #footer>
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted">共 {{ loginPagination.total }} 条</span>
              <div class="flex items-center gap-2">
                <UButton
                  size="sm"
                  color="neutral"
                  variant="outline"
                  :disabled="loginPagination.page <= 1"
                  @click="pageLogin(-1)"
                >
                  上一页
                </UButton>
                <span class="text-sm text-muted">{{ loginPagination.page }} / {{ Math.max(loginPagination.totalPages, 1) }}</span>
                <UButton
                  size="sm"
                  color="neutral"
                  variant="outline"
                  :disabled="loginPagination.page >= loginPagination.totalPages"
                  @click="pageLogin(1)"
                >
                  下一页
                </UButton>
              </div>
            </div>
          </template>
        </UCard>

        <UCard v-else-if="activeTab === 'operation' || activeTab === 'simulation' || activeTab === 'lifecycle'" :ui="{ body: 'p-0' }">
          <UTable
            :data="operationLogs"
            :columns="operationColumns"
            :loading="loading"
            class="h-[calc(100vh-260px)]"
          >
            <template #empty>
              <CommonEmptyState icon="i-lucide-scroll-text" title="暂无操作日志" />
            </template>
            <template #uid-cell="{ row }">
              <span>{{ displayUser(row.original.uid, row.original.real_name) }}</span>
            </template>
            <template #source_app-cell="{ row }">
              <UBadge color="neutral" variant="subtle">
                {{ appLabel(row.original.source_app) }}
              </UBadge>
            </template>
            <template #created_at-cell="{ row }">
              {{ formatDateTime(row.original.created_at) }}
            </template>
            <template #actions-cell="{ row }">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-eye"
                @click="viewOperationDetail(row.original)"
              />
            </template>
          </UTable>
          <template #footer>
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted">共 {{ operationPagination.total }} 条</span>
              <div class="flex items-center gap-2">
                <UButton
                  size="sm"
                  color="neutral"
                  variant="outline"
                  :disabled="operationPagination.page <= 1"
                  @click="pageOperation(-1)"
                >
                  上一页
                </UButton>
                <span class="text-sm text-muted">{{ operationPagination.page }} / {{ Math.max(operationPagination.totalPages, 1) }}</span>
                <UButton
                  size="sm"
                  color="neutral"
                  variant="outline"
                  :disabled="operationPagination.page >= operationPagination.totalPages"
                  @click="pageOperation(1)"
                >
                  下一页
                </UButton>
              </div>
            </div>
          </template>
        </UCard>

        <UCard v-else :ui="{ body: 'p-0' }">
          <UTable
            :data="onlineUsers"
            :columns="onlineColumns"
            :loading="onlineLoading"
            class="h-[calc(100vh-220px)]"
          >
            <template #empty>
              <CommonEmptyState icon="i-lucide-users" title="暂无在线用户" />
            </template>
            <template #sourceApp-cell="{ row }">
              <UBadge color="neutral" variant="subtle">
                {{ appLabel(row.original.sourceApp) }}
              </UBadge>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="row.original.status === 'active' ? 'success' : 'warning'" variant="subtle">
                {{ row.original.status === 'active' ? '在线' : '空闲' }}
              </UBadge>
            </template>
            <template #lastSeen-cell="{ row }">
              {{ formatDateTime(row.original.lastSeen) }}
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="showLoginDetail" title="登录日志详情" :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <dl v-if="selectedLoginLog" class="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 text-sm">
        <dt class="text-muted">
          用户
        </dt><dd>{{ displayUser(selectedLoginLog.uid, selectedLoginLog.real_name) }}</dd>
        <dt class="text-muted">
          目标应用
        </dt><dd>{{ appLabel(selectedLoginLog.target_app) }}</dd>
        <dt class="text-muted">
          会话ID
        </dt><dd class="break-all">
          {{ selectedLoginLog.session_id || '-' }}
        </dd>
        <dt class="text-muted">
          登录方式
        </dt><dd>{{ loginTypeLabel(selectedLoginLog) }}</dd>
        <dt class="text-muted">
          结果
        </dt><dd>{{ selectedLoginLog.login_result === 1 ? '成功' : '失败' }}</dd>
        <dt class="text-muted">
          失败原因
        </dt><dd>{{ selectedLoginLog.failure_reason || '-' }}</dd>
        <dt class="text-muted">
          IP
        </dt><dd>{{ selectedLoginLog.ip_address || '-' }}</dd>
        <dt class="text-muted">
          浏览器
        </dt><dd>{{ selectedLoginLog.browser || '-' }}</dd>
        <dt class="text-muted">
          系统
        </dt><dd>{{ selectedLoginLog.os || '-' }}</dd>
        <dt class="text-muted">
          时间
        </dt><dd>{{ formatDateTime(selectedLoginLog.created_at) }}</dd>
      </dl>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="showLoginDetail = false">
          关闭
        </UButton>
        <UButton :disabled="!selectedLoginLog?.session_id" @click="viewSessionOperations(selectedLoginLog?.session_id || null)">
          查看关联操作
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showOperationDetail" title="操作日志详情" :ui="{ content: 'sm:max-w-3xl' }">
    <template #body>
      <dl v-if="selectedOperationLog" class="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 text-sm">
        <dt class="text-muted">
          操作者
        </dt><dd>{{ displayUser(selectedOperationLog.uid, selectedOperationLog.real_name) }}</dd>
        <dt class="text-muted">
          领域
        </dt><dd>{{ appLabel(selectedOperationLog.source_app) }}</dd>
        <dt class="text-muted">
          请求/会话
        </dt><dd class="break-all">
          {{ selectedOperationLog.session_id || '-' }}
        </dd>
        <dt class="text-muted">
          目标
        </dt><dd class="break-all">
          {{ selectedOperationLog.target_key || '-' }}
        </dd>
        <dt class="text-muted">
          动作
        </dt><dd>{{ selectedOperationLog.action }}</dd>
        <dt class="text-muted">
          IP
        </dt><dd>{{ selectedOperationLog.ip_address || '-' }}</dd>
        <dt class="text-muted">
          时间
        </dt><dd>{{ formatDateTime(selectedOperationLog.created_at) }}</dd>
        <dt class="text-muted">
          详情
        </dt>
        <dd>
          <pre class="max-h-80 overflow-auto rounded-md bg-elevated p-3 text-xs">{{ formattedOperationDetail }}</pre>
        </dd>
      </dl>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          v-if="selectedLifecycleRetry && canRetryLifecycleAuthorization"
          color="warning"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="lifecycleRetrying"
          :disabled="!selectedLifecycleRetry.uid"
          @click="retryLifecycleAuthorization"
        >
          重试授权处理
        </UButton>
        <UButton color="neutral" variant="outline" @click="showOperationDetail = false">
          关闭
        </UButton>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showLifecycleTimeline" title="Console → Platform 投递尝试" :ui="{ content: 'sm:max-w-4xl' }">
    <template #body>
      <div v-if="selectedLifecycleOperation" class="space-y-4">
        <dl class="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-3 text-sm">
          <dt class="text-muted">
            用户
          </dt><dd>{{ selectedLifecycleOperation.uid }}</dd>
          <dt class="text-muted">
            生命周期动作
          </dt><dd>{{ lifecycleOperationLabel(selectedLifecycleOperation.operationCode) }}</dd>
          <dt class="text-muted">
            投递状态
          </dt><dd>{{ selectedLifecycleOperation.status }}</dd>
          <dt class="text-muted">
            操作 ID
          </dt>
          <dd class="break-all font-mono text-xs">
            {{ selectedLifecycleOperation.operationId }}
          </dd>
          <dt class="text-muted">
            稳定错误
          </dt><dd>
            {{ selectedLifecycleOperation.lastErrorCode || '-' }}{{ selectedLifecycleOperation.lastErrorClass ? ` · ${selectedLifecycleOperation.lastErrorClass}` : '' }}
          </dd>
        </dl>
        <div class="text-sm font-medium">
          投递尝试
        </div>
        <UTable
          :data="lifecycleAttempts"
          :columns="lifecycleAttemptColumns"
          :loading="lifecycleAttemptsLoading"
        >
          <template #empty>
            <CommonEmptyState icon="i-lucide-list-restart" title="暂无投递尝试" />
          </template>
          <template #errorCode-cell="{ row }">
            <span class="font-mono text-xs">{{ row.original.errorCode || '-' }}</span>
          </template>
          <template #startedAt-cell="{ row }">
            {{ formatDateTime(row.original.startedAt) }}
          </template>
          <template #finishedAt-cell="{ row }">
            {{ formatDateTime(row.original.finishedAt) }}
          </template>
        </UTable>
        <div v-if="!lifecycleAttemptsLoading && lifecycleAttempts.length === 0" class="text-sm text-muted">
          尚无已持久化的投递尝试。
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end">
        <UButton color="neutral" variant="outline" @click="showLifecycleTimeline = false">
          关闭
        </UButton>
      </div>
    </template>
  </UModal>
</template>
