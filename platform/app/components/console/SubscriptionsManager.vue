<script setup lang="ts">
import {
  ROLE_TONE,
  roleLabel,
  type ServiceRole,
  type Tone
} from '~/utils/opsConsole'

const props = withDefaults(defineProps<{
  scope?: 'admin' | 'dashboard'
}>(), {
  scope: 'admin'
})

usePageTitle(props.scope === 'dashboard' ? '应用中心' : '开通编排')

type DeploymentMode = 'managed-control-plane' | 'self-hosted-enterprise' | 'customer-hosted'
type DeploymentStatus = 'active' | 'suspended' | 'disabled'
type LicenseStatus = 'active' | 'grace' | 'expired' | 'suspended' | 'disabled'
type SubscriptionStage = 'not_subscribed' | 'selected' | 'deployment_pending' | 'active' | 'grace' | 'authorization_blocked'
type SubscriptionStageFilter = 'all' | SubscriptionStage
type PlanSelectValue = '__no_license__' | string

const NO_LICENSE_PLAN_VALUE = '__no_license__'

interface SubscriptionItem {
  application: {
    id: number
    appCode: string
    appName: string
    description: string | null
    icon: string | null
    appType: string
    runtimeMode: DeploymentMode
    serviceRole: ServiceRole
    authMode: string
    status: string
  }
  stage: {
    key: SubscriptionStage
    label: string
    tone: 'neutral' | 'warning' | 'success' | 'error'
  }
  entitlement: null | {
    planCode: string
    roleInPlan: string | null
    sortOrder: number
  }
  defaults: {
    deploymentCode: string
    deploymentName: string
    licenseCode: string
  }
  deployment: null | {
    id: number
    appCode: string
    deploymentCode: string
    deploymentName: string
    deploymentMode: DeploymentMode
    status: DeploymentStatus
    licenseStatus: LicenseStatus
    basePath: string | null
    apiBase: string | null
    routeSource: string | null
    runtimeEndpoint: string | null
    lastHeartbeatAt: string | null
  }
  license: null | {
    id: number
    licenseCode: string
    planCode: string | null
    status: LicenseStatus
    issuedAt: string | null
    expiresAt: string | null
    graceUntil: string | null
  }
  manifest: null | {
    version?: string
    manifestSeq?: number
    createdAt: string
  }
}

interface SubscriptionListResponse {
  items: SubscriptionItem[]
  total: number
  page: number
  pageSize: number
}

