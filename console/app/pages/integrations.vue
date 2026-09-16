<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('集成中心')

type IntegrationType = 'gitlab' | 'ai_provider' | 'wecom' | 'dingtalk' | 'dingtalk_identity' | 'oss'
type StoredIntegrationType = Exclude<IntegrationType, 'dingtalk_identity'>
type StorageBackend = 'env_ref' | 'docker_secret' | 'k8s_secret' | 'db_encrypted'
type FieldType = 'text' | 'url' | 'number'
type DingTalkLoginMode = 'shared' | 'independent'

type ApiResponse<T> = {
  code: number
  data: T
  message?: string
}

type IntegrationItem = {
  integrationCode: string
  integrationType: string
  integrationName: string
  category: string
  providerCode: string | null
  baseUrl: string | null
  config: Record<string, unknown>
  connectivityStatus: string
  lastCheckedAt: string | null
  lastErrorMessage: string | null
  status: string
  currentCredential: {
    credentialName: string
    credentialVersionNo: number | null
    versionNo: number | null
    secretCode: string
    secretRef: string
    secretUsageType: string
    status: string
  } | null
  updatedAt: string
}

type VaultSecret = {
  secretCode: string
  secretRef: string
  secretName: string
  secretType: string
  usageType: string
  ownerType: string
  ownerKey: string | null
  storageBackend: string
  maskedPreview: string | null
  currentVersionNo: number | null
  status: string
  updatedAt: string
}

type DingTalkTestResult = {
  integrationCode: string
  touser: string
  status: string
  replayVerified: boolean
}

type IntegrationDefinition = {
  type: IntegrationType
  integrationType: StoredIntegrationType
  title: string
  description: string
  icon: string
  integrationCode: string
  integrationName: string
  category: string
  providerCode: string
  baseUrl: string
  defaultSecretCode: string
  secretName: string
  secretType: string
  defaultBackendRef: string
  defaultStorageBackend?: StorageBackend
  configFields: Array<{
    key: string
    label: string
    type?: FieldType
    placeholder?: string
    defaultValue: string | number
  }>
}

type IntegrationForm = {
  integrationCode: string
  integrationName: string
  baseUrl: string
  status: 'active' | 'inactive'
  secretCode: string
  storageBackend: StorageBackend
  secretMaterial: string
  bindVersionNo: string
  config: Record<string, string | number>
}

