<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface Application {
  id: number
  app_code: string
  app_name: string
  app_secret: string
}

interface LoginLog {
  id: number
  uid: string
  real_name: string | null
  target_app: string | null
  session_id: string | null
  login_type: string
  login_result: number
  failure_reason: string | null
  ip_address: string
  location: string | null
  device: string | null
  browser: string | null
  os: string | null
  created_at: string
}

interface OperationLog {
  id: number
  user_id: number | null
  uid: string | null
  source_app: string | null
  session_id: string | null
  action: string
  detail: string | null
  ip_address: string | null
  created_at: string
}

interface ApplicationOption {
  value: string
  label: string
}

interface PaginationData<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

usePageTitle('操作日志')

const toast = useToast()
const loading = ref(false)
const activeTab = ref<'login' | 'operation' | 'online'>('login')

// 用户名映射（uid → 真实姓名）
const userNameMap = ref<Record<string, string>>({})

const loadUserNames = async () => {
  try {
    const res = await $fetch<ApiResponse<{ items: { uid: string, real_name: string }[] }>>('/api/system-users', {
      query: { pageSize: 500 }
    })
    if (res.data?.items) {
      const map: Record<string, string> = {}
      res.data.items.forEach((u) => {
        if (u.uid && u.real_name) map[u.uid] = u.real_name
      })
      userNameMap.value = map
    }
  } catch {
    // 静默
  }
}

const getUserDisplay = (uid: string | null): { name: string, uid: string } => {
  if (!uid) return { name: '-', uid: '' }
  return { name: userNameMap.value[uid] || uid, uid }
}

const loginLogs = ref<LoginLog[]>([])
const operationLogs = ref<OperationLog[]>([])

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

const loginPagination = ref({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0
})

const operationPagination = ref({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0
})

const showLoginDetailModal = ref(false)
const currentLoginLog = ref<LoginLog | null>(null)
const showOperationDetailModal = ref(false)
const currentOperationLog = ref<OperationLog | null>(null)

const appOptions = ref<ApplicationOption[]>([
  { value: 'all', label: '全部应用' },
  { value: 'account', label: 'Account' },
  { value: 'codocs', label: 'Codocs' },
  { value: 'nuxt-template', label: 'CodeInsight' }
])

const resultOptions = [
  { value: 'all', label: '全部结果' },
  { value: '1', label: '成功' },
  { value: '0', label: '失败' }
]

const typeOptions = [
  { value: 'all', label: '全部方式' },
  { value: 'password', label: '密码登录' },
  { value: 'sso', label: 'SSO登录' },
  { value: 'oauth', label: 'OAuth登录' }
]

const resultLabels: Record<number, { label: string, color: 'success' | 'error' | 'neutral' }> = {
  1: { label: '成功', color: 'success' },
  0: { label: '失败', color: 'error' }
}

const typeLabels: Record<string, string> = {
  password: '密码登录',
  sso: 'SSO登录',
  oauth: 'OAuth登录'
}

const appLabelMap = computed<Record<string, string>>(() => {
  return appOptions.value.reduce<Record<string, string>>((map, option) => {
    if (option.value !== 'all') {
      map[option.value] = option.label
    }
    return map
  }, {})
})

// ==================== 在线用户 ====================

interface OnlineUser {
  uid: string
  sourceApp: string
  page: string | null
  status: 'active' | 'idle'
  lastSeen: string
}

const onlineUsers = ref<OnlineUser[]>([])
const onlineLoading = ref(false)
const onlineAutoRefresh = ref<ReturnType<typeof setInterval> | null>(null)

const onlineColumns = [
  { accessorKey: 'uid', header: '用户' },
  { accessorKey: 'sourceApp', header: '所在模块' },
  { accessorKey: 'page', header: '当前页面' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'lastSeen', header: '最后活跃' }
]

const onlineStats = computed(() => {
  const active = onlineUsers.value.filter(u => u.status === 'active').length
  const idle = onlineUsers.value.filter(u => u.status === 'idle').length
  return { total: onlineUsers.value.length, active, idle }
})

