<script setup lang="ts">
definePageMeta({
  layout: 'console'
})

usePageTitle('部署管理')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface DeploymentSettings {
  environment: string
  environments: Array<{
    code: string
    label: string
  }>
  tenant: {
    tenantCode: string
    tenantName: string
    displayName: string | null
  }
  domain: {
    suffix: string
    subdomain: string
    host: string
    publicUrl: string
    currentHost: string
    siteId: number | null
    rootAppCode: string | null
    environment: string
  }
  platform: {
    baseUrl: string | null
  }
  dataRuntime: {
    defaultEndpoint: string | null
    tokenLast4: string | null
    tokenUpdatedAt: string | null
  }
  login: {
    mode: 'none' | 'oidc' | 'cas' | 'wecom'
    oidc: {
      providerCode: string
      issuer: string
      authorizationEndpoint: string
      tokenEndpoint: string
      userinfoEndpoint: string
      endSessionEndpoint: string
      jwksUri: string
      clientId: string
      scope: string
      clientSecretConfigured: boolean
    }
    cas: {
      baseUrl: string
    }
    wecom: {
      corpid: string
      agentid: string
      corpsecretConfigured: boolean
    }
  }
  policyBundle: {
    bundleId: number
    bundleVersion: string
    bundleHash: string
    bundleUri: string
    schemaVersion: string
    signedByKid: string | null
    signedAt: string | null
    issuedAt: string | null
    expiresAt: string | null
    status: string
    environment: string
    targetCount: number
    consoleTargeted: boolean
    consoleDeploymentCode: string | null
  } | null
  deployments: Array<{
    id: number
    appCode: string
    appName: string
    serviceRole: string | null
    deploymentCode: string
    deploymentName: string
    environment: string
    status: string
    runtimeEndpoint: string | null
    effectiveRuntimeEndpoint: string | null
    inheritsDefaultRuntimeEndpoint: boolean
    lastHeartbeatAt: string | null
  }>
}

interface InstallCommandResponse {
  tenantCode: string
  environment: string
  deploymentCode: string
  tokenLast4: string
  rotated: boolean
  enabledApps: string[]
  command: string
}

interface BundleGenerateResponse {
  environment: string
  bundleId: number
  bundleVersion: string
  bundleHash: string
  bundleUri: string
  schemaVersion: string
  signedByKid: string | null
  signedAt: string | null
  issuedAt: string | null
  expiresAt: string | null
  targetCount: number
  targets: Array<{
    deploymentId: number
    deploymentCode: string
    appCode: string
    environment: string
  }>
}

interface SubscriptionArtifacts {
  tenantCode: string
  appCode: string
  appName: string
  artifacts: {
    env: null | { filename: string, content: string }
    license: null | { filename: string, content: string }
  }
  warnings: string[]
}

interface TenantRuntimeTokenResponse {
  tenantCode: string
  runtimeCredential: {
    token: string
    runtimeTokenLast4: string
    issuedAt: string
    rotatedAt: string | null
    expiresAt: string | null
  }
  warnings: string[]
}

interface FetchLikeError {
  data?: {
    message?: string
    statusMessage?: string
  }
  message?: string
}

const { currentTenantCode } = useTenantContext()
const runtimeConfig = useRuntimeConfig()

const pending = ref(false)
const saving = ref(false)
const commandPending = ref(false)
const bundlePending = ref(false)
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)
const settings = ref<DeploymentSettings | null>(null)
const installCommand = ref('')
const installCommandMeta = ref<InstallCommandResponse | null>(null)
const copied = ref(false)
const artifactsPending = ref(false)
const runtimeTokenPending = ref(false)
const artifacts = ref<SubscriptionArtifacts | null>(null)
const tenantRuntimeToken = ref<string | null>(null)
const tenantRuntimeTokenLast4 = ref<string | null>(null)
const copyFeedback = ref<{ key: string, tone: 'success' | 'error', message: string } | null>(null)
let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null
let settingsRequestSeq = 0

const environmentOptions = [
  { code: 'prod', label: '生产环境' },
  { code: 'test', label: '测试环境' }
]

function defaultDeploymentEnvironment() {
  const stage = String(runtimeConfig.public.platformStage || '').trim().toLowerCase()
  return ['test', 'dev', 'development', 'integration'].includes(stage) ? 'test' : 'prod'
}

const selectedEnvironment = ref(defaultDeploymentEnvironment())