const definitions: Record<IntegrationType, IntegrationDefinition> = {
  gitlab: {
    type: 'gitlab',
    integrationType: 'gitlab',
    title: 'GitLab',
    description: '文档同步、commit、diff读取',
    icon: 'i-simple-icons-gitlab',
    integrationCode: 'gitlab.default',
    integrationName: 'Default GitLab',
    category: 'code_repository',
    providerCode: 'gitlab',
    baseUrl: 'https://gitlab.wiztek.cn',
    defaultSecretCode: 'integration.gitlab.default.bot_token',
    secretName: 'GitLab default bot token',
    secretType: 'api_token',
    defaultBackendRef: 'GITLAB_BOT_TOKEN',
    configFields: [
      { key: 'defaultBranch', label: '默认分支', placeholder: 'main', defaultValue: 'main' },
      { key: 'groupPath', label: '同步根群组', placeholder: 'huizhi-yun', defaultValue: '' }
    ]
  },
  ai_provider: {
    type: 'ai_provider',
    integrationType: 'ai_provider',
    title: 'AI Provider',
    description: 'OpenAI 兼容模型供应商 API Key 与默认模型',
    icon: 'i-lucide-brain-circuit',
    integrationCode: 'ai.default',
    integrationName: 'Default AI Provider',
    category: 'ai',
    providerCode: 'openai_compatible',
    baseUrl: 'https://api.openai.com',
    defaultSecretCode: 'integration.ai.default.api_key',
    secretName: 'AI provider default API key',
    secretType: 'api_key',
    defaultBackendRef: 'AI_PROVIDER_API_KEY',
    configFields: [
      { key: 'defaultModel', label: '默认模型', placeholder: 'gpt-4.1-mini', defaultValue: 'gpt-4.1-mini' },
      { key: 'checkPath', label: '检查路径', placeholder: '/v1/models', defaultValue: '/v1/models' }
    ]
  },
  wecom: {
    type: 'wecom',
    integrationType: 'wecom',
    title: '企业微信',
    description: '通知、OAuth 和企业应用凭证',
    icon: 'i-simple-icons-wechat',
    integrationCode: 'wecom.default',
    integrationName: 'Default WeCom',
    category: 'notification',
    providerCode: 'wecom',
    baseUrl: 'https://qyapi.weixin.qq.com',
    defaultSecretCode: 'integration.wecom.default.corpsecret',
    secretName: 'WeCom default corpsecret',
    secretType: 'oauth_secret',
    defaultBackendRef: 'WECOM_CORPSECRET',
    defaultStorageBackend: 'db_encrypted',
    configFields: [
      { key: 'corpid', label: 'Corp ID', placeholder: 'ww...', defaultValue: '' },
      { key: 'agentid', label: 'Agent ID', placeholder: '1000001', defaultValue: '' }
    ]
  },
  dingtalk: {
    type: 'dingtalk',
    integrationType: 'dingtalk',
    title: '钉钉',
    description: '通知、People 同步和单点登录',
    icon: 'i-lucide-message-circle',
    integrationCode: 'dingtalk.default',
    integrationName: 'Default DingTalk',
    category: 'notification',
    providerCode: 'dingtalk',
    baseUrl: 'https://api.dingtalk.com',
    defaultSecretCode: 'integration.dingtalk.default.app_secret',
    secretName: 'DingTalk default app secret',
    secretType: 'oauth_secret',
    defaultBackendRef: 'DINGTALK_APP_SECRET',
    defaultStorageBackend: 'db_encrypted',
    configFields: [
      { key: 'appKey', label: 'Client ID（原 AppKey）', placeholder: 'ding...', defaultValue: '' },
      { key: 'agentId', label: 'Agent ID（People 花名册）', placeholder: '如 2345185741', defaultValue: '' },
      { key: 'corpId', label: 'Corp ID', placeholder: 'ding...', defaultValue: '' }
    ]
  },
  dingtalk_identity: {
    type: 'dingtalk_identity',
    integrationType: 'dingtalk',
    title: '钉钉登录',
    description: '网页登录专用 OAuth Client ID 与 Client Secret',
    icon: 'i-lucide-log-in',
    integrationCode: 'dingtalk.identity',
    integrationName: 'DingTalk Identity',
    category: 'identity',
    providerCode: 'dingtalk',
    baseUrl: 'https://api.dingtalk.com',
    defaultSecretCode: 'integration.dingtalk.identity.client_secret',
    secretName: 'DingTalk identity client secret',
    secretType: 'oauth_secret',
    defaultBackendRef: 'DINGTALK_IDENTITY_CLIENT_SECRET',
    defaultStorageBackend: 'db_encrypted',
    configFields: [
      { key: 'oauthClientId', label: 'OAuth Client ID / AppKey', placeholder: '凭证与基础信息中的 ding...；不要填写 AgentId 或 UnifiedAppId', defaultValue: '' },
      { key: 'corpId', label: 'Corp ID', placeholder: 'ding...', defaultValue: '' }
    ]
  },
  oss: {
    type: 'oss',
    integrationType: 'oss',
    title: 'OSS / 存储',
    description: '阿里云 OSS endpoint、bucket 与 AK/SK',
    icon: 'i-lucide-database',
    integrationCode: 'oss.default',
    integrationName: 'Default OSS',
    category: 'storage',
    providerCode: 'aliyun_oss',
    baseUrl: '',
    defaultSecretCode: 'integration.oss.default.access_key_secret',
    secretName: 'OSS default access key secret',
    secretType: 'access_key_secret',
    defaultBackendRef: 'ALIYUN_OSS_ACCESS_KEY_SECRET',
    configFields: [
      { key: 'accessKeyId', label: 'Access Key ID', placeholder: 'LTAI...', defaultValue: '' },
      { key: 'bucketName', label: '默认 Bucket', placeholder: 'bucket-name', defaultValue: '' },
      { key: 'endpoint', label: '默认 Endpoint', placeholder: 'oss-cn-qingdao.aliyuncs.com', defaultValue: '' },
      { key: 'region', label: 'Region', placeholder: 'oss-cn-qingdao', defaultValue: '' },
      { key: 'bucketDomain', label: '默认 Bucket Domain', placeholder: 'cdn.example.com', defaultValue: '' },
      { key: 'projectsBucketName', label: '项目文档 Bucket', placeholder: '默认与 Bucket 相同', defaultValue: '' },
      { key: 'projectsEndpoint', label: '项目文档 Endpoint', placeholder: '默认与 Endpoint 相同', defaultValue: '' },
      { key: 'projectsBucketDomain', label: '项目文档 Bucket Domain', placeholder: '默认与 Bucket Domain 相同', defaultValue: '' },
      { key: 'imagesBucketName', label: '图片 Bucket', placeholder: '默认与 Bucket 相同', defaultValue: '' },
      { key: 'imagesEndpoint', label: '图片 Endpoint', placeholder: '默认与 Endpoint 相同', defaultValue: '' },
      { key: 'imagesBucketDomain', label: '图片 Bucket Domain', placeholder: '公共读或 CDN 域名', defaultValue: '' },
      { key: 'recycleDays', label: '回收站保留天数', type: 'number', placeholder: '30', defaultValue: 30 }
    ]
  }
}