const appNameMap: Record<string, string> = {
  account: 'Account',
  codocs: 'Codocs',
  aims: 'Aims',
  altoc: 'Altoc',
  assets: 'Assets',
  workflow: 'Workflow'
}

const loadOnlineUsers = async () => {
  onlineLoading.value = true
  try {
    const res = await $fetch<{ data: { items: OnlineUser[] } }>('/api/heartbeat/online')
    onlineUsers.value = res.data?.items || []
  } catch {
    // 静默
  } finally {
    onlineLoading.value = false
  }
}

const startOnlineAutoRefresh = () => {
  loadOnlineUsers()
  onlineAutoRefresh.value = setInterval(loadOnlineUsers, 30_000) // 每30秒刷新
}

const stopOnlineAutoRefresh = () => {
  if (onlineAutoRefresh.value) {
    clearInterval(onlineAutoRefresh.value)
    onlineAutoRefresh.value = null
  }
}

const loginColumns = [
  { accessorKey: 'uid', header: '用户' },
  { accessorKey: 'target_app', header: '目标应用' },
  { accessorKey: 'session_id', header: '会话ID' },
  { accessorKey: 'login_type', header: '登录方式' },
  { accessorKey: 'login_result', header: '结果' },
  { accessorKey: 'ip_address', header: 'IP地址' },
  { accessorKey: 'browser', header: '浏览器' },
  { accessorKey: 'created_at', header: '时间' },
  { accessorKey: 'actions', header: '操作' }
]

const operationColumns = [
  { accessorKey: 'uid', header: '操作者' },
  { accessorKey: 'source_app', header: '来源应用' },
  { accessorKey: 'session_id', header: '会话ID' },
  { accessorKey: 'action', header: '操作标识' },
  { accessorKey: 'ip_address', header: 'IP地址' },
  { accessorKey: 'created_at', header: '时间' },
  { accessorKey: 'actions', header: '操作' }
]

const formattedOperationDetail = computed(() => {
  if (!currentOperationLog.value?.detail) return '-'
  try {
    return JSON.stringify(JSON.parse(currentOperationLog.value.detail), null, 2)
  } catch {
    return currentOperationLog.value.detail
  }
})

async function loadAppOptions() {
  try {
    const res = await $fetch<ApiResponse<PaginationData<Application>>>('/api/applications', {
      query: {
        page: 1,
        pageSize: 200
      }
    })

    const items = res?.data?.items || []
    appOptions.value = [
      { value: 'all', label: '全部应用' },
      ...items.map(item => ({
        value: item.app_code,
        label: item.app_name || item.app_code
      }))
    ]
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '加载应用选项失败', description: error.message, color: 'warning' })
  }
}