const form = reactive({
  tenantSubdomain: '',
  platformBaseUrl: '',
  defaultDataRuntimeEndpoint: '',
  loginMode: 'none' as 'none' | 'oidc' | 'cas' | 'wecom',
  oidcProviderCode: 'sso_oidc',
  oidcIssuer: '',
  oidcAuthorizationEndpoint: '',
  oidcTokenEndpoint: '',
  oidcUserinfoEndpoint: '',
  oidcEndSessionEndpoint: '',
  oidcJwksUri: '',
  oidcClientId: '',
  oidcClientSecret: '',
  oidcScope: 'openid profile email',
  casBaseUrl: '',
  wecomCorpid: '',
  wecomAgentid: '',
  wecomCorpsecret: ''
})

const tenantCode = computed(() => String(currentTenantCode.value || '').trim())
const currentEnvironmentLabel = computed(() =>
  environmentOptions.find(item => item.code === selectedEnvironment.value)?.label || selectedEnvironment.value
)
const fullTenantUrl = computed(() => {
  const suffix = settings.value?.domain.suffix || 'huizhi.yun'
  const subdomain = form.tenantSubdomain.trim().toLowerCase()
  return subdomain ? `https://${subdomain}.${suffix}` : ''
})

const inheritedCount = computed(() =>
  settings.value?.deployments.filter(item => item.inheritsDefaultRuntimeEndpoint).length || 0
)
const activeDeploymentCount = computed(() =>
  settings.value?.deployments.filter(item => item.status === 'active').length || 0
)
const canGenerateBundle = computed(() => Boolean(tenantCode.value && activeDeploymentCount.value > 0))
const latestBundle = computed(() => settings.value?.policyBundle || null)
const bundleHashShort = computed(() => {
  const bundleHash = latestBundle.value?.bundleHash || ''
  return bundleHash ? bundleHash.slice(0, 12) : '—'
})

const deprecatedConsoleEnvKeys = new Set([
  'HZY_PLATFORM_ACTIVATION_ENABLED',
  'HZY_PLATFORM_BUNDLE_CACHE_DIR',
  'HZY_PLATFORM_HEARTBEAT_INTERVAL_MS',
  'HZY_APP_CODE',
  'HZY_DIRECTORY_PROVIDER',
  'HZY_CONSOLE_API_URL',
  'HZY_CONSOLE_URL'
])

function normalizeDisplayedConsoleEnv(content: string) {
  return content
    .split('\n')
    .filter((line) => {
      const key = (line.split('=', 1)[0] || '').trim()
      return !deprecatedConsoleEnvKeys.has(key)
    })
    .join('\n')
    .trim()
}

const displayedEnvContent = computed(() => {
  const content = normalizeDisplayedConsoleEnv(artifacts.value?.artifacts.env?.content || '')
  if (!content || !tenantRuntimeToken.value) return content
  const tokenLine = `HZY_PLATFORM_RUNTIME_TOKEN=${tenantRuntimeToken.value}`
  if (/^HZY_PLATFORM_RUNTIME_TOKEN=.*$/m.test(content)) {
    return content.replace(/^HZY_PLATFORM_RUNTIME_TOKEN=.*$/m, tokenLine)
  }
  return [content, tokenLine].join('\n')
})

const tenantRuntimeTokenEnvLine = computed(() => tenantRuntimeToken.value
  ? `HZY_PLATFORM_RUNTIME_TOKEN=${tenantRuntimeToken.value}`
  : '')

function extractErrorMessage(error: unknown, fallback: string) {
  const fetchError = error as FetchLikeError
  return fetchError?.data?.message || fetchError?.data?.statusMessage || fetchError?.message || fallback
}

function fillForm(value: DeploymentSettings) {
  form.tenantSubdomain = value.domain.subdomain
  form.platformBaseUrl = value.platform.baseUrl || ''
  form.defaultDataRuntimeEndpoint = value.dataRuntime.defaultEndpoint || ''
  form.loginMode = value.login.mode || 'none'
  form.oidcProviderCode = value.login.oidc.providerCode || 'sso_oidc'
  form.oidcIssuer = value.login.oidc.issuer || ''
  form.oidcAuthorizationEndpoint = value.login.oidc.authorizationEndpoint || ''
  form.oidcTokenEndpoint = value.login.oidc.tokenEndpoint || ''
  form.oidcUserinfoEndpoint = value.login.oidc.userinfoEndpoint || ''
  form.oidcEndSessionEndpoint = value.login.oidc.endSessionEndpoint || ''
  form.oidcJwksUri = value.login.oidc.jwksUri || ''
  form.oidcClientId = value.login.oidc.clientId || ''
  form.oidcClientSecret = ''
  form.oidcScope = value.login.oidc.scope || 'openid profile email'
  form.casBaseUrl = value.login.cas.baseUrl || ''
  form.wecomCorpid = value.login.wecom.corpid || ''
  form.wecomAgentid = value.login.wecom.agentid || ''
  form.wecomCorpsecret = ''
}

function applySettings(value: DeploymentSettings) {
  settings.value = value
  fillForm(value)
}