const integrationTypes = Object.keys(definitions) as IntegrationType[]
const visibleIntegrationTypes = integrationTypes.filter(type => type !== 'dingtalk_identity')
const toast = useToast()
const selectedType = ref<IntegrationType>('gitlab')
const dingtalkLoginMode = ref<DingTalkLoginMode>('shared')
const saving = ref(false)
const savingDingTalkLoginMode = ref(false)
const rotating = ref(false)
const checking = ref(false)
const dingtalkTestAccount = ref('')
const dingtalkSending = ref(false)
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()

if (!permissionsLoaded.value) {
  await loadPermissions()
}

const canEditIntegrations = computed(() => permissionsLoaded.value && hasPermission('integration_config', 'edit'))
const canEditVault = computed(() => permissionsLoaded.value && hasPermission('credential_vault', 'edit'))

function createForm(definition: IntegrationDefinition): IntegrationForm {
  return {
    integrationCode: definition.integrationCode,
    integrationName: definition.integrationName,
    baseUrl: definition.baseUrl,
    status: 'active',
    secretCode: definition.defaultSecretCode,
    storageBackend: definition.defaultStorageBackend || 'env_ref',
    secretMaterial: '',
    bindVersionNo: '',
    config: Object.fromEntries(definition.configFields.map(field => [field.key, field.defaultValue]))
  }
}

const forms = reactive<Record<IntegrationType, IntegrationForm>>({
  gitlab: createForm(definitions.gitlab),
  ai_provider: createForm(definitions.ai_provider),
  wecom: createForm(definitions.wecom),
  dingtalk: createForm(definitions.dingtalk),
  dingtalk_identity: createForm(definitions.dingtalk_identity),
  oss: createForm(definitions.oss)
})

const { data: integrationData, pending: _pending, refresh: refreshIntegrations } = await useFetch<ApiResponse<{ items: IntegrationItem[] }>>(
  '/api/v1/console/integrations',
  {
    default: () => ({ code: 0, data: { items: [] } })
  }
)

const { data: secretData, refresh: refreshSecrets } = await useFetch<ApiResponse<{ items: VaultSecret[] }>>(
  '/api/v1/console/vault/secrets',
  {
    query: { usageType: 'integration' },
    default: () => ({ code: 0, data: { items: [] } })
  }
)

const integrations = computed(() => integrationData.value?.data.items || [])
const integrationSecrets = computed(() => secretData.value?.data.items || [])
const selectedDefinition = computed(() => definitions[selectedType.value])
const activeForm = computed(() => forms[selectedType.value])
const selectedIntegration = computed(() => {
  const form = activeForm.value
  return integrations.value.find(item => item.integrationCode === form.integrationCode)
    || null
})
const selectedSecret = computed(() => integrationSecrets.value.find(item => item.secretCode === activeForm.value.secretCode) || null)
const isDingTalkGroup = computed(() => selectedType.value === 'dingtalk' || selectedType.value === 'dingtalk_identity')
const isSharedDingTalkLogin = computed(() => selectedType.value === 'dingtalk_identity' && dingtalkLoginMode.value === 'shared')

watch(selectedType, (type) => {
  applyIntegrationToForm(type, selectedIntegration.value)
}, { immediate: true })

watch(integrations, () => {
  for (const type of integrationTypes) {
    const integration = integrations.value.find(item => item.integrationCode === forms[type].integrationCode)
      || null
    applyIntegrationToForm(type, integration)
  }
  dingtalkLoginMode.value = integrationForType('dingtalk_identity')?.status === 'active'
    ? 'independent'
    : 'shared'
}, { immediate: true })

watch(selectedSecret, (secret) => {
  if (!secret) return
  activeForm.value.storageBackend = secret.storageBackend as StorageBackend
  if (!activeForm.value.bindVersionNo && secret.currentVersionNo) {
    activeForm.value.bindVersionNo = String(secret.currentVersionNo)
  }
}, { immediate: true })

function applyIntegrationToForm(type: IntegrationType, integration: IntegrationItem | null) {
  if (!integration) return
  const form = forms[type]
  form.integrationCode = integration.integrationCode
  form.integrationName = integration.integrationName
  form.baseUrl = integration.baseUrl || ''
  form.status = integration.status === 'inactive' ? 'inactive' : 'active'
  for (const field of definitions[type].configFields) {
    const value = integration.config?.[field.key]
    form.config[field.key] = value === undefined || value === null ? field.defaultValue : String(value)
  }
  if (integration.currentCredential?.secretCode) {
    form.secretCode = integration.currentCredential.secretCode
    form.bindVersionNo = integration.currentCredential.versionNo ? String(integration.currentCredential.versionNo) : ''
  }
}

function integrationForType(type: IntegrationType) {
  const definition = definitions[type]
  return integrations.value.find(item => item.integrationCode === definition.integrationCode)
    || null
}

const displayedIntegration = computed(() => isSharedDingTalkLogin.value
  ? integrationForType('dingtalk')
  : selectedIntegration.value)