async function loadLoginLogs(page = 1) {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<PaginationData<LoginLog>>>('/api/login-logs', {
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
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '加载登录日志失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function loadOperationLogs(page = 1) {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<PaginationData<OperationLog>>>('/api/operation-logs', {
      query: {
        page,
        pageSize: operationPagination.value.pageSize,
        uid: operationFilters.value.uid || undefined,
        source_app: operationFilters.value.source_app === 'all' ? undefined : operationFilters.value.source_app,
        session_id: operationFilters.value.session_id || undefined,
        action: operationFilters.value.action || undefined,
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
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '加载操作日志失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  if (activeTab.value === 'login') {
    loadLoginLogs(1)
    return
  }

  loadOperationLogs(1)
}

function resetLoginFilters() {
  loginFilters.value = {
    uid: '',
    target_app: 'all',
    session_id: '',
    login_result: 'all',
    login_type: 'all',
    start_date: '',
    end_date: ''
  }
  loadLoginLogs(1)
}

function resetOperationFilters() {
  operationFilters.value = {
    uid: '',
    source_app: 'all',
    session_id: '',
    action: '',
    start_date: '',
    end_date: ''
  }
  loadOperationLogs(1)
}

function viewLoginDetail(log: LoginLog) {
  currentLoginLog.value = log
  showLoginDetailModal.value = true
}

function viewOperationDetail(log: OperationLog) {
  currentOperationLog.value = log
  showOperationDetailModal.value = true
}

function viewSessionOperations(sessionId: string | null) {
  const value = String(sessionId || '').trim()
  if (!value) {
    toast.add({ title: '缺少会话ID', description: '当前登录日志没有可关联的会话信息', color: 'warning' })
    return
  }

  showLoginDetailModal.value = false
  activeTab.value = 'operation'
  operationFilters.value = {
    uid: '',
    source_app: 'all',
    session_id: value,
    action: '',
    start_date: '',
    end_date: ''
  }
  loadOperationLogs(1)
}

function viewSessionLogins(sessionId: string | null) {
  const value = String(sessionId || '').trim()
  if (!value) {
    toast.add({ title: '缺少会话ID', description: '当前操作日志没有可关联的会话信息', color: 'warning' })
    return
  }

  showOperationDetailModal.value = false
  activeTab.value = 'login'
  loginFilters.value = {
    uid: '',
    target_app: 'all',
    session_id: value,
    login_result: 'all',
    login_type: 'all',
    start_date: '',
    end_date: ''
  }
  loadLoginLogs(1)
}

function formatDateTime(dateStr: string) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

function switchTab(tab: 'login' | 'operation' | 'online') {
  // 离开在线页签时停止自动刷新
  if (activeTab.value === 'online' && tab !== 'online') {
    stopOnlineAutoRefresh()
  }

  activeTab.value = tab
  if (tab === 'login' && loginLogs.value.length === 0) {
    loadLoginLogs(1)
  }
  if (tab === 'operation' && operationLogs.value.length === 0) {
    loadOperationLogs(1)
  }
  if (tab === 'online') {
    startOnlineAutoRefresh()
  }
}

onMounted(() => {
  loadUserNames()
  loadAppOptions()
  loadLoginLogs()
})

onUnmounted(() => {
  stopOnlineAutoRefresh()
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel grow>
      <div class="flex items-center gap-2 flex-wrap justify-end px-4 py-2 border-b border-default">
        <template v-if="activeTab === 'login'">
          <UInput
            v-model="loginFilters.uid"
            placeholder="用户名"
            size="sm"
            class="w-32"
          />
          <USelect
            v-model="loginFilters.target_app"
            :items="appOptions"
            value-key="value"
            size="sm"
            class="w-36"
          />
          <UInput
            v-model="loginFilters.session_id"
            placeholder="会话ID"
            size="sm"
            class="w-40"
          >
            <template v-if="loginFilters.session_id.length" #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                icon="i-lucide-circle-x"
                aria-label="清空会话ID"
                @click="loginFilters.session_id = ''; loadLoginLogs(1)"
              />
            </template>
          </UInput>
          <USelect
            v-model="loginFilters.login_result"
            :items="resultOptions"
            value-key="value"
            size="sm"
            class="w-24"
          />
          <USelect
            v-model="loginFilters.login_type"
            :items="typeOptions"
            value-key="value"
            size="sm"
            class="w-28"
          />
          <UInput
            v-model="loginFilters.start_date"
            type="date"
            size="sm"
            class="w-36"
          />
          <span class="text-gray-400">-</span>
          <UInput
            v-model="loginFilters.end_date"
            type="date"
            size="sm"
            class="w-36"
          />
        </template>
        <template v-else>
          <UInput
            v-model="operationFilters.uid"
            placeholder="操作者"
            size="sm"
            class="w-32"
          />
          <USelect
            v-model="operationFilters.source_app"
            :items="appOptions"
            value-key="value"
            size="sm"
            class="w-36"
          />
          <UInput
            v-model="operationFilters.session_id"
            placeholder="会话ID"
            size="sm"
            class="w-40"
          >
            <template v-if="operationFilters.session_id.length" #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                icon="i-lucide-circle-x"
                aria-label="清空会话ID"
                @click="operationFilters.session_id = ''; loadOperationLogs(1)"
              />
            </template>
          </UInput>
          <UInput
            v-model="operationFilters.action"
            placeholder="操作标识"
            size="sm"
            class="w-40"
          />
          <UInput
            v-model="operationFilters.start_date"
            type="date"
            size="sm"
            class="w-36"
          />
          <span class="text-gray-400">-</span>
          <UInput
            v-model="operationFilters.end_date"
            type="date"
            size="sm"
            class="w-36"
          />
        </template>
        <UButton
          color="primary"
          size="sm"
          icon="i-lucide-search"
          @click="handleSearch"
        >
          搜索
        </UButton>
        <UButton
          color="neutral"
          size="sm"
          variant="ghost"
          icon="i-lucide-x"
          @click="activeTab === 'login' ? resetLoginFilters() : resetOperationFilters()"
        >
          重置
        </UButton>
      </div>

      <div class="p-4 space-y-4">
        <div class="flex items-center gap-2">
          <UButton
            size="sm"
            :color="activeTab === 'login' ? 'primary' : 'neutral'"
            :variant="activeTab === 'login' ? 'solid' : 'soft'"
            icon="i-lucide-log-in"
            @click="switchTab('login')"
          >
            登录日志
          </UButton>
          <UButton
            size="sm"
            :color="activeTab === 'operation' ? 'primary' : 'neutral'"
            :variant="activeTab === 'operation' ? 'solid' : 'soft'"
            icon="i-lucide-scroll-text"
            @click="switchTab('operation')"
          >
            操作日志
          </UButton>
          <UButton
            size="sm"
            :color="activeTab === 'online' ? 'primary' : 'neutral'"
            :variant="activeTab === 'online' ? 'solid' : 'soft'"
            icon="i-lucide-users"
            @click="switchTab('online')"
          >
            在线用户
            <UBadge
              v-if="onlineStats.total > 0"
              :label="String(onlineStats.total)"
              color="success"
              size="sm"
              class="ml-1"
            />
          </UButton>
        </div>

        <UCard :ui="{ body: 'p-0' }">
          <UTable
            v-if="activeTab === 'login'"
            :data="loginLogs"
            :columns="loginColumns"
            :loading="loading"
            empty-state-title="暂无登录日志"
            sticky
            class="w-full h-[calc(100vh-240px)]"
          >
            <template #uid-cell="{ row }">
              <div>
                <div class="font-medium">
                  {{ row.original.real_name || row.original.uid || '-' }}
                </div>
                <div v-if="row.original.real_name" class="text-xs text-gray-400">
                  {{ row.original.uid }}
                </div>
              </div>
            </template>

            <template #target_app-cell="{ row }">
              <UBadge color="neutral" variant="subtle" size="xs">
                {{ appLabelMap[row.original.target_app || 'account'] || row.original.target_app || 'account' }}
              </UBadge>
            </template>

            <template #login_type-cell="{ row }">
              <span class="text-sm">{{ typeLabels[row.original.login_type] || row.original.login_type }}</span>
            </template>

            <template #session_id-cell="{ row }">
              <span class="font-mono text-xs">{{ row.original.session_id || '-' }}</span>
            </template>

            <template #login_result-cell="{ row }">
              <div>
                <UBadge :color="resultLabels[row.original.login_result]?.color || 'neutral'" variant="subtle" size="xs">
                  {{ resultLabels[row.original.login_result]?.label || '未知' }}
                </UBadge>
                <div v-if="row.original.login_result === 0 && row.original.failure_reason" class="text-xs text-red-500 dark:text-red-400 mt-1">
                  {{ row.original.failure_reason }}
                </div>
              </div>
            </template>

            <template #ip_address-cell="{ row }">
              <div>
                <div class="font-mono text-sm">
                  {{ row.original.ip_address || '-' }}
                </div>
                <div v-if="row.original.location" class="text-xs text-gray-500">
                  {{ row.original.location }}
                </div>
              </div>
            </template>

            <template #browser-cell="{ row }">
              <div class="text-sm text-gray-500">
                {{ row.original.browser || '-' }}
              </div>
            </template>

            <template #created_at-cell="{ row }">
              <span class="text-sm text-gray-500">{{ formatDateTime(row.original.created_at) }}</span>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex items-center gap-1">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-eye"
                  @click="viewLoginDetail(row.original)"
                >
                  详情
                </UButton>
                <UButton
                  size="xs"
                  color="primary"
                  variant="ghost"
                  icon="i-lucide-link-2"
                  :disabled="!row.original.session_id"
                  @click="viewSessionOperations(row.original.session_id)"
                >
                  同会话操作
                </UButton>
              </div>
            </template>
          </UTable>

          <UTable
            v-else-if="activeTab === 'operation'"
            :data="operationLogs"
            :columns="operationColumns"
            :loading="loading"
            empty-state-title="暂无操作日志"
            sticky
            class="w-full h-[calc(100vh-240px)]"
          >
            <template #uid-cell="{ row }">
              <div>
                <div class="font-medium">
                  {{ getUserDisplay(row.original.uid).name }}
                </div>
                <div v-if="userNameMap[row.original.uid || '']" class="text-xs text-gray-400">
                  {{ row.original.uid }}
                </div>
              </div>
            </template>

            <template #source_app-cell="{ row }">
              <UBadge color="neutral" variant="subtle" size="xs">
                {{ appLabelMap[row.original.source_app || ''] || row.original.source_app || '-' }}
              </UBadge>
            </template>

            <template #action-cell="{ row }">
              <span class="font-mono text-sm">{{ row.original.action }}</span>
            </template>

            <template #session_id-cell="{ row }">
              <span class="font-mono text-xs">{{ row.original.session_id || '-' }}</span>
            </template>

            <template #ip_address-cell="{ row }">
              <span class="font-mono text-sm">{{ row.original.ip_address || '-' }}</span>
            </template>

            <template #created_at-cell="{ row }">
              <span class="text-sm text-gray-500">{{ formatDateTime(row.original.created_at) }}</span>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex items-center gap-1">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-eye"
                  @click="viewOperationDetail(row.original)"
                >
                  详情
                </UButton>
                <UButton
                  size="xs"
                  color="primary"
                  variant="ghost"
                  icon="i-lucide-link-2"
                  :disabled="!row.original.session_id"
                  @click="viewSessionLogins(row.original.session_id)"
                >
                  同会话登录
                </UButton>
              </div>
            </template>
          </UTable>

          <!-- 在线用户 -->
          <div v-else-if="activeTab === 'online'" class="p-4">
            <!-- 统计卡片 -->
            <div class="grid grid-cols-3 gap-4 mb-4">
              <div class="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center">
                <div class="text-2xl font-bold text-green-600 dark:text-green-400">
                  {{ onlineStats.active }}
                </div>
                <div class="text-xs text-green-600/70 dark:text-green-400/70 mt-1">
                  活跃
                </div>
              </div>
              <div class="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 text-center">
                <div class="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {{ onlineStats.idle }}
                </div>
                <div class="text-xs text-amber-600/70 dark:text-amber-400/70 mt-1">
                  空闲
                </div>
              </div>
              <div class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-center">
                <div class="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {{ onlineStats.total }}
                </div>
                <div class="text-xs text-blue-600/70 dark:text-blue-400/70 mt-1">
                  在线总数
                </div>
              </div>
            </div>

            <!-- 用户列表 -->
            <UTable
              :data="onlineUsers"
              :columns="onlineColumns"
              :loading="onlineLoading"
              empty-state-title="暂无在线用户"
              empty-state-description="当前没有用户在线"
              class="w-full"
            >
              <template #uid-cell="{ row }">
                <div>
                  <div class="font-medium">
                    {{ getUserDisplay(row.original.uid).name }}
                  </div>
                  <div v-if="userNameMap[row.original.uid]" class="text-xs text-gray-400">
                    {{ row.original.uid }}
                  </div>
                </div>
              </template>

              <template #sourceApp-cell="{ row }">
                <UBadge color="primary" variant="subtle" size="xs">
                  {{ appNameMap[row.original.sourceApp] || row.original.sourceApp }}
                </UBadge>
              </template>

              <template #page-cell="{ row }">
                <span class="text-sm text-muted font-mono">{{ row.original.page || '-' }}</span>
              </template>

              <template #status-cell="{ row }">
                <div class="flex items-center gap-1.5">
                  <span
                    class="w-2 h-2 rounded-full"
                    :class="row.original.status === 'active' ? 'bg-green-500' : 'bg-amber-500'"
                  />
                  <span :class="row.original.status === 'active' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'">
                    {{ row.original.status === 'active' ? '活跃' : '空闲' }}
                  </span>
                </div>
              </template>

              <template #lastSeen-cell="{ row }">
                <span class="text-sm text-gray-500">{{ formatDateTime(row.original.lastSeen) }}</span>
              </template>
            </UTable>

            <div class="mt-3 flex items-center justify-center gap-2 text-xs text-muted">
              <span>每 30 秒自动刷新 · 超过 5 分钟无心跳视为离线</span>
              <UButton
                icon="i-lucide-refresh-cw"
                size="xs"
                color="neutral"
                variant="ghost"
                :loading="onlineLoading"
                @click="loadOnlineUsers"
              />
            </div>
          </div>

          <div
            v-if="!loading && ((activeTab === 'login' && loginLogs.length > 0) || (activeTab === 'operation' && operationLogs.length > 0))"
            class="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800"
          >
            <div class="text-sm text-gray-500">
              共 {{ activeTab === 'login' ? loginPagination.total : operationPagination.total }} 条日志
            </div>
            <div class="flex items-center gap-2">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-chevron-left"
                :disabled="(activeTab === 'login' ? loginPagination.page : operationPagination.page) <= 1"
                @click="activeTab === 'login' ? loadLoginLogs(loginPagination.page - 1) : loadOperationLogs(operationPagination.page - 1)"
              >
                上一页
              </UButton>
              <span class="text-sm">
                {{ activeTab === 'login' ? loginPagination.page : operationPagination.page }} /
                {{ activeTab === 'login' ? loginPagination.totalPages : operationPagination.totalPages }}
              </span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-chevron-right"
                :disabled="(activeTab === 'login' ? loginPagination.page : operationPagination.page) >= (activeTab === 'login' ? loginPagination.totalPages : operationPagination.totalPages)"
                @click="activeTab === 'login' ? loadLoginLogs(loginPagination.page + 1) : loadOperationLogs(operationPagination.page + 1)"
              >
                下一页
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
    </UDashboardPanel>

    <UModal v-model:open="showLoginDetailModal" title="登录日志详情">
      <template #body>
        <div v-if="currentLoginLog" class="space-y-3 p-2">
          <div>
            <div class="text-xs text-gray-500">
              用户
            </div>
            <div class="font-medium">
              {{ currentLoginLog.real_name || currentLoginLog.uid }}
            </div>
            <div v-if="currentLoginLog.real_name" class="text-xs text-gray-400">
              {{ currentLoginLog.uid }}
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-500">
              目标应用
            </div>
            <div>{{ appLabelMap[currentLoginLog.target_app || 'account'] || currentLoginLog.target_app || 'account' }}</div>
          </div>
        </div>
        <div>
          <div class="text-xs text-gray-500">
            会话ID
          </div>
          <div class="font-mono break-all text-xs">
            {{ currentLoginLog?.session_id || '-' }}
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-gray-500">
              登录方式
            </div>
            <div>{{ currentLoginLog ? (typeLabels[currentLoginLog.login_type] || currentLoginLog.login_type) : '-' }}</div>
          </div>
          <div>
            <div class="text-xs text-gray-500">
              登录结果
            </div>
            <UBadge :color="currentLoginLog ? (resultLabels[currentLoginLog.login_result]?.color || 'neutral') : 'neutral'" variant="subtle" size="xs">
              {{ currentLoginLog ? (resultLabels[currentLoginLog.login_result]?.label || '未知') : '未知' }}
            </UBadge>
          </div>
        </div>
        <div v-if="currentLoginLog?.failure_reason">
          <div class="text-xs text-gray-500">
            失败原因
          </div>
          <div class="text-red-500 dark:text-red-400">
            {{ currentLoginLog?.failure_reason }}
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-gray-500">
              IP地址
            </div>
            <div class="font-mono">
              {{ currentLoginLog?.ip_address || '-' }}
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-500">
              地点
            </div>
            <div>{{ currentLoginLog?.location || '-' }}</div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-gray-500">
              浏览器
            </div>
            <div class="text-sm">
              {{ currentLoginLog?.browser || '-' }}
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-500">
              操作系统
            </div>
            <div class="text-sm">
              {{ currentLoginLog?.os || '-' }}
            </div>
          </div>
        </div>
        <div>
          <div class="text-xs text-gray-500">
            设备信息
          </div>
          <div class="text-sm">
            {{ currentLoginLog?.device || '-' }}
          </div>
        </div>
        <div>
          <div class="text-xs text-gray-500">
            <div>登录时间</div>
            <div>{{ currentLoginLog ? formatDateTime(currentLoginLog.created_at) : '-' }}</div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="查看同会话操作"
            color="primary"
            variant="soft"
            icon="i-lucide-link-2"
            :disabled="!currentLoginLog?.session_id"
            @click="viewSessionOperations(currentLoginLog?.session_id || null)"
          />
          <UButton
            color="neutral"
            variant="ghost"
            label="关闭"
            @click="showLoginDetailModal = false"
          />
        </div>
      </template>

      <UModal v-model:open="showOperationDetailModal" title="操作日志详情">
        <template #body>
          <div v-if="currentOperationLog" class="space-y-3 p-2">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <div class="text-xs text-gray-500">
                  操作者
                </div>
                <div class="font-medium">
                  {{ currentOperationLog.uid || '-' }}
                </div>
              </div>
              <div>
                <div class="text-xs text-gray-500">
                  来源应用
                </div>
                <div>{{ appLabelMap[currentOperationLog.source_app || ''] || currentOperationLog.source_app || '-' }}</div>
              </div>
            </div>
            <div>
              <div class="text-xs text-gray-500">
                会话ID
              </div>
              <div class="font-mono break-all text-xs">
                {{ currentOperationLog.session_id || '-' }}
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <div class="text-xs text-gray-500">
                  操作标识
                </div>
                <div class="font-mono text-sm">
                  {{ currentOperationLog.action }}
                </div>
              </div>
              <div>
                <div class="text-xs text-gray-500">
                  IP地址
                </div>
                <div class="font-mono">
                  {{ currentOperationLog.ip_address || '-' }}
                </div>
              </div>
            </div>
            <div>
              <div class="text-xs text-gray-500">
                详情
              </div>
              <pre class="text-xs bg-gray-50 dark:bg-gray-900 rounded-md p-3 overflow-auto max-h-64">{{ formattedOperationDetail }}</pre>
            </div>
            <div>
              <div class="text-xs text-gray-500">
                操作时间
              </div>
              <div>{{ formatDateTime(currentOperationLog.created_at) }}</div>
            </div>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              color="primary"
              variant="soft"
              icon="i-lucide-link-2"
              :disabled="!currentOperationLog?.session_id"
              label="查看同会话登录"
              @click="viewSessionLogins(currentOperationLog?.session_id || null)"
            />
            <UButton
              color="neutral"
              variant="ghost"
              label="关闭"
              @click="showOperationDetailModal = false"
            />
          </div>
        </template>
      </UModal>
    </umodal>
  </div>
</template>