function policyBundleFromGeneratedBundle(bundle: BundleGenerateResponse): NonNullable<DeploymentSettings['policyBundle']> {
  const consoleTarget = bundle.targets.find(item => item.appCode === 'console')
  return {
    bundleId: bundle.bundleId,
    bundleVersion: bundle.bundleVersion,
    bundleHash: bundle.bundleHash,
    bundleUri: bundle.bundleUri,
    schemaVersion: bundle.schemaVersion,
    signedByKid: bundle.signedByKid,
    signedAt: bundle.signedAt,
    issuedAt: bundle.issuedAt,
    expiresAt: bundle.expiresAt,
    status: 'active',
    environment: bundle.environment,
    targetCount: bundle.targetCount,
    consoleTargeted: Boolean(consoleTarget),
    consoleDeploymentCode: consoleTarget?.deploymentCode || null
  }
}

function applyGeneratedPolicyBundle(bundle: BundleGenerateResponse) {
  if (!settings.value || settings.value.environment !== bundle.environment) return
  settings.value = {
    ...settings.value,
    policyBundle: policyBundleFromGeneratedBundle(bundle)
  }
}

async function loadSettings(options: { clearNotice?: boolean, showError?: boolean } = {}) {
  if (!tenantCode.value) {
    settings.value = null
    installCommand.value = ''
    installCommandMeta.value = null
    return
  }

  const clearNotice = options.clearNotice !== false
  const showError = options.showError !== false
  const requestSeq = ++settingsRequestSeq
  pending.value = true
  if (clearNotice) {
    notice.value = null
  }

  try {
    const response = await platformFetchJson<ApiEnvelope<DeploymentSettings>>('/api/platform/tenant-admin/deployment-settings', {
      query: { tenantCode: String(tenantCode.value), environment: String(selectedEnvironment.value) }
    })
    if (requestSeq === settingsRequestSeq) {
      applySettings(response.data)
    }
  } catch (error) {
    if (showError && requestSeq === settingsRequestSeq) {
      notice.value = {
        type: 'error',
        message: extractErrorMessage(error, '部署配置加载失败')
      }
    }
  } finally {
    if (requestSeq === settingsRequestSeq) {
      pending.value = false
    }
  }
}

async function refreshSettingsSilently() {
  await loadSettings({ clearNotice: false, showError: false })
}

async function refreshSettings() {
  await loadSettings()
}

async function saveSettings() {
  if (!tenantCode.value) return

  saving.value = true
  notice.value = null

  try {
    await $fetch('/api/platform/tenant-admin/deployment-settings', {
      method: 'PATCH',
      query: { tenantCode: tenantCode.value },
      body: {
        tenantCode: tenantCode.value,
        environment: selectedEnvironment.value,
        tenantSubdomain: form.tenantSubdomain.trim(),
        platformBaseUrl: form.platformBaseUrl.trim() || null,
        defaultDataRuntimeEndpoint: form.defaultDataRuntimeEndpoint.trim() || null,
        consoleLogin: {
          mode: form.loginMode,
          oidc: {
            providerCode: form.oidcProviderCode.trim() || 'sso_oidc',
            issuer: form.oidcIssuer.trim(),
            authorizationEndpoint: form.oidcAuthorizationEndpoint.trim(),
            tokenEndpoint: form.oidcTokenEndpoint.trim(),
            userinfoEndpoint: form.oidcUserinfoEndpoint.trim(),
            endSessionEndpoint: form.oidcEndSessionEndpoint.trim(),
            jwksUri: form.oidcJwksUri.trim(),
            clientId: form.oidcClientId.trim(),
            clientSecret: form.oidcClientSecret.trim(),
            scope: form.oidcScope.trim() || 'openid profile email'
          },
          cas: {
            baseUrl: form.casBaseUrl.trim()
          },
          wecom: {
            corpid: form.wecomCorpid.trim(),
            agentid: form.wecomAgentid.trim(),
            corpsecret: form.wecomCorpsecret.trim()
          }
        }
      }
    })

    notice.value = { type: 'success', message: '部署配置已保存。' }
    await loadSettings()
  } catch (error) {
    notice.value = {
      type: 'error',
      message: extractErrorMessage(error, '部署配置保存失败')
    }
  } finally {
    saving.value = false
  }
}

