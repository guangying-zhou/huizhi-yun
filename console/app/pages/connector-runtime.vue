<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('企业连接运行时')

type ApiResponse<T> = { code: number, data: T, message?: string }
type ConnectorMetadata = {
  packageBaseUrl: string
  consoleApiUrl: string
  issuer: string
  audience: string
  tenantCode: string
  deploymentCode: string
  port: string
  sqlitePath: string
  serviceName: string
  updateTimer: string
  releaseSigningKeyId: string | null
  runtimeApiUrl: string | null
  dataRuntimeApiUrl: string | null
  enrollmentCodeLast4?: string
  expiresAt?: string
  installCommand: string
  connector: null | {
    connectorId: string
    version: string | null
    status: string
    lastSeenAt: string | null
    lastHeartbeatAt?: string | null
    runtimeStartedAt?: string | null
    heartbeatStale?: boolean
    metrics?: Record<string, unknown> | null
  }
}
type SettingValue = { settingKey: string, value: unknown, scopeKey: string }
type WecomCheckStatus = 'pass' | 'warn' | 'fail'
type WecomCheckItem = { key: string, label: string, status: WecomCheckStatus, message: string }
type WecomConfigCheck = {
  integrationCode: string
  checkedAt: string
  ready: boolean
  runtime: { apiUrl: string | null }
  integration: {
    exists: boolean
    status: string
    baseUrl: string
    corpidConfigured: boolean
    agentidConfigured: boolean
    credentialBound: boolean
    secretResolved: boolean
  } | null
  checks: WecomCheckItem[]
}
type WecomTestResult = {
  integrationCode: string
  touser: string
  status: string
  sentAt: string
  deliveryMode?: string
  replayVerified?: boolean | null
  messageCenter?: {
    logged: boolean
    notificationId?: string
    error?: string
  }
}

const toast = useToast()
const commandPending = ref(false)
const saving = ref(false)
const identityActivationPending = ref(false)
const dingtalkIdentityActivationPending = ref(false)
const runtimeApiUrl = ref('')
const diagnosticsPending = ref(false)
const diagnosticsData = ref<Record<string, unknown> | null>(null)
const revokePending = ref(false)
const wecomChecking = ref(false)
const wecomSending = ref(false)
const wecomTestAccount = ref('')
const wecomCheckResult = ref<WecomConfigCheck | null>(null)
let metadataRefreshTimer: ReturnType<typeof setTimeout> | null = null
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const { confirm } = useConfirm()
const { isNotificationsSlideoverOpen } = useDashboard()
const { loadSummary, loadNotifications, status: notificationStatus } = useNotifications()

if (!permissionsLoaded.value) await loadPermissions()

const emptyMetadata: ConnectorMetadata = {
  packageBaseUrl: '',
  consoleApiUrl: '',
  issuer: '',
  audience: 'connector-runtime',
  tenantCode: '',
  deploymentCode: '',
  port: '18082',
  sqlitePath: '/opt/hzy/connector-runtime/data/operations.db',
  serviceName: 'hzy-connector-runtime',
  updateTimer: 'hzy-connector-runtime-update.timer',
  releaseSigningKeyId: null,
  runtimeApiUrl: null,
  dataRuntimeApiUrl: null,
  installCommand: '',
  connector: null
}

const { data: metadataData, refresh: refreshMetadata } = await useFetch<ApiResponse<ConnectorMetadata>>(
  '/api/v1/console/connector-runtime/install-command',
  { default: () => ({ code: 0, data: emptyMetadata }) }
)
const { data: settingsData, refresh: refreshSettings } = await useFetch<ApiResponse<{ items: SettingValue[] }>>(
  '/api/v1/console/settings/values',
  {
    query: { keys: 'connector.runtimeApiUrl,connector.identityEnabled,connector.dingtalkIdentityEnabled' },
    default: () => ({ code: 0, data: { items: [] } })
  }
)

