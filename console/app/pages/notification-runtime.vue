<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('通知运行时')

type ApiResponse<T> = {
  code: number
  data: T
  message?: string
}

type InstallCommand = {
  packageBaseUrl: string
  consoleApiUrl: string
  tokenUrl: string
  issuer: string
  jwksUrl: string
  audience: string
  clientId: string
  clientSecretLast4: string | null
  tenantCode: string
  deploymentCode: string
  port: string
  runtimeApiUrl: string | null
  serviceName: string
  updateTimer: string
  rotated: boolean
  installCommand: string
}

type SettingValue = {
  settingKey: string
  value: unknown
  scopeKey: string
}

type WecomCheckStatus = 'pass' | 'warn' | 'fail'

type WecomCheckItem = {
  key: string
  label: string
  status: WecomCheckStatus
  message: string
}

type WecomConfigCheck = {
  integrationCode: string
  checkedAt: string
  ready: boolean
  runtime: {
    apiUrl: string | null
  }
  integration: {
    exists: boolean
    status: string
    baseUrl: string
    corpidConfigured: boolean
    agentidConfigured: boolean
    credentialBound: boolean
    secretCode: string | null
    secretVersionNo: number | null
    secretResolved: boolean
  } | null
  serviceClient: {
    clientId: string
    grants: string[]
    missingGrants: string[]
  } | null
  checks: WecomCheckItem[]
}

type WecomTestResult = {
  integrationCode: string
  touser: string
  status: string
  sentAt: string
  deliveryMode?: string
  messageCenter?: {
    logged: boolean
    notificationId?: string
    error?: string
  }
}

const toast = useToast()
const { isNotificationsSlideoverOpen } = useDashboard()
const { loadSummary, loadNotifications, status: notificationStatus } = useNotifications()
const saving = ref(false)
const commandPending = ref(false)
const wecomChecking = ref(false)
const wecomSending = ref(false)
const wecomTestAccount = ref('')
const wecomCheckResult = ref<WecomConfigCheck | null>(null)
const runtimeApiUrl = ref('')

const { data: installData, refresh: refreshInstall } = await useFetch<ApiResponse<InstallCommand>>(
  '/api/v1/console/notification-runtime/install-command',
  {
    default: () => ({
      code: 0,
      data: {
        packageBaseUrl: '',
        consoleApiUrl: '',
        tokenUrl: '',
        issuer: '',
        jwksUrl: '',
        audience: 'notification-runtime',
        clientId: 'notification-runtime',
        clientSecretLast4: null,
        tenantCode: 'default',
        deploymentCode: 'local',
        port: '18081',
        runtimeApiUrl: null,
        serviceName: 'hzy-notification-runtime',
        updateTimer: 'hzy-notification-runtime-update.timer',
        rotated: false,
        installCommand: ''
      }
    })
  }
)

const { data: settingsData, refresh: refreshSettings } = await useFetch<ApiResponse<{ items: SettingValue[] }>>(
  '/api/v1/console/settings/values',
  {
    query: { keys: 'notification.runtimeApiUrl' },
    default: () => ({ code: 0, data: { items: [] } })
  }
)

const install = computed(() => installData.value?.data)
const runtimeSetting = computed(() => settingsData.value?.data.items[0] || null)
const statusLabel = computed(() => runtimeApiUrl.value ? '已配置' : '未启用')
const statusColor = computed(() => runtimeApiUrl.value ? 'success' : 'neutral')
const wecomReadyLabel = computed(() => {
  if (!wecomCheckResult.value) return '未检测'
  return wecomCheckResult.value.ready ? '配置完整' : '待处理'
})
const wecomReadyColor = computed(() => {
  if (!wecomCheckResult.value) return 'neutral'
  return wecomCheckResult.value.ready ? 'success' : 'warning'
})

watch(runtimeSetting, (setting) => {
  runtimeApiUrl.value = String(setting?.value || '')
}, { immediate: true })