async function generateInstallCommand(rotate = false) {
  if (!tenantCode.value) return

  commandPending.value = true
  notice.value = null

  try {
    const response = await platformFetchJson<ApiEnvelope<InstallCommandResponse>>('/api/platform/tenant-admin/deployment-settings/install-command', {
      method: 'POST',
      query: { tenantCode: tenantCode.value, environment: selectedEnvironment.value },
      body: { rotate, environment: selectedEnvironment.value }
    })
    installCommand.value = response.data.command
    installCommandMeta.value = response.data
    notice.value = {
      type: 'success',
      message: rotate ? '安装指令已重新生成，旧 Agent token 会失效。' : '安装指令已生成。'
    }
    await loadSettings()
  } catch (error) {
    notice.value = {
      type: 'error',
      message: extractErrorMessage(error, '安装指令生成失败')
    }
  } finally {
    commandPending.value = false
  }
}

async function generatePolicyBundle() {
  if (!tenantCode.value) return

  bundlePending.value = true
  notice.value = null

  try {
    const response = await platformFetchJson<ApiEnvelope<BundleGenerateResponse>>('/api/platform/tenant-admin/bundles', {
      method: 'POST',
      query: { tenantCode: tenantCode.value, environment: selectedEnvironment.value },
      body: {
        tenantCode: tenantCode.value,
        environment: selectedEnvironment.value,
        platformBaseUrl: form.platformBaseUrl.trim() || null
      }
    })
    notice.value = {
      type: 'success',
      message: `策略包已生成：${response.data.bundleVersion}，目标 ${response.data.targetCount} 个。`
    }
    applyGeneratedPolicyBundle(response.data)
    void refreshSettingsSilently()
  } catch (error) {
    notice.value = {
      type: 'error',
      message: extractErrorMessage(error, '策略包生成失败')
    }
  } finally {
    bundlePending.value = false
  }
}

async function copyInstallCommand() {
  if (!installCommand.value || !import.meta.client || !navigator.clipboard) return
  await navigator.clipboard.writeText(installCommand.value)
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1800)
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

const consoleAppCode = 'console'

async function loadConsoleArtifacts() {
  if (!tenantCode.value) {
    artifacts.value = null
    return
  }
  artifactsPending.value = true
  try {
    const response = await platformFetchJson<ApiEnvelope<SubscriptionArtifacts>>(
      `/api/platform/tenant-admin/subscriptions/${consoleAppCode}/artifacts`,
      { query: { tenantCode: tenantCode.value } }
    )
    artifacts.value = response.data
  } catch (error) {
    artifacts.value = {
      tenantCode: tenantCode.value,
      appCode: consoleAppCode,
      appName: 'Console',
      artifacts: { env: null, license: null },
      warnings: [extractErrorMessage(error, 'console 配置材料加载失败')]
    }
  } finally {
    artifactsPending.value = false
  }
}

async function rotateTenantRuntimeToken() {
  if (!tenantCode.value) return
  runtimeTokenPending.value = true
  notice.value = null
  try {
    const response = await platformFetchJson<ApiEnvelope<TenantRuntimeTokenResponse>>('/api/platform/tenant-admin/runtime-token', {
      method: 'POST',
      body: { tenantCode: tenantCode.value, confirmTenantWideRotation: true }
    })
    tenantRuntimeToken.value = response.data.runtimeCredential.token
    tenantRuntimeTokenLast4.value = response.data.runtimeCredential.runtimeTokenLast4
    notice.value = {
      type: 'success',
      message: `租户访问令牌已轮换，旧令牌立即失效；请把新的 HZY_PLATFORM_RUNTIME_TOKEN 同步到 console。尾号 ${tenantRuntimeTokenLast4.value || '****'}。`
    }
  } catch (error) {
    notice.value = {
      type: 'error',
      message: extractErrorMessage(error, '访问令牌轮换失败')
    }
  } finally {
    runtimeTokenPending.value = false
  }
}

function showCopyFeedback(key: string, tone: 'success' | 'error', message: string) {
  copyFeedback.value = { key, tone, message }
  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer)
  }
  copyFeedbackTimer = setTimeout(() => {
    copyFeedback.value = null
    copyFeedbackTimer = null
  }, 3000)
}

async function copyArtifact(content: string, feedbackKey: string) {
  if (!import.meta.client || !navigator.clipboard) {
    showCopyFeedback(feedbackKey, 'error', '复制失败')
    return
  }
  try {
    await navigator.clipboard.writeText(content)
    showCopyFeedback(feedbackKey, 'success', '已复制')
  } catch {
    showCopyFeedback(feedbackKey, 'error', '复制失败')
  }
}

onUnmounted(() => {
  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer)
  }
})

watch([tenantCode, selectedEnvironment], () => {
  installCommand.value = ''
  installCommandMeta.value = null
  loadSettings()
  loadConsoleArtifacts()
}, { immediate: true })
</script>