interface SubscriptionArtifacts {
  tenantCode: string
  appCode: string
  appName: string
  artifacts: {
    env: null | {
      filename: string
      content: string
    }
    license: null | {
      filename: string
      content: string
    }
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

interface TenantDashboardOverviewResponse {
  tenant: {
    tenantCode: string
    tenantName: string
    displayName: string | null
    primaryDomain: string | null
    status: string
    planCode: string | null
    planName: string | null
    subscriptionStartedAt: string | null
    subscriptionEndedAt: string | null
  }
  stats: {
    totalAppCount: number
    enabledAppCount: number
    subscribedAppCount: number
    deployedAppCount: number
    licensedAppCount: number
    platformServiceAppCount: number
    businessAppCount: number
    departmentCount: number
    userCount: number
    subscriptionRemainingDays: number | null
    nextExpiryAt: string | null
  }
}

interface PlanOptionItem {
  id: number
  planCode: string
  planName: string
  planTier: string
  status: string
}

interface PlanListResponse {
  items: PlanOptionItem[]
  total: number
}

const deploymentModeOptions: Array<{ value: DeploymentMode, label: string }> = [
  { value: 'customer-hosted', label: 'Customer Hosted' },
  { value: 'managed-control-plane', label: 'Managed Control Plane' },
  { value: 'self-hosted-enterprise', label: 'Self-Hosted Enterprise' }
]

const deploymentStatusOptions: Array<{ value: DeploymentStatus, label: string }> = [
  { value: 'active', label: '启用' },
  { value: 'suspended', label: '暂停' },
  { value: 'disabled', label: '停用' }
]

const licenseStatusOptions: Array<{ value: LicenseStatus, label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'grace', label: 'Grace' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'disabled', label: 'Disabled' }
]

const stageOptions: Array<{ value: SubscriptionStageFilter, label: string }> = [
  { value: 'all', label: '全部阶段' },
  { value: 'not_subscribed', label: '未启用' },
  { value: 'selected', label: '待授权' },
  { value: 'deployment_pending', label: '待部署' },
  { value: 'active', label: '正式启用' },
  { value: 'grace', label: '授权宽限' },
  { value: 'authorization_blocked', label: '授权受限' }
]

const route = useRoute()
const router = useRouter()
const { currentTenantCode } = useTenantContext()

const filters = reactive<{
  tenantCode: string
  keyword: string
  status: SubscriptionStageFilter
}>({
  tenantCode: typeof route.query.tenantCode === 'string'
    ? route.query.tenantCode
    : props.scope === 'dashboard'
      ? currentTenantCode.value
      : '',
  keyword: '',
  status: 'all'
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const subscriptions = ref<SubscriptionItem[]>([])
const plans = ref<PlanOptionItem[]>([])
const tenantOverview = ref<TenantDashboardOverviewResponse | null>(null)
const selectedAppCode = ref<string | null>(null)
const listPending = ref(false)
const plansPending = ref(false)
const overviewPending = ref(false)
const overviewError = ref('')
const formPending = ref(false)
const artifactsPending = ref(false)
const runtimeTokenPending = ref(false)
const artifacts = ref<SubscriptionArtifacts | null>(null)
const tenantRuntimeToken = ref<string | null>(null)
const tenantRuntimeTokenLast4 = ref<string | null>(null)
const copyFeedback = ref<{ key: string, tone: 'success' | 'error', message: string } | null>(null)
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)
let copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null

const form = reactive({
  tenantCode: filters.tenantCode,
  appCode: '',
  deploymentMode: 'customer-hosted' as DeploymentMode,
  deploymentStatus: 'active' as DeploymentStatus,
  deploymentCode: '',
  deploymentName: '',
  runtimeEndpoint: '',
  basePath: '',
  apiBase: '',
  planCode: '',
  licenseStatus: 'active' as LicenseStatus,
  licenseCode: '',
  issuedAt: '',
  expiresAt: '',
  graceUntil: '',
  capabilitiesJson: '[\n  {\n    "capabilityCode": "platform.max_users",\n    "capabilityValue": "50"\n  }\n]\n'
})

const pageCount = computed(() => Math.max(1, Math.ceil((pagination.total || 0) / pagination.pageSize)))
const hasTenantContext = computed(() => !!filters.tenantCode.trim())
const selectedSubscription = computed(() => subscriptions.value.find(item => item.application.appCode === selectedAppCode.value) || null)
const hasLicensePlan = computed(() => !!form.planCode.trim())
const isDashboardScope = computed(() => props.scope === 'dashboard')
const apiPrefix = computed(() => isDashboardScope.value ? '/api/platform/tenant-admin' : '/api/platform/ops')
const planOptions = computed(() => {
  const items: Array<{ label: string, value: PlanSelectValue }> = [
    { label: '暂不签发 license', value: NO_LICENSE_PLAN_VALUE },
    ...plans.value.map(plan => ({
      label: `${plan.planName} (${plan.planCode})`,
      value: plan.planCode
    }))
  ]

  const selectedPlanCode = form.planCode.trim()
  if (selectedPlanCode && !items.some(item => item.value === selectedPlanCode)) {
    items.push({
      label: `${selectedPlanCode}（当前，不在可选套餐中）`,
      value: selectedPlanCode
    })
  }

  return items
})
const selectedPlanValue = computed<PlanSelectValue>({
  get: () => form.planCode.trim() || NO_LICENSE_PLAN_VALUE,
  set: (value) => {
    form.planCode = value === NO_LICENSE_PLAN_VALUE ? '' : value
  }
})
const selectedIsPlatformService = computed(() => selectedSubscription.value?.application.serviceRole === 'supporting_service')
const workflowStats = computed(() => ({
  total: subscriptions.value.length,
  platformServices: subscriptions.value.filter(item => item.application.serviceRole === 'supporting_service').length,
  businessApps: subscriptions.value.filter(item => item.application.serviceRole === 'business_app').length,
  selected: subscriptions.value.filter(item => item.stage.key !== 'not_subscribed').length,
  deployed: subscriptions.value.filter(item => Boolean(item.deployment)).length,
  licensed: subscriptions.value.filter(item => Boolean(item.license)).length,
  active: subscriptions.value.filter(item => item.stage.key === 'active').length
}))
const orchestrationSteps = computed(() => {
  const subscription = selectedSubscription.value

  return [
    {
      title: '选择应用',
      description: subscription ? `${subscription.application.appName} 已进入当前编排。` : '先从左侧选择本次要开通的应用。',
      completed: Boolean(subscription)
    },
    {
      title: '建立订阅关系',
      description: subscription && subscription.stage.key !== 'not_subscribed' ? '租户与应用关系已建立。' : '保存一次编排后建立租户与应用关系。',
      completed: Boolean(subscription && subscription.stage.key !== 'not_subscribed')
    },
    {
      title: '配置 deployment',
      description: subscription?.deployment?.deploymentCode || '补齐部署方式、部署名称和运行状态。',
      completed: Boolean(subscription?.deployment)
    },
    {
      title: '签发 license',
      description: subscription?.license?.licenseCode || '选择套餐后签发 license 与 capability。',
      completed: Boolean(subscription?.license)
    },
    {
      title: '通过 release gate',
      description: subscription?.stage.key === 'active' ? '当前应用已正式启用。' : '正式启用需要授权、部署与连通性共同通过。',
      completed: subscription?.stage.key === 'active'
    }
  ]
})
const recommendedAction = computed(() => {
  const subscription = selectedSubscription.value
  if (!subscription) return '请选择应用'
  if (subscription.stage.key === 'not_subscribed') return '建立订阅关系'
  if (!subscription.deployment) return '补齐 deployment'
  if (!subscription.license) return '签发 license'
  if (subscription.stage.key !== 'active') return '检查 release gate'
  return '保持运行监控'
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
const dashboardAuthorizationPlanCode = computed(() =>
  selectedSubscription.value?.entitlement?.planCode
  || tenantOverview.value?.tenant.planCode
  || form.planCode.trim()
)
const selectedAppSummary = computed(() => {
  const subscription = selectedSubscription.value
  if (!subscription) return []
  const manifestLabel = subscription.manifest?.version
    || (subscription.manifest?.manifestSeq != null ? `#${subscription.manifest.manifestSeq}` : '未发现')

  return [
    {
      label: '开通阶段',
      value: subscription.stage.label,
      detail: recommendedAction.value
    },
    {
      label: 'Manifest',
      value: manifestLabel,
      detail: subscription.application.runtimeMode
    },
    {
      label: 'Deployment',
      value: subscription.deployment?.deploymentCode || '未创建',
      detail: subscription.deployment?.status || '—'
    },
    {
      label: 'License',
      value: subscription.license?.planCode || subscription.entitlement?.planCode || '未签发',
      detail: subscription.license?.expiresAt
        ? `到期 ${formatDate(subscription.license.expiresAt)}`
        : subscription.license?.status || (subscription.entitlement ? '待签发 license' : '—')
    }
  ]
})

function resetNotice() {
  notice.value = null
}

function syncTenantQuery() {
  if (isDashboardScope.value) {
    return
  }

  router.replace({
    query: {
      ...route.query,
      tenantCode: filters.tenantCode || undefined
    }
  })
}

function toInputDateTime(value: string | null) {
  if (!value) return ''
  return String(value).replace(' ', 'T').slice(0, 16)
}

function fromInputDateTime(value: string) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  if (normalized.length === 16) {
    return `${normalized.replace('T', ' ')}:00`
  }
  return normalized.replace('T', ' ')
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function serviceRoleTone(value: ServiceRole): Tone {
  return ROLE_TONE[value] || 'neutral'
}

function resetForm() {
  form.tenantCode = filters.tenantCode
  form.appCode = ''
  form.deploymentMode = 'customer-hosted'
  form.deploymentStatus = 'active'
  form.deploymentCode = ''
  form.deploymentName = ''
  form.runtimeEndpoint = ''
  form.basePath = ''
  form.apiBase = ''
  form.planCode = ''
  form.licenseStatus = 'active'
  form.licenseCode = ''
  form.issuedAt = ''
  form.expiresAt = ''
  form.graceUntil = ''
  form.capabilitiesJson = '[\n  {\n    "capabilityCode": "platform.max_users",\n    "capabilityValue": "50"\n  }\n]\n'
  artifacts.value = null
}

function fillForm(subscription: SubscriptionItem) {
  form.tenantCode = filters.tenantCode
  form.appCode = subscription.application.appCode
  form.deploymentMode = subscription.deployment?.deploymentMode || subscription.application.runtimeMode || 'customer-hosted'
  form.deploymentStatus = subscription.deployment?.status || 'active'
  form.deploymentCode = subscription.deployment?.deploymentCode || subscription.defaults.deploymentCode
  form.deploymentName = subscription.deployment?.deploymentName || subscription.defaults.deploymentName
  form.runtimeEndpoint = subscription.deployment?.runtimeEndpoint || ''
  form.basePath = subscription.deployment?.basePath || `/${subscription.application.appCode}/`
  form.apiBase = subscription.deployment?.apiBase || `/api/v1/${subscription.application.appCode}`
  form.planCode = subscription.license?.planCode || subscription.entitlement?.planCode || ''
  form.licenseStatus = subscription.license?.status || 'active'
  form.licenseCode = subscription.license?.licenseCode || subscription.defaults.licenseCode
  form.issuedAt = toInputDateTime(subscription.license?.issuedAt || null)
  form.expiresAt = toInputDateTime(subscription.license?.expiresAt || null)
  form.graceUntil = toInputDateTime(subscription.license?.graceUntil || null)
}

async function loadSubscriptions() {
  if (!filters.tenantCode.trim()) {
    subscriptions.value = []
    pagination.total = 0
    selectedAppCode.value = null
    resetForm()
    return
  }

  listPending.value = true
  resetNotice()

  try {
    const response = await platformFetchJson<{ success: true, data: SubscriptionListResponse }>(`${apiPrefix.value}/subscriptions`, {
      query: {
        tenantCode: filters.tenantCode.trim(),
        keyword: filters.keyword || undefined,
        status: filters.status === 'all' ? undefined : filters.status,
        planScoped: isDashboardScope.value ? 'true' : undefined,
        page: pagination.page,
        pageSize: pagination.pageSize
      }
    })

    subscriptions.value = response.data.items
    pagination.total = response.data.total

    if (selectedAppCode.value && !subscriptions.value.some(item => item.application.appCode === selectedAppCode.value)) {
      selectedAppCode.value = null
      resetForm()
    }

    const firstSubscription = subscriptions.value[0]
    if (isDashboardScope.value && !selectedAppCode.value && firstSubscription) {
      selectSubscription(firstSubscription)
    }
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '订阅列表加载失败'
    }
  } finally {
    listPending.value = false
  }
}

async function loadDashboardOverview() {
  if (!isDashboardScope.value) {
    return
  }

  if (!filters.tenantCode.trim()) {
    tenantOverview.value = null
    overviewError.value = ''
    return
  }

  overviewPending.value = true
  overviewError.value = ''

  try {
    const response = await platformFetchJson<{ success: true, data: TenantDashboardOverviewResponse }>(
      `${apiPrefix.value}/dashboard/overview`,
      {
        query: {
          tenantCode: filters.tenantCode.trim()
        }
      }
    )
    tenantOverview.value = response.data
  } catch (error) {
    tenantOverview.value = null
    overviewError.value = error instanceof Error ? error.message : '企业订阅概览加载失败'
  } finally {
    overviewPending.value = false
  }
}

async function loadPlans() {
  if (isDashboardScope.value && !filters.tenantCode.trim()) {
    plans.value = []
    return
  }

  plansPending.value = true

  try {
    const response = await platformFetchJson<{ success: true, data: PlanListResponse }>(`${apiPrefix.value}/plans`, {
      query: {
        tenantCode: filters.tenantCode.trim() || undefined,
        status: 'active',
        pageSize: 100
      }
    })
    plans.value = response.data.items
  } catch (error) {
    plans.value = []
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '套餐列表加载失败'
    }
  } finally {
    plansPending.value = false
  }
}

async function loadArtifacts(subscription = selectedSubscription.value) {
  if (!subscription || !filters.tenantCode.trim()) {
    artifacts.value = null
    return
  }

  artifactsPending.value = true

  try {
    const response = await platformFetchJson<{ success: true, data: SubscriptionArtifacts }>(
      `${apiPrefix.value}/subscriptions/${encodeURIComponent(subscription.application.appCode)}/artifacts`,
      {
        query: {
          tenantCode: filters.tenantCode.trim()
        }
      }
    )
    artifacts.value = response.data
  } catch (error) {
    artifacts.value = {
      tenantCode: filters.tenantCode,
      appCode: subscription.application.appCode,
      appName: subscription.application.appName,
      artifacts: {
        env: null,
        license: null
      },
      warnings: [error instanceof Error ? error.message : '交付材料加载失败']
    }
  } finally {
    artifactsPending.value = false
  }
}

async function rotateTenantRuntimeToken() {
  if (!filters.tenantCode.trim()) {
    return
  }

  if (import.meta.client) {
    const confirmed = window.confirm(
      'Runtime Token 是租户级凭证，轮换后旧 token 会失效。确认继续，并同步更新 console env？业务应用会从 console 获取 Platform 配置。'
    )
    if (!confirmed) {
      return
    }
  }

  runtimeTokenPending.value = true
  resetNotice()

  try {
    const url = isDashboardScope.value
      ? `${apiPrefix.value}/runtime-token`
      : `${apiPrefix.value}/tenants/${encodeURIComponent(filters.tenantCode.trim())}/runtime-token`
    const response = await platformFetchJson<{ success: true, data: TenantRuntimeTokenResponse }>(url, {
      method: 'POST',
      body: {
        tenantCode: filters.tenantCode.trim(),
        confirmTenantWideRotation: true
      }
    })
    tenantRuntimeToken.value = response.data.runtimeCredential.token
    tenantRuntimeTokenLast4.value = response.data.runtimeCredential.runtimeTokenLast4
    notice.value = {
      type: 'success',
      message: `租户 Runtime Token 已轮换，请立即同步到 console env；业务应用启动时会从 console 获取。token 尾号 ${tenantRuntimeTokenLast4.value || '****'}。`
    }
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : 'Runtime Token 生成失败'
    }
  } finally {
    runtimeTokenPending.value = false
  }
}

function selectSubscription(subscription: SubscriptionItem) {
  selectedAppCode.value = subscription.application.appCode
  fillForm(subscription)
  loadArtifacts(subscription)
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

function refreshDashboard() {
  loadDashboardOverview()
  loadPlans()
  loadSubscriptions()
  if (selectedSubscription.value) {
    loadArtifacts()
  }
}

const debouncedReload = useDebounceFn(() => {
  pagination.page = 1
  loadSubscriptions()
}, 250)

watch(() => filters.keyword, debouncedReload)
watch(() => filters.status, () => {
  pagination.page = 1
  loadSubscriptions()
})
watch(() => pagination.page, () => {
  loadSubscriptions()
})
watch(() => filters.tenantCode, (value) => {
  pagination.page = 1
  form.tenantCode = value
  tenantRuntimeToken.value = null
  tenantRuntimeTokenLast4.value = null
  syncTenantQuery()
  loadDashboardOverview()
  loadPlans()
  loadSubscriptions()
})

watch(() => currentTenantCode.value, (value) => {
  if (!isDashboardScope.value) return
  filters.tenantCode = value
})

function validateForm() {
  if (!form.tenantCode.trim()) {
    throw new Error('tenantCode 不能为空')
  }
  if (!form.appCode.trim()) {
    throw new Error('请先从左侧选择应用')
  }
  if (!form.deploymentCode.trim()) {
    throw new Error('deploymentCode 不能为空')
  }
  if (!form.deploymentName.trim()) {
    throw new Error('deploymentName 不能为空')
  }
}

async function submitForm() {
  formPending.value = true
  resetNotice()

  try {
    validateForm()

    const planCode = isDashboardScope.value
      ? dashboardAuthorizationPlanCode.value
      : form.planCode.trim()
    const capabilities = !isDashboardScope.value && planCode ? JSON.parse(form.capabilitiesJson) : undefined
    if (!isDashboardScope.value && planCode && !Array.isArray(capabilities)) {
      throw new Error('capabilities 必须是数组')
    }

    const body: Record<string, unknown> = {
      tenantCode: form.tenantCode.trim(),
      appCode: form.appCode.trim(),
      deploymentMode: form.deploymentMode,
      deploymentStatus: form.deploymentStatus,
      deploymentCode: form.deploymentCode.trim(),
      deploymentName: form.deploymentName.trim(),
      planCode: planCode || null
    }

    if (isDashboardScope.value) {
      body.licenseCode = selectedSubscription.value?.license?.licenseCode || undefined
      body.runtimeEndpoint = form.runtimeEndpoint.trim() || null
    } else {
      body.basePath = form.basePath.trim() || null
      body.apiBase = form.apiBase.trim() || null
      body.licenseStatus = planCode ? form.licenseStatus : null
      body.licenseCode = planCode ? form.licenseCode.trim() : null
      body.issuedAt = planCode ? fromInputDateTime(form.issuedAt) : null
      body.expiresAt = planCode ? fromInputDateTime(form.expiresAt) : null
      body.graceUntil = planCode ? fromInputDateTime(form.graceUntil) : null
      body.capabilities = capabilities || []
    }

    const response = await platformFetchJson<{ success: true, data: SubscriptionItem }>(`${apiPrefix.value}/subscriptions`, {
      method: 'POST',
      body
    })

    notice.value = {
      type: 'success',
      message: planCode ? '订阅与授权已保存。' : '订阅关系已建立，当前尚未签发 license。'
    }

    await loadSubscriptions()
    await loadDashboardOverview()
    const latest = subscriptions.value.find(item => item.application.appCode === response.data.application.appCode)
    if (latest) {
      selectSubscription(latest)
    }
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '订阅保存失败'
    }
  } finally {
    formPending.value = false
  }
}

onMounted(() => {
  loadDashboardOverview()
  loadPlans()
  if (filters.tenantCode) {
    loadSubscriptions()
  }
})

onBeforeUnmount(() => {
  if (copyFeedbackTimer) {
    clearTimeout(copyFeedbackTimer)
  }
})
</script>

<template>
  <UDashboardPanel
    id="platform-subscriptions"
    :ui="{ body: isDashboardScope ? 'console-page' : 'gap-4 sm:p-4' }"
  >
    <template #body>
      <template v-if="isDashboardScope">
        <section class="grid gap-4">
          <UCard>
            <template #header>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="mt-1 pr-3 text-xl font-semibold text-slate-900">
                    应用管理
                  </p>