function errorMessage(error: unknown) {
  const normalized = error as { data?: { message?: string }, message?: string }
  return normalized.data?.message || normalized.message || String(error)
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

async function saveRuntimeUrl() {
  saving.value = true
  try {
    await $fetch('/api/v1/console/settings/values/notification.runtimeApiUrl', {
      method: 'PUT',
      body: {
        value: runtimeApiUrl.value.trim()
      }
    })
    await Promise.all([refreshSettings(), refreshInstall()])
    toast.add({ color: 'success', title: '已保存', description: '通知运行时地址已更新' })
  } catch (error) {
    toast.add({ color: 'error', title: '保存失败', description: errorMessage(error) })
  } finally {
    saving.value = false
  }
}

async function generateInstallCommand(rotate = false) {
  commandPending.value = true
  try {
    installData.value = await $fetch<ApiResponse<InstallCommand>>(
      '/api/v1/console/notification-runtime/install-command',
      {
        method: 'POST',
        body: { rotate }
      }
    )
    toast.add({
      color: 'success',
      title: rotate ? '已轮换' : '已生成',
      description: rotate ? '安装命令已重新生成，旧 client secret 会失效' : '安装命令已生成'
    })
  } catch (error) {
    toast.add({ color: 'error', title: '生成失败', description: errorMessage(error) })
  } finally {
    commandPending.value = false
  }
}

async function copyInstallCommand() {
  if (!install.value?.installCommand) return
  await navigator.clipboard.writeText(install.value?.installCommand || '')
  toast.add({ color: 'success', title: '已复制', description: '安装命令已复制到剪贴板' })
}

async function checkWecomConfig() {
  wecomChecking.value = true
  try {
    const response = await $fetch<ApiResponse<WecomConfigCheck>>('/api/v1/console/notification-runtime/wecom-check', {
      method: 'POST',
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
        touser
      }
    })
    toast.add({
      color: 'success',
      title: '测试消息已发送',
      description: response.data.messageCenter?.logged
        ? `已发送至 ${response.data.touser}，通知中心已记录`
        : `已发送至 ${response.data.touser}`
    })
    await refreshNotificationCenter()
  } catch (error) {
    toast.add({ color: 'error', title: '发送失败', description: errorMessage(error) })
    await refreshNotificationCenter().catch(() => undefined)
  } finally {
    wecomSending.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="notification-runtime" :ui="dashboardPanelUi">
    <template #header>
      <UDashboardNavbar title="通知运行时">
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
      <div class="space-y-4">
        <div class="rounded-lg border border-default bg-default p-4">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-highlighted">
                Runtime 地址
              </h2>
              <p class="text-xs text-muted">
                业务应用通过该地址调用客户侧固定出口 IP 的通知运行时。
              </p>
            </div>
            <UButton
              icon="i-lucide-save"
              color="primary"
              variant="subtle"
              :loading="saving"
              @click="saveRuntimeUrl"
            />
          </div>
          <UInput
            v-model="runtimeApiUrl"
            type="url"
            placeholder="https://notify.example.com"
            class="w-60"
          />
        </div>

        <div class="rounded-lg border border-default bg-default p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-semibold text-highlighted">
                企业微信通知
              </h2>
            </div>
            <div class="flex items-center gap-2">
              <UBadge :color="wecomReadyColor" variant="subtle">
                {{ wecomReadyLabel }}
              </UBadge>
              <UButton
                icon="i-lucide-list-checks"
                color="neutral"
                variant="subtle"
                aria-label="检测企业微信配置"
                title="检测企业微信配置"
                :loading="wecomChecking"
                @click="checkWecomConfig"
              />
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

        <div class="grid gap-4 xl:grid-cols-2">
          <div class="rounded-lg border border-default bg-default p-4">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 class="text-sm font-semibold text-highlighted">
                  一键安装
                </h2>
                <p class="text-xs text-muted">
                  在国内服务器执行，安装器会创建 systemd 服务和自动升级 timer。
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  icon="i-lucide-terminal"
                  color="primary"
                  variant="subtle"
                  aria-label="生成指令"
                  title="生成指令"
                  :loading="commandPending"
                  @click="generateInstallCommand(false)"
                />
                <UButton
                  icon="i-lucide-rotate-cw"
                  color="warning"
                  variant="subtle"
                  aria-label="轮换并生成"
                  title="轮换并生成"
                  :loading="commandPending"
                  @click="generateInstallCommand(true)"
                />
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="subtle"
                  aria-label="复制安装命令"
                  title="复制安装命令"
                  :disabled="!install?.installCommand"
                  @click="copyInstallCommand"
                />
              </div>
            </div>
            <pre class="overflow-auto rounded-md bg-muted p-3 text-xs leading-5 text-highlighted">{{ install?.installCommand || '点击“生成指令”后显示 curl 安装命令。' }}</pre>
          </div>

          <div class="rounded-lg border border-default bg-default p-4">
            <h2 class="mb-3 text-sm font-semibold text-highlighted">
              服务凭证
            </h2>
            <dl class="grid grid-cols-[8rem_1fr] gap-2 text-sm">
              <dt class="text-muted">
                Client ID
              </dt>
              <dd class="font-mono">
                {{ install?.clientId }}
              </dd>
              <dt class="text-muted">
                Secret 尾号
              </dt>
              <dd class="font-mono">
                {{ install?.clientSecretLast4 || '未生成' }}
              </dd>
              <dt class="text-muted">
                Tenant
              </dt>
              <dd class="font-mono">
                {{ install?.tenantCode }}
              </dd>
              <dt class="text-muted">
                Deployment
              </dt>
              <dd class="font-mono">
                {{ install?.deploymentCode }}
              </dd>
              <dt class="text-muted">
                端口
              </dt>
              <dd class="font-mono">
                {{ install?.port }}
              </dd>
              <dt class="text-muted">
                Console API
              </dt>
              <dd class="break-all font-mono">
                {{ install?.consoleApiUrl }}
              </dd>
              <dt class="text-muted">
                Issuer
              </dt>
              <dd class="break-all font-mono">
                {{ install?.issuer }}
              </dd>
              <dt class="text-muted">
                JWKS
              </dt>
              <dd class="break-all font-mono">
                {{ install?.jwksUrl }}
              </dd>
              <dt class="text-muted">
                更新任务
              </dt>
              <dd class="font-mono">
                {{ install?.updateTimer }}
              </dd>
            </dl>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