<template>
  <UDashboardPanel
    id="tenant-deployment-management"
    :ui="{ body: 'console-page' }"
  >
    <template #body>
      <section class="console-hero">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-highlighted">
              部署管理
            </h1>
            <p class="mt-1 text-sm text-muted">
              维护企业访问域名、员工登录方式、数据服务地址与服务器安装。各应用默认继承企业级数据服务地址，特殊情况才在应用中心单独覆盖。
            </p>
          </div>
          <div class="flex flex-col gap-2 sm:items-end">
            <div class="inline-flex rounded-lg border border-default bg-default p-1">
              <UButton
                v-for="item in environmentOptions"
                :key="item.code"
                size="sm"
                :color="selectedEnvironment === item.code ? 'primary' : 'neutral'"
                :variant="selectedEnvironment === item.code ? 'solid' : 'ghost'"
                @click="selectedEnvironment = item.code"
              >
                {{ item.label }}
              </UButton>
            </div>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="pending"
              @click="refreshSettings"
            >
              刷新
            </UButton>
          </div>
        </div>
      </section>

      <div
        v-if="notice"
        class="tenant-notice"
        :data-tone="notice.type"
      >
        {{ notice.message }}
      </div>
      <section class="console-panel">
        <div class="console-panel__header">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">
              策略包
            </h2>
            <p class="mt-1 text-sm text-muted">
              当前环境：{{ currentEnvironmentLabel }}。
            </p>
          </div>
          <UButton
            color="primary"
            icon="i-lucide-package-check"
            :loading="bundlePending"
            :disabled="!canGenerateBundle"
            @click="generatePolicyBundle"
          >
            生成策略包
          </UButton>
        </div>

        <div
          v-if="latestBundle"
          class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
          <div class="rounded-lg border border-default bg-muted px-4 py-3">
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              版本
            </p>
            <p class="mt-2 break-all font-mono text-sm font-semibold text-highlighted">
              {{ latestBundle.bundleVersion }}
            </p>
            <p class="mt-1 font-mono text-xs text-muted">
              ID #{{ latestBundle.bundleId }}
            </p>
          </div>
          <div class="rounded-lg border border-default bg-muted px-4 py-3">
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              哈希
            </p>
            <p class="mt-2 font-mono text-sm font-semibold text-highlighted">
              {{ bundleHashShort }}
            </p>
            <p class="mt-1 break-all font-mono text-xs text-muted">
              {{ latestBundle.bundleHash }}
            </p>
          </div>
          <div class="rounded-lg border border-default bg-muted px-4 py-3">
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              下发目标
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ currentEnvironmentLabel }}
              </UBadge>
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ latestBundle.targetCount }} 个目标
              </UBadge>
              <UBadge
                :color="latestBundle.consoleTargeted ? 'success' : 'warning'"
                variant="soft"
              >
                {{ latestBundle.consoleTargeted ? '包含 Console' : '未包含 Console' }}
              </UBadge>
            </div>
            <p class="mt-2 truncate font-mono text-xs text-muted">
              {{ latestBundle.consoleDeploymentCode || '—' }}
            </p>
          </div>
          <div class="rounded-lg border border-default bg-muted px-4 py-3">
            <p class="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
              签发时间
            </p>
            <p class="mt-2 text-sm font-semibold text-highlighted">
              {{ formatDate(latestBundle.signedAt || latestBundle.issuedAt) }}
            </p>
            <p class="mt-1 text-xs text-muted">
              kid：{{ latestBundle.signedByKid || '—' }}
            </p>
          </div>
        </div>

        <div
          v-else
          class="mt-4 rounded-lg border border-dashed border-default bg-muted px-4 py-8 text-center text-sm text-muted"
        >
          <template v-if="activeDeploymentCount === 0">
            当前环境还没有运行中的应用部署。先在应用中心为{{ currentEnvironmentLabel }}开通应用，再生成策略包。
          </template>
          <template v-else>
            当前企业还没有策略包。点击“生成策略包”后，Console 会在管理页打开时检测并拉取新版本。
          </template>
        </div>
      </section>

      <section
        v-if="!tenantCode"
        class="console-panel"
      >
        <p class="text-sm text-muted">
          请先选择企业，再维护部署配置。
        </p>
      </section>

      <section
        v-else
        class="grid gap-4 xl:grid-cols-2"
      >
        <form
          class="console-panel space-y-5"
          @submit.prevent="saveSettings"
        >
          <div class="console-panel__header">
            <div>
              <h2 class="text-lg font-semibold text-highlighted">
                企业访问入口
              </h2>
            </div>
            <UBadge
              :color="settings?.domain.publicUrl ? 'success' : 'warning'"
              variant="soft"
            >
              {{ currentEnvironmentLabel }} · {{ settings?.domain.publicUrl ? '已配置' : '待配置' }}
            </UBadge>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="tenant-field">
              <span class="tenant-field__label">企业子域名</span>
              <UInput
                v-model="form.tenantSubdomain"
                placeholder="例如：wiztek"
                autocomplete="off"
              />
            </label>

            <div class="rounded-lg border border-default bg-muted px-4 py-3">
              <p class="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                访问地址
              </p>
              <p class="mt-2 break-all text-sm font-semibold text-highlighted">
                {{ fullTenantUrl || '填写子域名后生成' }}
              </p>
            </div>

            <!-- <label class="tenant-field md:col-span-2">
              <span class="tenant-field__label">平台服务地址</span>
              <UInput
                v-model="form.platformBaseUrl"
                placeholder="例如：https://platform.example.com"
                autocomplete="off"
              />
            </label> -->

            <label class="tenant-field md:col-span-2">
              <span class="tenant-field__label">默认数据服务地址</span>
              <UInput
                v-model="form.defaultDataRuntimeEndpoint"
                placeholder="例如：https://oa.example.com:18080"
                autocomplete="off"
              />
            </label>
          </div>
          <div class="flex justify-between gap-2">
            <span class="tenant-field__label">数据服务安装指令</span>
            <div>
              <UButton
                color="primary"
                icon="i-lucide-terminal"
                size="sm"
                :loading="commandPending"
                @click="generateInstallCommand(false)"
              >
                生成指令
              </UButton>
              <UButton
                color="warning"
                variant="soft"
                size="sm"
                icon="i-lucide-rotate-cw"
                :loading="commandPending"
                @click="generateInstallCommand(true)"
              >
                轮换并生成
              </UButton>
            </div>
          </div>

          <div
            v-if="installCommandMeta"
            class="rounded-lg border border-default bg-muted px-4 py-3 text-sm text-muted"
          >
            <p>环境：{{ currentEnvironmentLabel }}</p>
            <p>部署标识：{{ installCommandMeta.deploymentCode }}</p>
            <p>启用应用：{{ installCommandMeta.enabledApps.length ? installCommandMeta.enabledApps.join(', ') : '无' }}</p>
            <p>访问令牌尾号：{{ installCommandMeta.tokenLast4 }}</p>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <p class="text-sm font-semibold text-highlighted">
                安装命令
              </p>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-copy"
                :disabled="!installCommand"
                @click="copyInstallCommand"
              >
                {{ copied ? '已复制' : '复制' }}
              </UButton>
            </div>
            <textarea
              class="h-48 w-full resize-none rounded-lg border border-default bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none"
              readonly
              :value="installCommand || '点击“生成指令”后显示 curl 安装命令。'"
            />
          </div>

          <div class="border-t border-default pt-5">
            <div class="console-panel__header">
              <div>
                <h3 class="text-base font-semibold text-highlighted">
                  员工登录方式
                </h3>
              </div>
              <UBadge
                :color="form.loginMode === 'none' ? 'warning' : 'success'"
                variant="soft"
              >
                {{ form.loginMode === 'none' ? '未配置' : form.loginMode === 'wecom' ? '企业微信' : form.loginMode.toUpperCase() }}
              </UBadge>
            </div>

            <div class="mt-4 grid gap-4 md:grid-cols-2">
              <label class="tenant-field">
                <span class="tenant-field__label">登录方式</span>
                <select
                  v-model="form.loginMode"
                  class="h-9 w-full rounded-md border border-default bg-default px-3 text-sm text-highlighted outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                >
                  <option value="none">未配置</option>
                  <option value="oidc">OIDC</option>
                  <option value="cas">CAS</option>
                  <option value="wecom">企业微信</option>
                </select>
              </label>
            </div>

            <div
              v-if="form.loginMode === 'oidc'"
              class="mt-4 grid gap-4 md:grid-cols-2"
            >
              <!-- <label class="tenant-field">
                <span class="tenant-field__label">Provider Code</span>
                <UInput
                  v-model="form.oidcProviderCode"
                  placeholder="sso_oidc"
                  autocomplete="off"
                />
              </label> -->
              <label class="tenant-field">
                <span class="tenant-field__label">Client ID</span>
                <UInput
                  v-model="form.oidcClientId"
                  autocomplete="off"
                />
              </label>
              <label class="tenant-field">
                <span class="tenant-field__label">Client Secret</span>
                <UInput
                  v-model="form.oidcClientSecret"
                  type="password"
                  :placeholder="settings?.login.oidc.clientSecretConfigured ? '已保存，留空不变' : '可选，取决于 IdP'"
                  autocomplete="new-password"
                />
              </label>
              <!-- <label class="tenant-field">
                <span class="tenant-field__label">Scope</span>
                <UInput
                  v-model="form.oidcScope"
                  placeholder="openid profile email"
                  autocomplete="off"
                />
              </label> -->
              <label class="tenant-field md:col-span-2">
                <span class="tenant-field__label">Issuer</span>
                <UInput
                  v-model="form.oidcIssuer"
                  placeholder="https://sso.example.com/realms/acme"
                  autocomplete="off"
                />
              </label>
              <details class="md:col-span-2">
                <summary class="cursor-pointer select-none text-sm text-muted">
                  高级：服务端点（一般由 Issuer 自动发现，无需手填）
                </summary>
                <div class="mt-3 grid gap-4 md:grid-cols-2">
                  <label class="tenant-field">
                    <span class="tenant-field__label">Authorization Endpoint</span>
                    <UInput
                      v-model="form.oidcAuthorizationEndpoint"
                      autocomplete="off"
                    />
                  </label>
                  <label class="tenant-field">
                    <span class="tenant-field__label">Token Endpoint</span>
                    <UInput
                      v-model="form.oidcTokenEndpoint"
                      autocomplete="off"
                    />
                  </label>
                  <label class="tenant-field">
                    <span class="tenant-field__label">Userinfo Endpoint</span>
                    <UInput
                      v-model="form.oidcUserinfoEndpoint"
                      autocomplete="off"
                    />
                  </label>
                  <label class="tenant-field">
                    <span class="tenant-field__label">JWKS URI</span>
                    <UInput
                      v-model="form.oidcJwksUri"
                      autocomplete="off"
                    />
                  </label>
                  <label class="tenant-field md:col-span-2">
                    <span class="tenant-field__label">End Session Endpoint</span>
                    <UInput
                      v-model="form.oidcEndSessionEndpoint"
                      autocomplete="off"
                    />
                  </label>
                </div>
              </details>
            </div>

            <div
              v-else-if="form.loginMode === 'cas'"
              class="mt-4 grid gap-4 md:grid-cols-2"
            >
              <label class="tenant-field md:col-span-2">
                <span class="tenant-field__label">CAS Base URL</span>
                <UInput
                  v-model="form.casBaseUrl"
                  placeholder="https://cas.example.com"
                  autocomplete="off"
                />
              </label>
            </div>

            <div
              v-else-if="form.loginMode === 'wecom'"
              class="mt-4 grid gap-4 md:grid-cols-2"
            >
              <label class="tenant-field">
                <span class="tenant-field__label">Corp ID</span>
                <UInput
                  v-model="form.wecomCorpid"
                  autocomplete="off"
                />
              </label>
              <label class="tenant-field">
                <span class="tenant-field__label">Agent ID</span>
                <UInput
                  v-model="form.wecomAgentid"
                  autocomplete="off"
                />
              </label>
              <label class="tenant-field md:col-span-2">
                <span class="tenant-field__label">Corp Secret</span>
                <UInput
                  v-model="form.wecomCorpsecret"
                  type="password"
                  :placeholder="settings?.login.wecom.corpsecretConfigured ? '已保存，留空不变' : '企业微信应用 Secret'"
                  autocomplete="new-password"
                />
              </label>
            </div>
          </div>

          <div class="rounded-lg border border-default bg-muted px-4 py-3 text-sm text-muted">
            <div class="flex flex-wrap gap-2">
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ currentEnvironmentLabel }}
              </UBadge>
              <UBadge
                color="neutral"
                variant="soft"
              >
                后缀 {{ settings?.domain.suffix || 'huizhi.yun' }}
              </UBadge>
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ inheritedCount }} 个应用继承默认 Agent
              </UBadge>
              <UBadge
                v-if="settings?.dataRuntime.tokenLast4"
                color="primary"
                variant="soft"
              >
                token 尾号 {{ settings.dataRuntime.tokenLast4 }}
              </UBadge>
            </div>
          </div>

          <div class="flex justify-end gap-2 border-t border-default pt-4">
            <UButton
              color="primary"
              icon="i-lucide-save"
              type="submit"
              :loading="saving"
            >
              保存配置
            </UButton>
          </div>
        </form>

        <aside class="console-panel space-y-4">
          <div class="console-panel__header">
            <div>
              <h2 class="text-lg font-semibold text-highlighted">
                应用部署清单
              </h2>
              <p class="mt-1 text-sm text-muted">
                当前环境：{{ currentEnvironmentLabel }}。
              </p>
            </div>
            <NuxtLink to="/dashboard/applications">
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-app-window"
              >
                应用中心
              </UButton>
            </NuxtLink>
          </div>

          <div class="mt-4 overflow-hidden rounded-lg border border-default">
            <table class="min-w-full divide-y divide-default text-sm">
              <thead class="bg-muted text-left text-xs uppercase tracking-[0.14em] text-muted">
                <tr>
                  <th class="px-4 py-3">
                    应用
                  </th>
                  <th class="px-4 py-3">
                    部署标识
                  </th>
                  <th class="px-4 py-3">
                    数据服务地址
                  </th>
                  <th class="px-4 py-3">
                    状态
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default bg-default">
                <tr
                  v-for="deployment in settings?.deployments || []"
                  :key="deployment.id"
                >
                  <td class="px-4 py-3">
                    <p class="font-medium text-highlighted">
                      {{ deployment.appName }}
                    </p>
                    <p class="text-xs text-muted">
                      {{ deployment.appCode }}
                    </p>
                  </td>
                  <td class="px-4 py-3 font-mono text-xs text-muted">
                    {{ deployment.deploymentCode }}
                  </td>
                  <td class="px-4 py-3">
                    <p class="break-all text-highlighted">
                      {{ deployment.effectiveRuntimeEndpoint || '未配置' }}
                    </p>
                    <UBadge
                      class="mt-1"
                      :color="deployment.inheritsDefaultRuntimeEndpoint ? 'success' : 'warning'"
                      variant="soft"
                    >
                      {{ deployment.inheritsDefaultRuntimeEndpoint ? '继承企业默认' : '应用覆盖' }}
                    </UBadge>
                  </td>
                  <td class="px-4 py-3">
                    <UBadge
                      :color="deployment.status === 'active' ? 'success' : 'neutral'"
                      variant="soft"
                    >
                      {{ deployment.status === 'active' ? '运行中' : deployment.status === 'disabled' ? '已停用'
                        : deployment.status }}
                    </UBadge>
                    <p class="mt-1 text-xs text-muted">
                      {{ deployment.lastHeartbeatAt ? `最后心跳 ${formatDate(deployment.lastHeartbeatAt)}` : '无心跳' }}
                    </p>
                  </td>
                </tr>
                <tr v-if="!settings?.deployments.length">
                  <td
                    class="px-4 py-8 text-center text-sm text-muted"
                    colspan="4"
                  >
                    当前企业还没有应用 deployment。
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </aside>
      </section>

      <section
        v-if="tenantCode"
        class="console-panel space-y-4"
      >
        <div class="console-panel__header">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">
              Console 运行时配置
            </h2>
            <p class="mt-1 text-sm text-muted">
              Console 启动所需的访问令牌与环境变量；令牌轮换后旧的立即失效，需同步更新到 console。
            </p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="artifactsPending"
            @click="loadConsoleArtifacts"
          >
            刷新
          </UButton>
        </div>

        <div class="space-y-3 rounded-lg border border-default bg-muted px-4 py-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">
                租户访问令牌
              </p>
              <p class="mt-1 text-sm text-muted">
                令牌属于租户、只下发给 console；业务应用启动时凭 license 向 console 拉取平台配置。
              </p>
              <p
                v-if="tenantRuntimeTokenLast4 || settings?.dataRuntime.tokenLast4"
                class="mt-1 text-xs text-muted"
              >
                当前尾号 {{ tenantRuntimeTokenLast4 || settings?.dataRuntime.tokenLast4 }}
              </p>
            </div>
            <UButton
              color="warning"
              variant="soft"
              icon="i-lucide-key-round"
              :loading="runtimeTokenPending"
              @click="rotateTenantRuntimeToken"
            >
              轮换令牌
            </UButton>
          </div>
          <div
            v-if="tenantRuntimeTokenEnvLine"
            class="flex flex-wrap items-center gap-2"
          >
            <code class="break-all rounded-md bg-default px-3 py-2 font-mono text-xs text-muted">
              {{ tenantRuntimeTokenEnvLine }}
            </code>
            <UButton
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-copy"
              @click="copyArtifact(tenantRuntimeTokenEnvLine, 'runtime-token-env')"
            >
              {{ copyFeedback?.key === 'runtime-token-env' ? copyFeedback.message : '复制令牌行' }}
            </UButton>
          </div>
        </div>

        <div
          v-if="artifacts?.warnings.length"
          class="space-y-2"
        >
          <UAlert
            v-for="warning in artifacts.warnings"
            :key="warning"
            color="warning"
            variant="soft"
            icon="i-lucide-alert-triangle"
            :title="warning"
          />
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-semibold text-highlighted">
              {{ artifacts?.artifacts.env?.filename || 'console .env' }}
            </p>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-copy"
              :disabled="!displayedEnvContent"
              @click="displayedEnvContent && copyArtifact(displayedEnvContent, 'console-env')"
            >
              {{ copyFeedback?.key === 'console-env' ? copyFeedback.message : '复制' }}
            </UButton>
          </div>
          <textarea
            class="h-48 w-full resize-none rounded-lg border border-default bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none"
            readonly
            :value="displayedEnvContent || '轮换令牌或刷新后，这里显示 console 启动所需的环境变量。'"
          />
        </div>
      </section>
    </template>
  </UDashboardPanel>
</template>