const displayedSecret = computed(() => {
  if (!isSharedDingTalkLogin.value) {
    return selectedSecret.value
  }
  const secretCode = displayedIntegration.value?.currentCredential?.secretCode
  return secretCode
    ? integrationSecrets.value.find(item => item.secretCode === secretCode) || null
    : null
})

const sharedDingTalkClientId = computed(() => String(integrationForType('dingtalk')?.config?.appKey || '').trim())

function integrationCardSelected(type: IntegrationType) {
  return selectedType.value === type
    || (type === 'dingtalk' && selectedType.value === 'dingtalk_identity')
}

function setDingTalkLoginMode(mode: DingTalkLoginMode) {
  dingtalkLoginMode.value = mode
  if (mode === 'independent') {
    forms.dingtalk_identity.status = 'active'
  }
}

function cardStatus(type: IntegrationType) {
  const integration = integrationForType(type)
  if (!integration) return { label: '未配置', color: 'warning' as const }
  if (integration.status === 'active') return { label: '已启用', color: 'success' as const }
  return { label: '已停用', color: 'neutral' as const }
}

function connectivityBadge(status: string | undefined) {
  if (status === 'healthy') return { label: '正常', color: 'success' as const }
  if (status === 'failed') return { label: '异常', color: 'error' as const }
  return { label: '未检查', color: 'neutral' as const }
}

function currentCredentialLabel() {
  const credential = displayedIntegration.value?.currentCredential
  if (!credential) return '未绑定'
  const version = credential.versionNo ? `v${credential.versionNo}` : 'current'
  return `${credential.secretCode}@${version}`
}

function errorMessage(error: unknown) {
  const normalized = error as { data?: { message?: string }, message?: string }
  return normalized.data?.message || normalized.message || String(error)
}

function versionNoValue() {
  const parsed = Number(activeForm.value.bindVersionNo)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function normalizeDingTalkDefaultConfig(config: Record<string, unknown>) {
  const payload = { ...config }
  const appKey = String(payload.appKey || '').trim()
  const oauthClientId = String(payload.oauthClientId || '').trim()
  const robotCode = String(payload.robotCode || '').trim()
  // dingtalk.default no longer exposes derived duplicate inputs. A distinct
  // historical OAuth client remains available as a login compatibility fallback.
  if (!oauthClientId || /^\d+$/.test(oauthClientId) || oauthClientId === appKey) {
    delete payload.oauthClientId
  }
  if (!robotCode || robotCode === appKey) {
    delete payload.robotCode
  }
  return payload
}

function configPayload() {
  // Keep non-UI compatibility options (for example rootDeptId or a genuinely
  // distinct legacy login client) when an administrator edits visible fields.
  const payload: Record<string, unknown> = { ...(selectedIntegration.value?.config || {}) }
  for (const field of selectedDefinition.value.configFields) {
    const value = activeForm.value.config[field.key]
    payload[field.key] = field.type === 'number' ? Number(value || 0) : String(value ?? '').trim()
  }
  return selectedType.value === 'dingtalk'
    ? normalizeDingTalkDefaultConfig(payload)
    : payload
}

function updateConfigField(key: string, value: unknown, type: FieldType = 'text') {
  activeForm.value.config[key] = type === 'number' ? Number(value || 0) : String(value ?? '')
}

function isEnvSecretRef(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())
}

const secretMaterialWarning = computed(() => {
  const material = activeForm.value.secretMaterial.trim()
  if (activeForm.value.storageBackend !== 'env_ref' || !material || isEnvSecretRef(material)) {
    return ''
  }
  return '当前 Secret Backend 是环境变量，Secret Material 必须填写环境变量名；如要直接保存 corpsecret，请切换为数据库加密。'
})

function secretMaterialBody(value: string) {
  if (activeForm.value.storageBackend === 'env_ref' && !isEnvSecretRef(value)) {
    throw new Error('当前 Secret Backend 是环境变量，请选择“数据库加密”后再输入真实 secret。')
  }
  if (activeForm.value.storageBackend === 'db_encrypted') {
    return { plaintext: value }
  }
  return { backendSecretRef: value }
}

async function refreshAll() {
  await Promise.all([refreshIntegrations(), refreshSecrets()])
}