                  <span class="mt-1 text-sm text-slate-600">
                    {{ tenantOverview?.tenant.primaryDomain || filters.tenantCode || '当前账号尚未选择企业' }}
                  </span>
                  <UBadge
                    :color="tenantOverview?.tenant.status === 'active' ? 'success' : 'neutral'"
                    variant="soft"
                  >
                    {{ tenantOverview?.tenant.status || 'unknown' }}
                  </UBadge>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-refresh-cw"
                    :loading="overviewPending || listPending"
                    @click="refreshDashboard"
                  >
                    刷新
                  </UButton>
                  <UButton
                    color="primary"
                    variant="soft"
                    icon="i-lucide-key-round"
                    :loading="runtimeTokenPending"
                    @click="rotateTenantRuntimeToken"
                  >
                    轮换应用密钥
                  </UButton>
                </div>
              </div>
            </template>

            <div class="space-y-4">
              <div
                v-if="notice"
                class="tenant-notice"
                :data-tone="notice.type"
              >
                {{ notice.message }}
              </div>

              <div
                v-if="overviewError"
                class="tenant-notice"
                data-tone="error"
              >
                {{ overviewError }}
              </div>

              <div
                v-if="!hasTenantContext"
                class="console-empty"
              >
                请先在企业工作台选择企业。
              </div>