async function refreshMetadataPreservingCommand() {
  const current = metadataData.value?.data
  const result = await $fetch<ApiResponse<ConnectorMetadata>>('/api/v1/console/connector-runtime/install-command')
  const commandStillValid = Boolean(
    current?.installCommand
    && current.expiresAt
    && new Date(current.expiresAt).getTime() > Date.now()
    && current.connector?.lastSeenAt === result.data.connector?.lastSeenAt
  )
  metadataData.value = commandStillValid
    ? {
        ...result,
        data: {
          ...result.data,
          installCommand: current!.installCommand,
          enrollmentCodeLast4: current!.enrollmentCodeLast4,
          expiresAt: current!.expiresAt
        }
      }
    : result
}

const metadata = computed(() => metadataData.value?.data || emptyMetadata)
const runtimeSetting = computed(() => settingsData.value?.data.items.find(item => item.settingKey === 'connector.runtimeApiUrl') || null)
const identitySetting = computed(() => settingsData.value?.data.items.find(item => item.settingKey === 'connector.identityEnabled') || null)
const dingtalkIdentitySetting = computed(() => settingsData.value?.data.items.find(item => item.settingKey === 'connector.dingtalkIdentityEnabled') || null)
const canEdit = computed(() => permissionsLoaded.value && hasPermission('system_settings', 'edit'))
const canAdmin = computed(() => permissionsLoaded.value && hasPermission('system_settings', 'admin'))
const canTestNotifications = computed(() => permissionsLoaded.value && hasPermission('integration_config', 'edit'))
const registered = computed(() => metadata.value.connector?.status === 'active')
const identityEnabled = computed(() => identitySetting.value?.value === true)
const dingtalkIdentityEnabled = computed(() => dingtalkIdentitySetting.value?.value === true)
const wecomReadyLabel = computed(() => {
  if (!wecomCheckResult.value) return '未检测'
  return wecomCheckResult.value.ready ? '配置完整' : '待处理'
})
const wecomReadyColor = computed(() => {
  if (!wecomCheckResult.value) return 'neutral'
  return wecomCheckResult.value.ready ? 'success' : 'warning'
})
const heartbeatStale = computed(() => registered.value && metadata.value.connector?.heartbeatStale === true)
const statusLabel = computed(() => {
  if (metadata.value.connector?.status === 'revoked') return '已吊销'
  if (heartbeatStale.value) return '心跳过期'
  return registered.value ? '运行中' : '未安装'
})
const statusColor = computed(() => {
  if (metadata.value.connector?.status === 'revoked') return 'error' as const
  if (heartbeatStale.value) return 'warning' as const
  return registered.value ? 'success' as const : 'neutral' as const
})

watch(runtimeSetting, (value) => {
  runtimeApiUrl.value = String(value?.value || metadata.value.runtimeApiUrl || '')
}, { immediate: true })

function errorMessage(error: unknown) {
  const normalized = error as { data?: { message?: string }, message?: string }
  return normalized.data?.message || normalized.message || String(error)
}

async function setIdentityActivation(provider: 'wecom' | 'dingtalk', enabled: boolean) {
  if (!canAdmin.value) return
  const pending = provider === 'dingtalk' ? dingtalkIdentityActivationPending : identityActivationPending
  const providerLabel = provider === 'dingtalk' ? '钉钉' : '企业微信'
  pending.value = true
  try {
    await $fetch('/api/v1/console/connector-runtime/identity-activation', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: { enabled, provider }
    })
    await refreshSettings()
    toast.add({
      color: 'success',
      title: enabled ? `${providerLabel}身份能力已启用` : `${providerLabel}身份能力已停用`,
      description: enabled ? '登录授权码将只由 Connector Runtime 交换' : `新的${providerLabel}登录会失败关闭`
    })
  } catch (error) {
    toast.add({ color: 'error', title: '身份能力切换失败', description: errorMessage(error) })
  } finally {
    pending.value = false
  }
}

function formatTime(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

function checkColor(status: WecomCheckStatus) {
  if (status === 'pass') return 'success' as const
  if (status === 'warn') return 'warning' as const
  return 'error' as const
}

function checkIcon(status: WecomCheckStatus) {
  if (status === 'pass') return 'i-lucide-circle-check'
  if (status === 'warn') return 'i-lucide-triangle-alert'
  return 'i-lucide-circle-x'
}

async function refreshNotificationCenter() {
  await loadSummary()
  if (isNotificationsSlideoverOpen.value) {
    await loadNotifications({ status: notificationStatus.value })
  }
}

async function checkWecomConfig() {
  if (!canTestNotifications.value) return
  wecomChecking.value = true
  try {
    const response = await $fetch<ApiResponse<WecomConfigCheck>>('/api/v1/console/notification-runtime/wecom-check', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: { integrationCode: 'wecom.default' }
    })
    wecomCheckResult.value = response.data
    toast.add({
      color: response.data.ready ? 'success' : 'warning',
      title: response.data.ready ? '企业微信配置完整' : '企业微信配置待处理'
    })
  } catch (error) {
    toast.add({ color: 'error', title: '检测失败', description: errorMessage(error) })
  } finally {
    wecomChecking.value = false
  }
}