async function ensureSecretVersion() {
  const material = activeForm.value.secretMaterial.trim()
  if (!material) {
    if (!selectedSecret.value && !selectedIntegration.value) {
      throw new Error('首次创建集成需要填写 Secret Material / Backend Ref')
    }
    return versionNoValue()
  }

  if (!canEditVault.value) {
    throw new Error('需要凭证库编辑权限才能创建或轮换 secret')
  }

  if (!selectedSecret.value) {
    const response = await $fetch<ApiResponse<{ currentVersionNo: number }>>('/api/v1/console/vault/secrets', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        secretCode: activeForm.value.secretCode,
        secretName: selectedDefinition.value.secretName,
        secretType: selectedDefinition.value.secretType,
        usageType: 'integration',
        ownerType: 'integration',
        ownerKey: activeForm.value.integrationCode,
        storageBackend: activeForm.value.storageBackend,
        revealPolicy: 'approval',
        material: secretMaterialBody(material)
      }
    })
    return response.data.currentVersionNo
  }

  const response = await $fetch<ApiResponse<{ versionNo: number }>>(
    `/api/v1/console/vault/secrets/${encodeURIComponent(activeForm.value.secretCode)}/rotate`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        storageBackend: activeForm.value.storageBackend,
        material: secretMaterialBody(material)
      }
    }
  )
  return response.data.versionNo
}

async function saveIntegration() {
  if (!canEditIntegrations.value) {
    toast.add({ title: '权限不足', description: '需要集成配置编辑权限。', color: 'warning' })
    return
  }

  saving.value = true
  try {
    const versionNo = await ensureSecretVersion()
    const form = activeForm.value
    const definition = selectedDefinition.value
    const body = {
      integrationCode: form.integrationCode,
      integrationType: definition.integrationType,
      integrationName: form.integrationName,
      category: definition.category,
      providerCode: definition.providerCode,
      baseUrl: form.baseUrl || null,
      status: form.status,
      config: configPayload()
    }

    if (selectedIntegration.value) {
      const {
        integrationCode: _integrationCode,
        integrationType: _integrationType,
        ...updateBody
      } = body
      await $fetch<ApiResponse<IntegrationItem>>(
        `/api/v1/console/integrations/${encodeURIComponent(form.integrationCode)}`,
        {
          method: 'PATCH',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: updateBody
        }
      )

      const current = selectedIntegration.value.currentCredential
      const shouldRotate = Boolean(form.secretCode)
        && (Boolean(form.secretMaterial.trim())
          || form.secretCode !== current?.secretCode
          || (Boolean(versionNo) && versionNo !== current?.versionNo))
      if (shouldRotate) {
        await rotateCredential(versionNo, false)
      }
    } else {
      await $fetch<ApiResponse<IntegrationItem>>('/api/v1/console/integrations', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          ...body,
          credential: form.secretCode
            ? {
                secretCode: form.secretCode,
                versionNo
              }
            : null
        }
      })
    }

    form.secretMaterial = ''
    toast.add({ title: `${definition.title} 集成已保存`, color: 'success' })
    await refreshAll()
  } catch (error) {
    toast.add({ title: '保存失败', description: errorMessage(error), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function saveSharedDingTalkLogin() {
  if (!canEditIntegrations.value) {
    toast.add({ title: '权限不足', description: '需要集成配置编辑权限。', color: 'warning' })
    return
  }
  const defaultIntegration = integrationForType('dingtalk')
  if (!defaultIntegration || defaultIntegration.status !== 'active' || !defaultIntegration.currentCredential) {
    toast.add({
      title: '请先启用钉钉应用',
      description: '复用登录要求“通知与 People”配置已启用并绑定有效凭证。',
      color: 'warning'
    })
    return
  }

  savingDingTalkLoginMode.value = true
  try {
    // Normalize the shared application before disabling the override so login
    // never observes a numeric legacy oauthClientId during the transition.
    const sharedConfig = normalizeDingTalkDefaultConfig(defaultIntegration.config)
    delete sharedConfig.oauthClientId
    await $fetch<ApiResponse<IntegrationItem>>(
      `/api/v1/console/integrations/${encodeURIComponent(defaultIntegration.integrationCode)}`,
      {
        method: 'PATCH',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { config: sharedConfig }
      }
    )

    const identityIntegration = integrationForType('dingtalk_identity')
    if (identityIntegration?.status === 'active') {
      await $fetch<ApiResponse<IntegrationItem>>(
        `/api/v1/console/integrations/${encodeURIComponent(identityIntegration.integrationCode)}`,
        {
          method: 'PATCH',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: { status: 'inactive' }
        }
      )
    }

    toast.add({
      title: '钉钉登录已复用当前应用',
      description: '登录、通知和 People 使用同一套 Client ID 与 Client Secret。',
      color: 'success'
    })
    await refreshAll()
  } catch (error) {
    toast.add({ title: '登录模式保存失败', description: errorMessage(error), color: 'error' })
  } finally {
    savingDingTalkLoginMode.value = false
  }
}

async function rotateCredential(versionNo = versionNoValue(), showToast = true) {
  if (!canEditIntegrations.value) {
    toast.add({ title: '权限不足', description: '需要集成配置编辑权限。', color: 'warning' })
    return
  }
  if (!selectedIntegration.value) {
    toast.add({ title: '请先保存集成', color: 'warning' })
    return
  }
  if (!activeForm.value.secretCode) {
    toast.add({ title: '缺少 Secret Code', color: 'warning' })
    return
  }

  rotating.value = true
  try {
    await $fetch<ApiResponse<IntegrationItem>>(
      `/api/v1/console/integrations/${encodeURIComponent(activeForm.value.integrationCode)}/rotate`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: {
          secretCode: activeForm.value.secretCode,
          versionNo
        }
      }
    )
    if (showToast) {
      toast.add({ title: '凭证绑定已更新', color: 'success' })
    }
    await refreshAll()
  } catch (error) {
    toast.add({ title: '绑定失败', description: errorMessage(error), color: 'error' })
  } finally {
    rotating.value = false
  }
}

async function checkIntegration() {
  if (!canEditIntegrations.value) {
    toast.add({ title: '权限不足', description: '需要集成配置编辑权限。', color: 'warning' })
    return
  }
  if (!selectedIntegration.value) {
    toast.add({ title: '请先保存集成', color: 'warning' })
    return
  }

  checking.value = true
  try {
    const response = await $fetch<ApiResponse<{ status: string, errorMessage: string | null }>>(
      `/api/v1/console/integrations/${encodeURIComponent(activeForm.value.integrationCode)}/check`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() }
      }
    )
    toast.add({
      title: response.data.status === 'healthy' ? '检查通过' : '检查失败',
      description: response.data.errorMessage || undefined,
      color: response.data.status === 'healthy' ? 'success' : 'error'
    })
    await refreshIntegrations()
  } catch (error) {
    toast.add({ title: '检查失败', description: errorMessage(error), color: 'error' })
  } finally {
    checking.value = false
  }
}