              <div
                v-else
              >
                <div class="space-y-4">
                  <!-- <div class="grid gap-3 md:grid-cols-4">
                    <div
                      v-for="card in dashboardPlanCards"
                      :key="card.label"
                      class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        {{ card.label }}
                      </p>
                      <p class="mt-2 truncate text-base font-semibold text-slate-900">
                        {{ card.value }}
                      </p>
                      <p class="mt-1 truncate text-sm text-slate-600">
                        {{ card.detail }}
                      </p>
                    </div>
                  </div> -->

                  <div class="grid gap-3 md:grid-cols-4">
                    <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
                      <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        应用总数
                      </p>
                      <p class="mt-2 text-xl font-semibold text-slate-900">
                        {{ tenantOverview?.stats.totalAppCount ?? workflowStats.total }}
                      </p>
                    </div>
                    <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
                      <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        平台服务
                      </p>
                      <p class="mt-2 text-xl font-semibold text-slate-900">
                        {{ tenantOverview?.stats.platformServiceAppCount ?? workflowStats.platformServices }}
                      </p>
                    </div>
                    <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
                      <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        业务应用
                      </p>
                      <p class="mt-2 text-xl font-semibold text-slate-900">
                        {{ tenantOverview?.stats.businessAppCount ?? workflowStats.businessApps }}
                      </p>
                    </div>
                    <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
                      <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                        部署 / 授权
                      </p>
                      <p class="mt-2 text-xl font-semibold text-slate-900">
                        {{ tenantOverview?.stats.deployedAppCount ?? workflowStats.deployed }} / {{ tenantOverview?.stats.licensedAppCount ?? workflowStats.licensed }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </UCard>

          <section
            v-if="hasTenantContext"
            class="grid gap-4 xl:grid-cols-[minmax(18rem,30%)_minmax(0,1fr)]"
          >
            <UCard :ui="{ root: 'h-full' }">
              <template #header>
                <div class="space-y-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <h2 class="mt-1 text-lg font-semibold text-slate-900">
                        应用列表
                      </h2>
                    </div>
                    <UBadge
                      color="neutral"
                      variant="soft"
                    >
                      {{ pagination.total }}
                    </UBadge>
                  </div>
                  <div class="grid gap-2">
                    <UInput
                      v-model="filters.keyword"
                      placeholder="搜索应用"
                      icon="i-lucide-search"
                    />
                    <USelect
                      v-model="filters.status"
                      class="w-full"
                      size="md"
                      :items="stageOptions"
                    />
                  </div>
                </div>
              </template>

              <div class="space-y-2">
                <button
                  v-for="subscription in subscriptions"
                  :key="subscription.application.appCode"
                  type="button"
                  class="tenant-list-card p-3"
                  :data-active="subscription.application.appCode === selectedAppCode"
                  @click="selectSubscription(subscription)"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-semibold text-slate-900">
                        {{ subscription.application.appName }}
                      </p>
                      <p class="mt-1 truncate text-xs text-slate-500">
                        {{ subscription.application.appCode }}
                      </p>
                    </div>
                    <UBadge
                      :color="subscription.stage.tone"
                      variant="soft"
                      size="sm"
                    >
                      {{ subscription.stage.label }}
                    </UBadge>
                  </div>
                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <UBadge
                      :color="serviceRoleTone(subscription.application.serviceRole)"
                      variant="soft"
                      size="sm"
                    >
                      {{ roleLabel(subscription.application.serviceRole) }}
                    </UBadge>
                    <span class="truncate text-xs text-slate-500">
                      {{ subscription.deployment?.basePath || subscription.application.runtimeMode }}
                    </span>
                  </div>
                </button>

                <div
                  v-if="listPending"
                  class="console-empty"
                >
                  正在加载应用...
                </div>

                <div
                  v-else-if="subscriptions.length === 0"
                  class="console-empty"
                >
                  当前没有匹配的应用。
                </div>
              </div>

              <div class="mt-4 flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-sm text-slate-500">
                <span>{{ pagination.page }} / {{ pageCount }}</span>
                <div class="flex items-center gap-2">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :disabled="pagination.page <= 1"
                    @click="pagination.page -= 1"
                  >
                    上一页
                  </UButton>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :disabled="pagination.page >= pageCount"
                    @click="pagination.page += 1"
                  >
                    下一页
                  </UButton>
                </div>
              </div>
            </UCard>

            <UCard :ui="{ root: 'h-full' }">
              <template #header>
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p class="console-eyebrow">
                      Application Configuration
                    </p>
                    <h2 class="mt-1 text-lg font-semibold text-slate-900">
                      {{ selectedSubscription?.application.appName || '应用信息' }}
                    </h2>
                    <p class="mt-1 text-sm text-slate-600">
                      {{ selectedSubscription?.application.description || selectedSubscription?.application.appCode || '从左侧选择一个应用。' }}
                    </p>
                  </div>
                  <UBadge
                    :color="selectedSubscription?.stage.tone || 'neutral'"
                    variant="soft"
                  >
                    {{ selectedSubscription?.stage.label || '未选择' }}
                  </UBadge>
                </div>
              </template>

              <div
                v-if="!selectedSubscription"
                class="console-empty"
              >
                从左侧选择应用后查看配置项。
              </div>

              <div
                v-else
                class="space-y-5"
              >
                <div class="grid gap-3 md:grid-cols-4">
                  <div
                    v-for="item in selectedAppSummary"
                    :key="item.label"
                    class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {{ item.label }}
                    </p>
                    <p class="mt-2 truncate text-sm font-semibold text-slate-900">
                      {{ item.value }}
                    </p>
                    <p class="mt-1 truncate text-xs text-slate-600">
                      {{ item.detail }}
                    </p>
                  </div>
                </div>

                <form
                  class="space-y-5"
                  @submit.prevent="submitForm"
                >
                  <section class="space-y-3">
                    <div class="border-b border-slate-200 pb-2">
                      <h3 class="text-sm font-semibold text-slate-900">
                        部署配置
                      </h3>
                    </div>
                    <div class="grid gap-4 md:grid-cols-2">
                      <label class="tenant-field">
                        <span class="tenant-field__label">当前企业</span>
                        <UInput
                          v-model="form.tenantCode"
                          :disabled="true"
                        />
                      </label>

                      <label class="tenant-field">
                        <span class="tenant-field__label">当前应用</span>
                        <UInput
                          v-model="form.appCode"
                          :disabled="true"
                        />
                      </label>

                      <label class="tenant-field">
                        <span class="tenant-field__label">部署方式</span>
                        <USelect
                          v-model="form.deploymentMode"
                          class="w-full"
                          :items="deploymentModeOptions"
                        />
                      </label>

                      <label class="tenant-field">
                        <span class="tenant-field__label">部署状态</span>
                        <USelect
                          v-model="form.deploymentStatus"
                          class="w-full"
                          :items="deploymentStatusOptions"
                        />
                      </label>

                      <label class="tenant-field">
                        <span class="tenant-field__label">部署标识</span>
                        <UInput
                          v-model="form.deploymentCode"
                          placeholder="deploymentCode"
                        />
                      </label>

                      <label class="tenant-field">
                        <span class="tenant-field__label">部署名称</span>
                        <UInput
                          v-model="form.deploymentName"
                          placeholder="deploymentName"
                        />
                      </label>

                      <label
                        v-if="isDashboardScope"
                        class="tenant-field md:col-span-2"
                      >
                        <span class="tenant-field__label">应用覆盖 Agent Endpoint</span>
                        <UInput
                          v-model="form.runtimeEndpoint"
                          placeholder="留空则继承企业默认"
                        />
                        <span class="text-xs leading-5 text-slate-500">
                          企业默认地址在“部署管理”中维护；只有该应用需要单独 Agent 时才填写。
                        </span>
                      </label>

                      <div
                        v-else
                        class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2"
                      >
                        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          应用覆盖 Agent Endpoint
                        </p>
                        <p class="mt-2 break-all text-sm font-semibold text-slate-900">
                          {{ selectedSubscription.deployment?.runtimeEndpoint || '继承企业默认' }}
                        </p>
                        <p class="mt-1 text-xs text-slate-600">
                          企业默认地址由企业侧部署管理维护。
                        </p>
                      </div>

                      <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          挂载路径
                        </p>
                        <p class="mt-2 truncate text-sm font-semibold text-slate-900">
                          {{ selectedSubscription.deployment?.basePath || form.basePath || '平台默认' }}
                        </p>
                        <p class="mt-1 truncate text-xs text-slate-600">
                          由平台管理员统一管理
                        </p>
                      </div>

                      <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          API 前缀
                        </p>
                        <p class="mt-2 truncate text-sm font-semibold text-slate-900">
                          {{ selectedSubscription.deployment?.apiBase || form.apiBase || '平台默认' }}
                        </p>
                        <p class="mt-1 truncate text-xs text-slate-600">
                          由平台管理员统一管理
                        </p>
                      </div>
                    </div>
                  </section>

                  <section class="space-y-3">
                    <div class="border-b border-slate-200 pb-2">
                      <h3 class="text-sm font-semibold text-slate-900">
                        授权信息
                      </h3>
                    </div>
                    <div class="grid gap-3 md:grid-cols-3">
                      <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          企业套餐
                        </p>
                        <p class="mt-2 truncate text-sm font-semibold text-slate-900">
                          {{ tenantOverview?.tenant.planName || dashboardAuthorizationPlanCode || '未配置' }}
                        </p>
                        <p class="mt-1 truncate text-xs text-slate-600">
                          {{ dashboardAuthorizationPlanCode || '—' }}
                        </p>
                      </div>
                      <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          License 标识
                        </p>
                        <p class="mt-2 truncate text-sm font-semibold text-slate-900">
                          {{ selectedSubscription.license?.licenseCode || form.licenseCode || '保存后自动生成' }}
                        </p>
                        <p class="mt-1 truncate text-xs text-slate-600">
                          自动生成
                        </p>
                      </div>
                      <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                        <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          有效期
                        </p>
                        <p class="mt-2 truncate text-sm font-semibold text-slate-900">
                          {{ formatDate(tenantOverview?.tenant.subscriptionEndedAt || null) }}
                        </p>
                        <p class="mt-1 truncate text-xs text-slate-600">
                          {{ formatDate(tenantOverview?.tenant.subscriptionStartedAt || null) }} 起
                        </p>
                      </div>
                    </div>
                  </section>

                  <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                    <div class="text-xs text-slate-500">
                      <span v-if="selectedSubscription.license">当前 license：{{ selectedSubscription.license.licenseCode }}</span>
                      <span v-else>当前未签发 license。</span>
                    </div>
                    <UButton
                      color="primary"
                      type="submit"
                      :loading="formPending"
                    >
                      保存配置
                    </UButton>
                  </div>
                </form>

                <section class="space-y-4 border-t border-slate-200 pt-5">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 class="text-sm font-semibold text-slate-900">
                        env 与平台 token
                      </h3>
                      <p class="mt-1 text-sm text-slate-600">
                        {{ artifacts?.artifacts.env?.filename || artifacts?.artifacts.license?.filename || '保存配置后生成交付材料' }}
                      </p>
                    </div>
                    <UButton
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-refresh-cw"
                      :loading="artifactsPending"
                      @click="loadArtifacts()"
                    >
                      刷新材料
                    </UButton>
                  </div>

                  <div
                    v-if="artifacts?.warnings.length"
                    class="space-y-2"
                  >
                    <div
                      v-for="warning in artifacts.warnings"
                      :key="warning"
                      class="rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800"
                    >
                      {{ warning }}
                    </div>
                  </div>

                  <div class="grid gap-4 xl:grid-cols-1">
                    <div
                      v-if="selectedIsPlatformService"
                      class="space-y-2"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <p class="text-sm font-semibold text-slate-900">
                          {{ artifacts?.artifacts.env?.filename || `${form.tenantCode}.${form.appCode}.env` }}
                        </p>
                        <div class="copy-action">
                          <span
                            v-if="copyFeedback?.key === 'dashboard-env'"
                            class="copy-action__status"
                            :class="copyFeedback.tone === 'success' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'"
                          >
                            <UIcon
                              :name="copyFeedback.tone === 'success' ? 'i-lucide-check' : 'i-lucide-circle-alert'"
                              class="size-4"
                            />
                            {{ copyFeedback.message }}
                          </span>
                          <UButton
                            v-else
                            color="neutral"
                            variant="soft"
                            size="sm"
                            icon="i-lucide-copy"
                            :disabled="!artifacts?.artifacts.env"
                            @click="displayedEnvContent && copyArtifact(displayedEnvContent, 'dashboard-env')"
                          >
                            复制
                          </UButton>
                        </div>
                      </div>
                      <textarea
                        :value="displayedEnvContent || '保存 deployment 后生成 env 内容。'"
                        readonly
                        class="tenant-native-field min-h-64 w-full resize-y font-mono text-xs"
                      />
                    </div>
                  </div>
                </section>
              </div>
            </UCard>
          </section>
        </section>
      </template>

      <section
        v-else
        class="grid gap-4 xl:grid-cols-[0.95fr_1.15fr]"
      >
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                  {{ isDashboardScope ? 'Application Center' : 'Activation Orchestration' }}
                </p>
                <h1 class="text-xl font-semibold text-slate-900">
                  {{ isDashboardScope ? '应用中心' : '开通编排工作台' }}
                </h1>
                <p class="mt-1 text-sm text-slate-600">
                  {{
                    isDashboardScope
                      ? '租户管理员在这里查看本租户应用启用进度，并继续补齐授权和 deployment。'
                      : '平台运营在这里为一个客户编排应用选择、订阅、license、deployment 和 release gate。'
                  }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="listPending"
                  @click="loadSubscriptions"
                >
                  刷新
                </UButton>
              </div>
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid gap-3 md:grid-cols-2">
              <label
                v-if="!isDashboardScope"
                class="tenant-field md:col-span-2"
              >
                <span class="tenant-field__label">客户 / tenantCode</span>
                <UInput
                  v-model="filters.tenantCode"
                  placeholder="输入客户 tenantCode，例如 C000001"
                />
              </label>

              <div
                v-else
                class="tenant-field md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
              >
                <span class="tenant-field__label">当前租户</span>
                <p class="mt-2 text-base font-semibold text-slate-900">
                  {{ filters.tenantCode || '未锁定租户上下文' }}
                </p>
                <p class="mt-1 text-sm text-slate-600">
                  这里直接复用租户管理台当前上下文，不再手工输入 tenantCode。
                </p>
              </div>

              <label class="tenant-field">
                <span class="tenant-field__label">开通阶段</span>
                <USelect
                  v-model="filters.status"
                  class="w-full"
                  :items="stageOptions"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">应用关键字</span>
                <UInput
                  v-model="filters.keyword"
                  placeholder="搜索 appCode / appName"
                  icon="i-lucide-search"
                />
              </label>
            </div>

            <div
              v-if="notice"
              class="tenant-notice"
              :data-tone="notice.type"
            >
              {{ notice.message }}
            </div>

            <div
              v-if="hasTenantContext"
              class="rounded-2xl border border-amber-200 bg-amber-50/70 p-4"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
                    Tenant Runtime Credential
                  </p>
                  <h3 class="mt-1 text-base font-semibold text-slate-900">
                    租户级 Runtime Token
                  </h3>
                  <p class="mt-1 text-sm leading-6 text-slate-600">
                    Runtime Token 属于租户，不属于单个应用。只下发给 console；业务应用启动时凭自己的 license 向 console 拉取 Platform 连接配置。
                  </p>
                  <p
                    v-if="tenantRuntimeTokenLast4"
                    class="mt-2 text-xs text-amber-800"
                  >
                    本次会话已生成 token，尾号 {{ tenantRuntimeTokenLast4 }}；请只更新 console 的 HZY_PLATFORM_RUNTIME_TOKEN。
                  </p>
                  <div
                    v-if="tenantRuntimeTokenEnvLine"
                    class="mt-3 flex flex-wrap items-center gap-2"
                  >
                    <code class="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                      {{ tenantRuntimeTokenEnvLine }}
                    </code>
                    <div class="copy-action">
                      <span
                        v-if="copyFeedback?.key === 'runtime-token-env'"
                        class="copy-action__status"
                        :class="copyFeedback.tone === 'success' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'"
                      >
                        <UIcon
                          :name="copyFeedback.tone === 'success' ? 'i-lucide-check' : 'i-lucide-circle-alert'"
                          class="size-4"
                        />
                        {{ copyFeedback.message }}
                      </span>
                      <UButton
                        v-else
                        color="neutral"
                        variant="soft"
                        size="sm"
                        icon="i-lucide-copy"
                        @click="copyArtifact(tenantRuntimeTokenEnvLine, 'runtime-token-env')"
                      >
                        复制 token env
                      </UButton>
                    </div>
                  </div>
                </div>
                <UButton
                  color="warning"
                  variant="soft"
                  icon="i-lucide-key-round"
                  :loading="runtimeTokenPending"
                  @click="rotateTenantRuntimeToken"
                >
                  轮换租户 Token
                </UButton>
              </div>
            </div>

            <div
              v-if="hasTenantContext"
              class="console-kpi-grid"
            >
              <div class="console-kpi">
                <p class="console-eyebrow">
                  应用类型
                </p>
                <p class="console-kpi__value">
                  {{ workflowStats.total }}
                </p>
                <p class="mt-3 text-sm text-slate-600">
                  平台服务 {{ workflowStats.platformServices }} · 业务应用 {{ workflowStats.businessApps }}
                </p>
              </div>
              <div class="console-kpi">
                <p class="console-eyebrow">
                  部署 / 授权
                </p>
                <p class="console-kpi__value">
                  {{ workflowStats.deployed }} / {{ workflowStats.licensed }}
                </p>
                <p class="mt-3 text-sm text-slate-600">
                  已正式启用 {{ workflowStats.active }}
                </p>
              </div>
            </div>

            <div
              v-if="!hasTenantContext"
              class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
            >
              {{ isDashboardScope ? '请先在租户工作台首页锁定租户上下文。' : '先输入客户 tenantCode，再查看可开通应用和当前启用阶段。' }}
            </div>

            <div
              v-else
              class="space-y-3"
            >
              <button
                v-for="subscription in subscriptions"
                :key="subscription.application.appCode"
                type="button"
                class="tenant-list-card"
                :data-active="subscription.application.appCode === selectedAppCode"
                @click="selectSubscription(subscription)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm font-semibold text-slate-900">{{ subscription.application.appName }}</span>
                      <UBadge
                        :color="serviceRoleTone(subscription.application.serviceRole)"
                        variant="soft"
                      >
                        {{ roleLabel(subscription.application.serviceRole) }}
                      </UBadge>
                      <UBadge
                        variant="soft"
                        color="neutral"
                      >
                        {{ subscription.application.appCode }}
                      </UBadge>
                    </div>
                    <p class="mt-1 truncate text-sm text-slate-600">
                      {{ subscription.application.description || `${subscription.application.appType} / ${subscription.application.runtimeMode}` }}
                    </p>
                  </div>
                  <UBadge
                    :color="subscription.stage.tone"
                    variant="soft"
                  >
                    {{ subscription.stage.label }}
                  </UBadge>
                </div>

                <dl class="mt-3 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      类型
                    </dt>
                    <dd class="ml-1 inline">
                      {{ roleLabel(subscription.application.serviceRole) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      部署
                    </dt>
                    <dd class="ml-1 inline">
                      {{ subscription.deployment?.deploymentCode || '未创建' }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      授权
                    </dt>
                    <dd class="ml-1 inline">
                      {{ subscription.license?.licenseCode || '未签发' }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      Manifest
                    </dt>
                    <dd class="ml-1 inline">
                      {{ subscription.manifest?.version || '未发现' }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      心跳
                    </dt>
                    <dd class="ml-1 inline">
                      {{ formatDate(subscription.deployment?.lastHeartbeatAt || null) }}
                    </dd>
                  </div>
                  <div class="sm:col-span-2">
                    <dt class="inline font-medium text-slate-700">
                      入口
                    </dt>
                    <dd class="ml-1 inline">
                      {{ subscription.deployment?.basePath || '未设置' }}
                    </dd>
                  </div>
                </dl>
              </button>

              <div
                v-if="!listPending && subscriptions.length === 0"
                class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
              >
                当前租户下还没有可纳管的应用。
              </div>
            </div>

            <div
              v-if="hasTenantContext"
              class="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-sm text-slate-500"
            >
              <span>共 {{ pagination.total }} 条</span>
              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :disabled="pagination.page <= 1"
                  @click="pagination.page -= 1"
                >
                  上一页
                </UButton>
                <span>{{ pagination.page }} / {{ pageCount }}</span>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :disabled="pagination.page >= pageCount"
                  @click="pagination.page += 1"
                >
                  下一页
                </UButton>
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-lime-700">
                  Workflow
                </p>
                <h2 class="text-xl font-semibold text-slate-900">
                  当前开通路径
                </h2>
                <p class="mt-1 text-sm text-slate-600">
                  先选择应用，再按订阅、部署、授权和 release gate 的顺序推进。
                </p>
              </div>
              <UBadge
                :color="selectedSubscription?.stage.tone || 'neutral'"
                variant="soft"
              >
                {{ selectedSubscription ? recommendedAction : '请选择应用' }}
              </UBadge>
            </div>
          </template>

          <div
            v-if="!selectedSubscription"
            class="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500"
          >
            从左侧选择一个应用后，右侧会显示本次开通的步骤、阻塞点和必要配置。
          </div>

          <div
            v-else
            class="space-y-4"
          >
            <div class="grid gap-3 md:grid-cols-3">
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                  应用
                </p>
                <p class="mt-1 text-base font-semibold text-slate-900">
                  {{ selectedSubscription.application.appName }}
                </p>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                  <span class="text-sm text-slate-600">{{ selectedSubscription.application.appCode }}</span>
                  <UBadge
                    :color="serviceRoleTone(selectedSubscription.application.serviceRole)"
                    variant="soft"
                    size="sm"
                  >
                    {{ roleLabel(selectedSubscription.application.serviceRole) }}
                  </UBadge>
                </div>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Manifest
                </p>
                <p class="mt-1 text-base font-semibold text-slate-900">
                  {{ selectedSubscription.manifest?.version || '未发现' }}
                </p>
                <p class="text-sm text-slate-600">
                  {{ selectedSubscription.application.runtimeMode }}
                </p>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                  当前阶段
                </p>
                <p class="mt-1 text-base font-semibold text-slate-900">
                  {{ selectedSubscription.stage.label }}
                </p>
                <p class="text-sm text-slate-600">
                  {{ selectedSubscription.deployment?.deploymentCode || '尚未创建 deployment' }}
                </p>
              </div>
            </div>

            <div class="console-step-list">
              <div
                v-for="(step, index) in orchestrationSteps"
                :key="step.title"
                class="console-step"
                :data-complete="step.completed"
              >
                <span class="console-step__index">{{ index + 1 }}</span>
                <div>
                  <p class="text-sm font-semibold text-slate-900">
                    {{ step.title }}
                  </p>
                  <p class="mt-1 text-sm leading-6 text-slate-600">
                    {{ step.description }}
                  </p>
                </div>
                <UBadge
                  :color="step.completed ? 'success' : 'neutral'"
                  variant="soft"
                >
                  {{ step.completed ? '完成' : '待处理' }}
                </UBadge>
              </div>
            </div>

            <form
              class="space-y-4"
              @submit.prevent="submitForm"
            >
              <div class="grid gap-4 md:grid-cols-2">
                <label class="tenant-field">
                  <span class="tenant-field__label">当前客户</span>
                  <UInput
                    v-model="form.tenantCode"
                    :disabled="true"
                  />
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">当前应用</span>
                  <UInput
                    v-model="form.appCode"
                    :disabled="true"
                  />
                </label>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <label class="tenant-field">
                  <span class="tenant-field__label">部署方式</span>
                  <USelect
                    v-model="form.deploymentMode"
                    class="w-full"
                    :items="deploymentModeOptions"
                  />
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">部署状态</span>
                  <USelect
                    v-model="form.deploymentStatus"
                    class="w-full"
                    :items="deploymentStatusOptions"
                  />
                </label>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <label class="tenant-field">
                  <span class="tenant-field__label">部署标识</span>
                  <UInput
                    v-model="form.deploymentCode"
                    placeholder="自动建议；只有多环境时需要调整"
                  />
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">部署名称</span>
                  <UInput
                    v-model="form.deploymentName"
                    placeholder="例如 AIMS · C000001"
                  />
                </label>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <label class="tenant-field">
                  <span class="tenant-field__label">挂载路径 / basePath</span>
                  <UInput
                    v-model="form.basePath"
                    placeholder="例如 /aims/，根应用使用 /"
                  />
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">API 前缀 / apiBase</span>
                  <UInput
                    v-model="form.apiBase"
                    placeholder="默认 /api/v1/{appCode}"
                  />
                </label>
              </div>

              <p class="text-xs leading-5 text-slate-500">
                员工入口由企业端部署 URL 与 basePath 自动生成；OIDC callback 按最终 homeUrl + /api/auth/oidc-callback 自动下发。
              </p>

              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p class="font-medium text-slate-900">
                  授权策略
                </p>
                <p class="mt-1">
                  如果套餐留空，本次只建立订阅和 deployment，不签发 license；适合“客户已选择应用，但商务或授权尚未确认”的阶段。
                </p>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <label class="tenant-field">
                  <span class="tenant-field__label">套餐 / 授权方案</span>
                  <USelect
                    v-model="selectedPlanValue"
                    class="w-full"
                    :items="planOptions"
                    :disabled="plansPending"
                    placeholder="选择套餐 / 授权方案"
                  />
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">授权状态</span>
                  <USelect
                    v-model="form.licenseStatus"
                    class="w-full"
                    :disabled="!hasLicensePlan"
                    :items="licenseStatusOptions"
                  />
                </label>
              </div>

              <div class="grid gap-4 md:grid-cols-3">
                <label class="tenant-field md:col-span-2">
                  <span class="tenant-field__label">License 标识</span>
                  <UInput
                    v-model="form.licenseCode"
                    :disabled="!hasLicensePlan"
                    placeholder="自动建议，也可手工调整"
                  />
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">生效时间</span>
                  <input
                    v-model="form.issuedAt"
                    type="datetime-local"
                    class="tenant-native-field"
                    :disabled="!hasLicensePlan"
                  >
                </label>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <label class="tenant-field">
                  <span class="tenant-field__label">到期时间</span>
                  <input
                    v-model="form.expiresAt"
                    type="datetime-local"
                    class="tenant-native-field"
                    :disabled="!hasLicensePlan"
                  >
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">宽限截止</span>
                  <input
                    v-model="form.graceUntil"
                    type="datetime-local"
                    class="tenant-native-field"
                    :disabled="!hasLicensePlan"
                  >
                </label>
              </div>

              <details class="console-disclosure">
                <summary>高级授权能力 JSON</summary>
                <label class="tenant-field mt-3">
                  <span class="tenant-field__label">capabilitiesJson</span>
                  <textarea
                    v-model="form.capabilitiesJson"
                    class="tenant-native-field min-h-56 resize-y font-mono text-xs"
                    :disabled="!hasLicensePlan"
                    placeholder="输入 capability JSON 数组"
                  />
                </label>
                <p class="mt-2 text-sm text-slate-600">
                  常规开通只需要选择套餐；只有需要覆盖具体 capability 时才编辑这里。
                </p>
              </details>

              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <div class="text-xs text-slate-500">
                  <span v-if="selectedSubscription.license">当前 license：{{ selectedSubscription.license.licenseCode }}</span>
                  <span v-else>当前还没有 license，适合先建立订阅关系。</span>
                </div>

                <UButton
                  color="primary"
                  type="submit"
                  :loading="formPending"
                >
                  保存开通编排
                </UButton>
              </div>
            </form>

            <div class="rounded-2xl border border-slate-200 bg-white p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p class="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Delivery Artifacts
                  </p>
                  <h3 class="mt-1 text-base font-semibold text-slate-900">
                    env 与平台 token
                  </h3>
                  <p class="mt-1 text-sm text-slate-600">
                    保存开通编排后，在这里复制应用启动所需配置；Console 的授权 token 已写入 env。
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-refresh-cw"
                    :loading="artifactsPending"
                    @click="loadArtifacts()"
                  >
                    刷新材料
                  </UButton>
                </div>
              </div>

              <p class="mt-3 text-xs leading-5 text-slate-500">
                只有平台服务类应用提供 .env；业务应用不再下发 license.lic，启动后通过 Console runtime/app identity 获取运行时配置与服务令牌。
              </p>

              <div
                v-if="artifacts?.warnings.length"
                class="mt-4 space-y-2"
              >
                <div
                  v-for="warning in artifacts.warnings"
                  :key="warning"
                  class="rounded-xl border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800"
                >
                  {{ warning }}
                </div>
              </div>

              <div class="mt-4 grid gap-4 xl:grid-cols-1">
                <div
                  v-if="selectedIsPlatformService"
                  class="space-y-2"
                >
                  <div class="flex items-center justify-between gap-2">
                    <div>
                      <p class="text-sm font-semibold text-slate-900">
                        {{ artifacts?.artifacts.env?.filename || `${form.tenantCode}.${form.appCode}.env` }}
                      </p>
                      <p class="text-xs text-slate-500">
                        应用运行时环境变量
                      </p>
                    </div>
                    <div class="copy-action">
                      <span
                        v-if="copyFeedback?.key === 'admin-env'"
                        class="copy-action__status"
                        :class="copyFeedback.tone === 'success' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'"
                      >
                        <UIcon
                          :name="copyFeedback.tone === 'success' ? 'i-lucide-check' : 'i-lucide-circle-alert'"
                          class="size-4"
                        />
                        {{ copyFeedback.message }}
                      </span>
                      <UButton
                        v-else
                        color="neutral"
                        variant="soft"
                        size="sm"
                        icon="i-lucide-copy"
                        :disabled="!artifacts?.artifacts.env"
                        @click="displayedEnvContent && copyArtifact(displayedEnvContent, 'admin-env')"
                      >
                        复制
                      </UButton>
                    </div>
                  </div>
                  <textarea
                    :value="displayedEnvContent || '保存 deployment 后生成 env 内容。'"
                    readonly
                    class="tenant-native-field min-h-72 resize-y font-mono text-xs w-full"
                  />
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </section>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
.copy-action {
  display: inline-flex;
  min-width: 5.5rem;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.copy-action__status {
  display: inline-flex;
  min-height: 2rem;
  min-width: 5.5rem;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border-radius: 0.375rem;
  padding: 0 0.625rem;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
}
</style>
