<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('日志管理')

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
  action: string
  detail: string | null
  ip_address: string | null
  created_at: string
}

type OnlineUser = {
  uid: string
  sourceApp: string
  page: string | null
  status: 'active' | 'idle'
  lastSeen: string
}

const toast = useToast()
const activeTab = ref<'login' | 'operation' | 'simulation' | 'online'>('login')
const loading = ref(false)
const onlineLoading = ref(false)
const onlineTimer = ref<ReturnType<typeof setInterval> | null>(null)

const appOptions = ref([{ label: '全部应用', value: 'all' }])
const loginLogs = ref<LoginLog[]>([])
const operationLogs = ref<OperationLog[]>([])
const onlineUsers = ref<OnlineUser[]>([])
const selectedLoginLog = ref<LoginLog | null>(null)
const selectedOperationLog = ref<OperationLog | null>(null)
const showLoginDetail = ref(false)
const showOperationDetail = ref(false)

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
  { label: 'OAuth 登录', value: 'oauth' },
  { label: 'OIDC 登录', value: 'oidc' },
  { label: '企业微信', value: 'wecom' }
]

const simulationActionOptions = [
  { label: '全部模拟动作', value: '' },
  { label: '创建会话', value: 'simulation.create' },
  { label: '退出会话', value: 'simulation.delete' },
  { label: '会话过期', value: 'simulation.expired' },
  { label: '策略失效', value: 'simulation.invalidated' },
  { label: '授权拒绝', value: 'simulation.denied' },
  { label: '创建失败', value: 'simulation.failed' },
  { label: '高危拦截', value: 'simulation.blocked' }
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

const formattedOperationDetail = computed(() => {
  const detail = selectedOperationLog.value?.detail
  if (!detail) return '-'
  try {
    return JSON.stringify(JSON.parse(detail), null, 2)
  } catch {
    return detail
  }
})

function displayUser(uid: string | null, realName?: string | null) {
  if (!uid) return '-'
  return realName ? `${realName} (${uid})` : uid
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

function appLabel(appCode: string | null | undefined) {
  if (!appCode) return '-'
  return operationSourceOptions.value.find(item => item.value === appCode)?.label || appCode
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
    const res = await $fetch<ApiResponse<PagedResponse<OperationLog>>>('/api/v1/operation-logs', {
      query: {
        page,
        pageSize: operationPagination.value.pageSize,
        uid: operationFilters.value.uid || undefined,
        source_app: simulationAudit
          ? 'authorization_simulation'
          : operationFilters.value.source_app === 'all' ? undefined : operationFilters.value.source_app,
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
  } catch (error) {
    toast.add({ color: 'error', title: '加载操作日志失败', description: error instanceof Error ? error.message : String(error) })
  } finally {
    loading.value = false
  }
}

async function loadOnlineUsers() {
  onlineLoading.value = true
  try {
    const res = await $fetch<{ data?: { items?: OnlineUser[] } }>('/api/v1/heartbeat/online')
    onlineUsers.value = res.data?.items || []
  } catch {
    onlineUsers.value = []
  } finally {
    onlineLoading.value = false
  }
}

function handleSearch() {
  if (activeTab.value === 'login') {
    loadLoginLogs(1)
  } else if (activeTab.value === 'operation' || activeTab.value === 'simulation') {
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
    operationFilters.value = { uid: '', source_app: 'authorization_simulation', session_id: '', action: '', start_date: '', end_date: '' }
    loadOperationLogs(1)
  } else {
    operationFilters.value = { uid: '', source_app: 'all', session_id: '', action: '', start_date: '', end_date: '' }
    loadOperationLogs(1)
  }
}

function switchTab(tab: 'login' | 'operation' | 'simulation' | 'online') {
  const previousTab = activeTab.value
  activeTab.value = tab
  if (tab === 'login' && loginLogs.value.length === 0) loadLoginLogs()
  if (tab === 'operation') {
    if (previousTab === 'simulation') {
      operationFilters.value = { uid: '', source_app: 'all', session_id: '', action: '', start_date: '', end_date: '' }
    }
    if (operationLogs.value.length === 0 || previousTab === 'simulation') loadOperationLogs()
  }
  if (tab === 'simulation') {
    operationFilters.value = {
      ...operationFilters.value,
      source_app: 'authorization_simulation'
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
  loadAppOptions()
  loadLoginLogs()
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

        <UCard v-if="activeTab === 'login'" :ui="{ body: 'p-0' }">
          <UTable
            :data="loginLogs"
            :columns="loginColumns"
            :loading="loading"
            class="h-[calc(100vh-260px)]"
          >
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

        <UCard v-else-if="activeTab === 'operation' || activeTab === 'simulation'" :ui="{ body: 'p-0' }">
          <UTable
            :data="operationLogs"
            :columns="operationColumns"
            :loading="loading"
            class="h-[calc(100vh-260px)]"
          >
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
        </dt><dd>{{ selectedLoginLog.login_type }}</dd>
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
      <div class="flex justify-end">
        <UButton color="neutral" variant="outline" @click="showOperationDetail = false">
          关闭
        </UButton>
      </div>
    </template>
  </UModal>
</template>