async function sendWecomTest() {
  if (!canTestNotifications.value) return
  const touser = wecomTestAccount.value.trim()
  if (!touser) {
    toast.add({ color: 'warning', title: '请输入企业微信账号' })
    return
  }

  wecomSending.value = true
  try {
    const response = await $fetch<ApiResponse<WecomTestResult>>('/api/v1/console/notification-runtime/wecom-test', {
      method: 'POST',
      body: {
        integrationCode: 'wecom.default',
        touser,
        requestKey: globalThis.crypto.randomUUID()
      }
    })
    toast.add({
      color: 'success',
      title: '企业微信测试消息已发送',
      description: response.data.messageCenter?.logged
        ? `接收人：${response.data.touser}。发送记录已保存到消息中心。`
        : `接收人：${response.data.touser}。`
    })
    await refreshNotificationCenter()
  } catch (error) {
    toast.add({ color: 'error', title: '发送失败', description: errorMessage(error) })
    await refreshNotificationCenter().catch(() => undefined)
  } finally {
    wecomSending.value = false
  }
}

async function generateCommand() {
  if (!canAdmin.value) return
  commandPending.value = true
  try {
    metadataData.value = await $fetch<ApiResponse<ConnectorMetadata>>(
      '/api/v1/console/connector-runtime/install-command',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() }
      }
    )
    toast.add({ color: 'success', title: '安装指令已生成', description: '安装码 15 分钟内有效且只能使用一次' })
  } catch (error) {
    toast.add({ color: 'error', title: '生成失败', description: errorMessage(error) })
  } finally {
    commandPending.value = false
  }
}

async function copyCommand() {
  if (!metadata.value.installCommand) return
  await navigator.clipboard.writeText(metadata.value.installCommand)
  toast.add({ color: 'success', title: '已复制', description: '请在企业固定出口 Linux 服务器执行' })
}

async function runDiagnostics() {
  diagnosticsPending.value = true
  try {
    const result = await $fetch<ApiResponse<Record<string, unknown>>>('/api/v1/console/connector-runtime/diagnostics')
    diagnosticsData.value = result.data
    await refreshMetadata()
    toast.add({ color: 'success', title: '诊断完成', description: '仅返回聚合计数，不包含用户、消息正文或凭证。' })
  } catch (error) {
    toast.add({ color: 'error', title: '诊断失败', description: errorMessage(error) })
  } finally {
    diagnosticsPending.value = false
  }
}

async function revokeRuntime() {
  if (!canAdmin.value || !registered.value) return
  if (!(await confirm({
    title: '吊销企业连接运行时',
    message: '吊销后该实例会停止心跳、身份交换、通知和同步；恢复需要重新生成并执行安装指令。是否继续？',
    confirmLabel: '确认吊销',
    tone: 'danger'
  }))) return
  revokePending.value = true
  try {
    await $fetch('/api/v1/console/connector-runtime/revoke', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() }
    })
    await refreshMetadata()
    toast.add({ color: 'success', title: '实例已吊销', description: '服务凭证和未使用安装码已同时失效。' })
  } catch (error) {
    toast.add({ color: 'error', title: '吊销失败', description: errorMessage(error) })
  } finally {
    revokePending.value = false
  }
}

async function saveRuntimeUrl() {
  if (!canEdit.value) return
  saving.value = true
  try {
    await $fetch('/api/v1/console/settings/values/connector.runtimeApiUrl', {
      method: 'PUT',
      body: { value: runtimeApiUrl.value.trim() }
    })
    await Promise.all([refreshSettings(), refreshMetadata()])
    toast.add({ color: 'success', title: '已保存', description: '企业连接运行时地址已更新' })
  } catch (error) {
    toast.add({ color: 'error', title: '保存失败', description: errorMessage(error) })
  } finally {
    saving.value = false
  }
}