async function sendDingTalkTest() {
  const touser = dingtalkTestAccount.value.trim()
  if (!touser) {
    toast.add({ title: '请输入钉钉用户标识', color: 'warning' })
    return
  }
  if (!canEditIntegrations.value || !selectedIntegration.value || selectedType.value !== 'dingtalk') {
    toast.add({ title: '请先保存钉钉集成并确认编辑权限', color: 'warning' })
    return
  }

  dingtalkSending.value = true
  try {
    const response = await $fetch<ApiResponse<DingTalkTestResult>>('/api/v1/console/connector-runtime/dingtalk-test', {
      method: 'POST',
      body: {
        integrationCode: 'dingtalk.default',
        touser,
        requestKey: globalThis.crypto.randomUUID()
      }
    })
    if (!response.data.replayVerified) {
      throw new Error('Enterprise Connector Runtime 未返回幂等重放证据')
    }
    toast.add({
      title: '钉钉测试消息已发送',
      description: `已发送至 ${response.data.touser}，幂等重放已验证`,
      color: 'success'
    })
    await refreshIntegrations()
  } catch (error) {
    toast.add({ title: '发送失败', description: errorMessage(error), color: 'error' })
    await refreshIntegrations().catch(() => undefined)
  } finally {
    dingtalkSending.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="integrations" :ui="dashboardPanelUi">
    <template #body>
      <div class="space-y-4">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <UCard
            v-for="type in visibleIntegrationTypes"
            :key="type"
            class="cursor-pointer border transition hover:border-primary hover:shadow-sm"
            :class="integrationCardSelected(type) ? 'border-primary bg-primary/5 shadow-md ring-2 ring-primary/25' : 'border-default'"
            @click="selectedType = type"
          >
            <div class="flex items-start justify-between gap-3">
              <UIcon
                :name="definitions[type].icon"
                class="mt-1 size-6"
                :class="integrationCardSelected(type) ? 'text-primary' : 'text-muted'"
              />
              <div class="w-full">
                <p class="w-full font-semibold justify-between flex items-center">
                  {{ definitions[type].title }}<UBadge :color="cardStatus(type).color" variant="soft">
                    {{ cardStatus(type).label }}
                  </UBadge>
                </p>
                <p class="text-sm text-muted w-full">
                  {{ definitions[type].description }}
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <div
          v-if="isDingTalkGroup"
          class="grid gap-2 rounded-lg border border-default bg-muted/30 p-2 sm:grid-cols-2"
          role="tablist"
          aria-label="钉钉集成配置"
        >
          <UButton
            block
            icon="i-lucide-bell-ring"
            :color="selectedType === 'dingtalk' ? 'primary' : 'neutral'"
            :variant="selectedType === 'dingtalk' ? 'soft' : 'ghost'"
            :aria-selected="selectedType === 'dingtalk'"
            role="tab"
            @click="selectedType = 'dingtalk'"
          >
            通知与 People
          </UButton>
          <UButton
            block
            icon="i-lucide-log-in"
            :color="selectedType === 'dingtalk_identity' ? 'primary' : 'neutral'"
            :variant="selectedType === 'dingtalk_identity' ? 'soft' : 'ghost'"
            :aria-selected="selectedType === 'dingtalk_identity'"
            role="tab"
            @click="selectedType = 'dingtalk_identity'"
          >
            登录
          </UButton>
        </div>

        <UCard>
          <template #header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="font-semibold">
                  {{ selectedDefinition.title }} 集成
                </h2>
                <p class="text-sm text-muted">
                  <template v-if="isSharedDingTalkLogin">
                    登录复用 `dingtalk.default` 的 Client ID 与 vault secret。
                  </template>
                  <template v-else>
                    维护 `{{ selectedDefinition.integrationCode }}` 的非密配置和 vault secret 绑定。
                  </template>
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <UBadge :color="connectivityBadge(displayedIntegration?.connectivityStatus).color" variant="soft">
                  {{ connectivityBadge(displayedIntegration?.connectivityStatus).label }}
                </UBadge>
                <UBadge color="neutral" variant="subtle">
                  {{ currentCredentialLabel() }}
                </UBadge>
              </div>
            </div>
          </template>

          <div
            v-if="selectedType === 'dingtalk_identity'"
            class="mb-4 space-y-4"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <UButton
                block
                icon="i-lucide-link"
                :color="dingtalkLoginMode === 'shared' ? 'primary' : 'neutral'"
                :variant="dingtalkLoginMode === 'shared' ? 'soft' : 'outline'"
                :aria-pressed="dingtalkLoginMode === 'shared'"
                :disabled="!canEditIntegrations"
                @click="setDingTalkLoginMode('shared')"
              >
                复用当前钉钉应用
              </UButton>
              <UButton
                block
                icon="i-lucide-key-round"
                :color="dingtalkLoginMode === 'independent' ? 'primary' : 'neutral'"
                :variant="dingtalkLoginMode === 'independent' ? 'soft' : 'outline'"
                :aria-pressed="dingtalkLoginMode === 'independent'"
                :disabled="!canEditIntegrations"
                @click="setDingTalkLoginMode('independent')"
              >
                使用独立登录应用
              </UButton>
            </div>

            <UAlert
              v-if="dingtalkLoginMode === 'shared'"
              :color="integrationForType('dingtalk')?.status === 'active' ? 'success' : 'warning'"
              variant="soft"
              icon="i-lucide-badge-check"
              title="登录复用通知与 People 应用"
              :description="sharedDingTalkClientId
                ? `OAuth 登录将使用 ${sharedDingTalkClientId} 及其当前 Client Secret，无需重复维护凭证。`
                : '请先在“通知与 People”页签完成 Client ID 和 Client Secret 配置。'"
            />
            <UAlert
              v-else
              color="info"
              variant="soft"
              icon="i-lucide-shield-check"
              title="独立登录应用"
              description="仅在登录回调、权限或发布生命周期需要隔离时使用。OAuth Client ID 应为 ding... 开头的 Client ID / AppKey，不要填写数字 AgentId。"
            />
          </div>

          <div
            v-if="!isSharedDingTalkLogin"
            class="grid gap-4 lg:grid-cols-2"
          >
            <UFormField label="Integration Code">
              <UInput
                v-model="activeForm.integrationCode"
                class="w-full"
                :disabled="Boolean(selectedIntegration) || !canEditIntegrations"
              />
            </UFormField>
            <UFormField label="名称">
              <UInput
                v-model="activeForm.integrationName"
                class="w-full"
                :disabled="!canEditIntegrations"
              />
            </UFormField>
            <UFormField label="Base URL">
              <UInput
                v-model="activeForm.baseUrl"
                class="w-full"
                :placeholder="selectedDefinition.baseUrl || '可留空'"
                :disabled="!canEditIntegrations"
              />
            </UFormField>
            <UFormField
              v-if="selectedType !== 'dingtalk_identity'"
              label="状态"
            >
              <USelect
                v-model="activeForm.status"
                :items="[
                  { label: '启用', value: 'active' },
                  { label: '停用', value: 'inactive' }
                ]"
                class="w-full"
                :disabled="!canEditIntegrations"
              />
            </UFormField>

            <UFormField
              v-for="field in selectedDefinition.configFields"
              :key="`${selectedType}-${field.key}`"
              :label="field.label"
            >
              <UInput
                :model-value="String(activeForm.config[field.key] ?? '')"
                :type="field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'"
                class="w-full"
                :placeholder="field.placeholder"
                :disabled="!canEditIntegrations"
                @update:model-value="value => updateConfigField(field.key, value, field.type)"
              />
            </UFormField>

            <UAlert
              v-if="selectedType === 'dingtalk'"
              class="lg:col-span-2"
              color="info"
              variant="soft"
              icon="i-lucide-key-round"
              title="同一应用覆盖通知与 People"
              description="Robot Code 默认使用 Client ID。网页登录默认也可复用这套凭证；只有需要隔离时，才在“登录”页签选择独立应用。钉钉后台修改回调后仍需重新发布应用版本。"
            />

            <UFormField label="Secret Code">
              <UInput
                v-model="activeForm.secretCode"
                class="w-full"
                :disabled="!canEditIntegrations"
              />
            </UFormField>
            <UFormField label="Secret Backend">
              <USelect
                v-model="activeForm.storageBackend"
                :items="[
                  { label: '环境变量', value: 'env_ref' },
                  { label: 'Docker Secret', value: 'docker_secret' },
                  { label: 'Kubernetes Secret', value: 'k8s_secret' },
                  { label: '数据库加密', value: 'db_encrypted' }
                ]"
                class="w-full"
                :disabled="!canEditVault"
              />
            </UFormField>
            <UFormField label="绑定版本">
              <UInput
                v-model="activeForm.bindVersionNo"
                type="number"
                class="w-full"
                placeholder="留空使用当前版本"
                :disabled="!canEditIntegrations"
              />
            </UFormField>
            <UFormField label="Secret Material / Backend Ref" class="lg:col-span-2">
              <UInput
                v-model="activeForm.secretMaterial"
                class="w-full"
                :placeholder="activeForm.storageBackend === 'db_encrypted' ? '输入明文，保存后加密入库' : selectedDefinition.defaultBackendRef"
                :disabled="!canEditVault"
              />
              <p
                v-if="secretMaterialWarning"
                class="mt-1 text-sm text-warning"
              >
                {{ secretMaterialWarning }}
              </p>
            </UFormField>
          </div>

          <div class="mt-4 grid gap-3 rounded-lg border border-default bg-muted/30 p-4 text-sm md:grid-cols-3">
            <div>
              <div class="text-muted">
                当前 Secret
              </div>
              <div class="mt-1 font-mono text-xs text-highlighted">
                {{ displayedSecret?.secretRef || '未找到' }}
              </div>
            </div>
            <div>
              <div class="text-muted">
                当前版本
              </div>
              <div class="mt-1 text-highlighted">
                {{ displayedSecret?.currentVersionNo ? `v${displayedSecret.currentVersionNo}` : '-' }}
              </div>
            </div>
            <div>
              <div class="text-muted">
                最近检查
              </div>
              <div class="mt-1 text-highlighted">
                {{ displayedIntegration?.lastCheckedAt || '-' }}
              </div>
            </div>
          </div>

          <UAlert
            v-if="displayedIntegration?.lastErrorMessage"
            class="mt-4"
            color="error"
            variant="soft"
            title="最近检查失败"
            :description="displayedIntegration.lastErrorMessage"
          />

          <div
            v-if="selectedType === 'dingtalk'"
            class="mt-4 rounded-lg border border-default bg-muted/30 p-4"
          >
            <div class="mb-3">
              <h3 class="text-sm font-semibold text-highlighted">
                Enterprise Connector Runtime 通知验收
              </h3>
              <p class="mt-1 text-xs text-muted">
                向钉钉用户发送一条真实测试消息，并使用相同幂等键重放；只有运行时明确确认未重复投递才判定成功。
              </p>
            </div>
            <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <UFormField label="钉钉用户标识 / User ID">
                <UInput
                  v-model="dingtalkTestAccount"
                  icon="i-lucide-user"
                  class="w-full"
                  placeholder="输入测试接收人的钉钉 User ID"
                  :disabled="dingtalkSending || !canEditIntegrations || !selectedIntegration"
                  @keyup.enter="sendDingTalkTest"
                />
              </UFormField>
              <UButton
                icon="i-lucide-send"
                :loading="dingtalkSending"
                :disabled="!dingtalkTestAccount.trim() || !canEditIntegrations || !selectedIntegration"
                @click="sendDingTalkTest"
              >
                发送并验证重放
              </UButton>
            </div>
          </div>

          <template #footer>
            <div
              v-if="isSharedDingTalkLogin"
              class="flex flex-wrap justify-end gap-2"
            >
              <UButton
                icon="i-lucide-save"
                :loading="savingDingTalkLoginMode"
                :disabled="!canEditIntegrations
                  || integrationForType('dingtalk')?.status !== 'active'
                  || !integrationForType('dingtalk')?.currentCredential"
                @click="saveSharedDingTalkLogin"
              >
                保存登录模式
              </UButton>
            </div>
            <div v-else class="flex flex-wrap justify-end gap-2">
              <UButton
                icon="i-lucide-shield-check"
                color="neutral"
                variant="subtle"
                :loading="checking"
                :disabled="!selectedIntegration || !canEditIntegrations"
                @click="checkIntegration"
              >
                检查
              </UButton>
              <UButton
                icon="i-lucide-rotate-cw"
                color="neutral"
                variant="subtle"
                :loading="rotating"
                :disabled="!selectedIntegration || !canEditIntegrations"
                @click="rotateCredential()"
              >
                绑定版本
              </UButton>
              <UButton
                icon="i-lucide-save"
                :loading="saving"
                :disabled="!canEditIntegrations"
                @click="saveIntegration"
              >
                保存配置
              </UButton>
            </div>
          </template>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