onBeforeUnmount(() => {
  if (metadataRefreshTimer) clearTimeout(metadataRefreshTimer)
})

onMounted(() => {
  const queueMetadataRefresh = () => {
    metadataRefreshTimer = setTimeout(async () => {
      await refreshMetadataPreservingCommand()
      queueMetadataRefresh()
    }, 30_000)
  }
  queueMetadataRefresh()
})
</script>

<template>
  <UDashboardPanel id="connector-runtime" :ui="dashboardPanelUi">
    <template #header>
      <UDashboardNavbar title="企业连接运行时">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UBadge :color="statusColor" variant="subtle">
            {{ statusLabel }}
          </UBadge>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-4 pb-20">
        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-shield-check"
          title="固定出口、类型化能力"
          description="运行时只执行已注册的企业微信、钉钉和 People 能力，不接受任意 URL、方法、请求头或脚本。"
        />

        <UAlert
          v-if="!metadata.releaseSigningKeyId"
          color="error"
          variant="soft"
          icon="i-lucide-key-round"
          title="发布信任公钥未配置"
          description="请先在 Console Worker 配置 HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_PEM_BASE64；未建立独立 Ed25519 trust anchor 时禁止生成安装指令。"
        />

        <UAlert
          v-if="!metadata.dataRuntimeApiUrl"
          color="error"
          variant="soft"
          icon="i-lucide-network"
          title="Data Runtime 地址未配置或不安全"
          description="Connector Runtime 与 data-runtime 分机部署时，必须先在“数据运行时”页面配置 HTTPS origin；安装指令不会默认回退到本机地址。"
        />

        <div class="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div class="rounded-lg border border-default bg-default p-4">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 class="text-sm font-semibold text-highlighted">
                  Runtime 地址
                </h2>
                <p class="text-xs text-muted">
                  迁移验证通过后，业务模块通过该地址调用 Connector Runtime。
                </p>
              </div>
              <UButton
                icon="i-lucide-save"
                variant="subtle"
                :loading="saving"
                :disabled="!canEdit"
                aria-label="保存 Runtime 地址"
                @click="saveRuntimeUrl"
              />
            </div>
            <UInput
              v-model="runtimeApiUrl"
              type="url"
              class="w-full"
              placeholder="https://connector.example.com"
              :disabled="!canEdit"
            />
            <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-3">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  企业微信登录身份交换
                </p>
                <p class="text-xs text-muted">
                  启用前验证精确 identity capability；授权码不在 Cloudflare 直接兑换供应商 token。
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge :color="identityEnabled ? 'success' : 'neutral'" variant="soft">
                  {{ identityEnabled ? '已启用' : '未启用' }}
                </UBadge>
                <UButton
                  :icon="identityEnabled ? 'i-lucide-shield-off' : 'i-lucide-scan-face'"
                  :color="identityEnabled ? 'warning' : 'primary'"
                  variant="subtle"
                  :loading="identityActivationPending"
                  :disabled="!canAdmin || (!identityEnabled && (!registered || !runtimeApiUrl.trim()))"
                  @click="setIdentityActivation('wecom', !identityEnabled)"
                >
                  {{ identityEnabled ? '停用身份交换' : '验证并启用' }}
                </UButton>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-3">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  钉钉登录身份交换
                </p>
                <p class="text-xs text-muted">
                  只允许类型化授权码交换；钉钉 access token 不进入 Cloudflare。
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge :color="dingtalkIdentityEnabled ? 'success' : 'neutral'" variant="soft">
                  {{ dingtalkIdentityEnabled ? '已启用' : '未启用' }}
                </UBadge>
                <UButton
                  :icon="dingtalkIdentityEnabled ? 'i-lucide-shield-off' : 'i-lucide-scan-face'"
                  :color="dingtalkIdentityEnabled ? 'warning' : 'primary'"
                  variant="subtle"
                  :loading="dingtalkIdentityActivationPending"
                  :disabled="!canAdmin || (!dingtalkIdentityEnabled && (!registered || !runtimeApiUrl.trim()))"
                  @click="setIdentityActivation('dingtalk', !dingtalkIdentityEnabled)"
                >
                  {{ dingtalkIdentityEnabled ? '停用身份交换' : '验证并启用' }}
                </UButton>
              </div>
            </div>
          </div>

          <div class="rounded-lg border border-default bg-default p-4">
            <h2 class="mb-3 text-sm font-semibold text-highlighted">
              实例登记
            </h2>
            <dl class="grid grid-cols-[7rem_1fr] gap-2 text-sm">
              <dt class="text-muted">
                状态
              </dt><dd>
                <UBadge :color="statusColor" variant="soft">
                  {{ statusLabel }}
                </UBadge>
              </dd>
              <dt class="text-muted">
                实例
              </dt><dd class="break-all font-mono">
                {{ metadata.connector?.connectorId || '-' }}
              </dd>
              <dt class="text-muted">
                版本
              </dt><dd class="font-mono">
                {{ metadata.connector?.version || '-' }}
              </dd>
              <dt class="text-muted">
                最近登记
              </dt><dd>{{ formatTime(metadata.connector?.lastSeenAt) }}</dd>
              <dt class="text-muted">
                最近心跳
              </dt><dd>{{ formatTime(metadata.connector?.lastHeartbeatAt) }}</dd>
              <dt class="text-muted">
                本次启动
              </dt><dd>{{ formatTime(metadata.connector?.runtimeStartedAt) }}</dd>
              <dt class="text-muted">
                Tenant
              </dt><dd class="font-mono">
                {{ metadata.tenantCode }}
              </dd>
              <dt class="text-muted">
                Deployment
              </dt><dd class="break-all font-mono">
                {{ metadata.deploymentCode }}
              </dd>
            </dl>
            <div class="mt-3 flex flex-wrap gap-2 border-t border-default pt-3">
              <UButton
                icon="i-lucide-stethoscope"
                color="neutral"
                variant="subtle"
                :loading="diagnosticsPending"
                :disabled="!registered"
                @click="runDiagnostics"
              >
                运行诊断
              </UButton>
              <UButton
                icon="i-lucide-shield-x"
                color="error"
                variant="subtle"
                :loading="revokePending"
                :disabled="!canAdmin || !registered"
                @click="revokeRuntime"
              >
                吊销实例
              </UButton>
            </div>
            <pre v-if="diagnosticsData" class="mt-3 max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs text-highlighted">{{ JSON.stringify(diagnosticsData, null, 2) }}</pre>
          </div>
        </div>

        <div v-if="canTestNotifications" class="rounded-lg border border-default bg-default p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-highlighted">
                企业微信消息测试
              </h2>
              <p class="text-xs text-muted">
                使用当前企业连接运行时检测配置，并向指定企业微信账号发送测试消息。
              </p>
            </div>
            <div class="flex items-center gap-2">
              <UBadge :color="wecomReadyColor" variant="subtle">
                {{ wecomReadyLabel }}
              </UBadge>
              <UButton
                icon="i-lucide-list-checks"
                color="neutral"
                variant="subtle"
                :loading="wecomChecking"
                @click="checkWecomConfig"
              >
                检测配置
              </UButton>
            </div>
          </div>

          <div class="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
            <div class="grid gap-2 sm:grid-cols-2">
              <div
                v-for="item in wecomCheckResult?.checks || []"
                :key="item.key"
                class="rounded-md border border-default bg-muted/30 p-3"
              >
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="checkIcon(item.status)"
                    class="size-4"
                    :class="{
                      'text-success': item.status === 'pass',
                      'text-warning': item.status === 'warn',
                      'text-error': item.status === 'fail'
                    }"
                  />
                  <span class="text-sm font-medium text-highlighted">{{ item.label }}</span>
                  <UBadge :color="checkColor(item.status)" variant="soft" size="sm">
                    {{ item.status }}
                  </UBadge>
                </div>
                <p class="mt-2 break-all text-xs text-muted">
                  {{ item.message }}
                </p>
              </div>
              <div
                v-if="!wecomCheckResult"
                class="rounded-md border border-dashed border-default bg-muted/20 p-3 text-sm text-muted"
              >
                未检测
              </div>
            </div>

            <div class="rounded-md border border-default bg-muted/30 p-3">
              <UFormField label="发送测试消息">
                <UInput
                  v-model="wecomTestAccount"
                  icon="i-lucide-user"
                  class="w-full"
                  placeholder="企业微信账号 / UserID"
                  :disabled="wecomSending"
                  @keyup.enter="sendWecomTest"
                />
              </UFormField>
              <div class="mt-3 flex justify-end">
                <UButton
                  icon="i-lucide-send"
                  :loading="wecomSending"
                  :disabled="!wecomTestAccount.trim()"
                  @click="sendWecomTest"
                >
                  发送测试
                </UButton>
              </div>
            </div>
          </div>
        </div>

        <div class="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <div class="rounded-lg border border-default bg-default p-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 class="text-sm font-semibold text-highlighted">
                  一键安装
                </h2>
                <p class="text-xs text-muted">
                  命令不包含长期 client secret；单次安装码在服务器本地兑换。
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  icon="i-lucide-terminal"
                  variant="subtle"
                  :loading="commandPending"
                  :disabled="!canAdmin || !metadata.releaseSigningKeyId || !metadata.dataRuntimeApiUrl"
                  @click="generateCommand"
                >
                  {{ registered ? '生成轮换指令' : '生成指令' }}
                </UButton>
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="subtle"
                  :disabled="!metadata.installCommand"
                  @click="copyCommand"
                >
                  复制
                </UButton>
              </div>
            </div>
            <pre class="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs leading-5 text-highlighted">{{ metadata.installCommand || '点击“生成指令”后显示一次性 curl 安装命令。' }}</pre>
            <p v-if="metadata.expiresAt" class="mt-2 text-xs text-warning">
              安装码尾号 {{ metadata.enrollmentCodeLast4 }}，有效至 {{ formatTime(metadata.expiresAt) }}。
            </p>
          </div>

          <div class="rounded-lg border border-default bg-default p-4">
            <h2 class="mb-3 text-sm font-semibold text-highlighted">
              当前能力与运行参数
            </h2>
            <div class="mb-4 flex flex-wrap gap-2">
              <UBadge color="success" variant="soft">
                WeCom 通知
              </UBadge>
              <UBadge color="success" variant="soft">
                WeCom Identity
              </UBadge>
              <UBadge color="success" variant="soft">
                DingTalk 通知与 Identity
              </UBadge>
              <UBadge color="success" variant="soft">
                DingTalk People Sync
              </UBadge>
            </div>
            <dl class="grid grid-cols-[7rem_1fr] gap-2 text-sm">
              <dt class="text-muted">
                Audience
              </dt><dd class="font-mono">
                {{ metadata.audience }}
              </dd>
              <dt class="text-muted">
                端口
              </dt><dd class="font-mono">
                {{ metadata.port }}
              </dd>
              <dt class="text-muted">
                SQLite
              </dt><dd class="break-all font-mono">
                {{ metadata.sqlitePath }}
              </dd>
              <dt class="text-muted">
                Data Runtime
              </dt><dd class="break-all font-mono">
                {{ metadata.dataRuntimeApiUrl || '未配置' }}
              </dd>
              <dt class="text-muted">
                服务
              </dt><dd class="font-mono">
                {{ metadata.serviceName }}
              </dd>
              <dt class="text-muted">
                更新任务
              </dt><dd class="font-mono">
                {{ metadata.updateTimer }}
              </dd>
              <dt class="text-muted">
                发布签名
              </dt><dd class="break-all font-mono">
                {{ metadata.releaseSigningKeyId || '未配置' }}
              </dd>
              <dt class="text-muted">
                凭证来源
              </dt><dd>Console Vault</dd>
            </dl>
          </div>
        </div>

        <div class="rounded-lg border border-default bg-default p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-highlighted">
                钉钉 People 能力
              </h2>
              <p class="text-xs text-muted">
                Connector Runtime 继续提供企业侧钉钉读取和签名批次投递；业务同步入口由 People 管理。
              </p>
              <p class="mt-1 text-xs text-warning">
                Console 仅保留运行时安装、心跳和能力诊断，不再直接发起组织同步。
              </p>
            </div>
            <UButton icon="i-lucide-external-link" variant="soft" to="/shell/people?target=%2Fpeople%2Fsettings%2Fhr-source-sync">
              前往 People 人事事实源
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
