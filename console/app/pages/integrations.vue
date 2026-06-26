<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('集成中心')

type IntegrationType = 'gitlab' | 'ai_provider' | 'wecom' | 'oss'
type StorageBackend = 'env_ref' | 'docker_secret' | 'k8s_secret' | 'db_encrypted'
type FieldType = 'text' | 'url' | 'number'

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

type IntegrationDefinition = {
  type: IntegrationType
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
    configFields: [
      { key: 'corpid', label: 'Corp ID', placeholder: 'ww...', defaultValue: '' },
      { key: 'agentid', label: 'Agent ID', placeholder: '1000001', defaultValue: '' }
    ]
  },
  oss: {
    type: 'oss',
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
const toast = useToast()
const selectedType = ref<IntegrationType>('gitlab')
const saving = ref(false)
const rotating = ref(false)
const checking = ref(false)
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
    storageBackend: 'env_ref',
    secretMaterial: '',
    bindVersionNo: '',
    config: Object.fromEntries(definition.configFields.map(field => [field.key, field.defaultValue]))
  }
}

const forms = reactive<Record<IntegrationType, IntegrationForm>>({
  gitlab: createForm(definitions.gitlab),
  ai_provider: createForm(definitions.ai_provider),
  wecom: createForm(definitions.wecom),
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
    || integrations.value.find(item => item.integrationType === selectedType.value)
    || null
})
const selectedSecret = computed(() => integrationSecrets.value.find(item => item.secretCode === activeForm.value.secretCode) || null)

watch(selectedType, (type) => {
  applyIntegrationToForm(type, selectedIntegration.value)
}, { immediate: true })

watch(integrations, () => {
  for (const type of integrationTypes) {
    const integration = integrations.value.find(item => item.integrationCode === forms[type].integrationCode)
      || integrations.value.find(item => item.integrationType === type)
      || null
    applyIntegrationToForm(type, integration)
  }
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
    || integrations.value.find(item => item.integrationType === type)
    || null
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
  const credential = selectedIntegration.value?.currentCredential
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

function configPayload() {
  const payload: Record<string, unknown> = {}
  for (const field of selectedDefinition.value.configFields) {
    const value = activeForm.value.config[field.key]
    payload[field.key] = field.type === 'number' ? Number(value || 0) : String(value ?? '').trim()
  }
  return payload
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
      integrationType: definition.type,
      integrationName: form.integrationName,
      category: definition.category,
      providerCode: definition.providerCode,
      baseUrl: form.baseUrl || null,
      status: form.status,
      config: configPayload()
    }

    if (selectedIntegration.value) {
      await $fetch<ApiResponse<IntegrationItem>>(
        `/api/v1/console/integrations/${encodeURIComponent(form.integrationCode)}`,
        {
          method: 'PATCH',
          body
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
      { method: 'POST' }
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
</script>

<template>
  <UDashboardPanel id="integrations" :ui="dashboardPanelUi">
    <template #body>
      <div class="space-y-4">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <UCard
            v-for="type in integrationTypes"
            :key="type"
            class="cursor-pointer border transition hover:border-primary hover:shadow-sm"
            :class="selectedType === type ? 'border-primary bg-primary/5 shadow-md ring-2 ring-primary/25' : 'border-default'"
            @click="selectedType = type"
          >
            <div class="flex items-start justify-between gap-3">
              <UIcon
                :name="definitions[type].icon"
                class="mt-1 size-6"
                :class="selectedType === type ? 'text-primary' : 'text-muted'"
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

        <UCard>
          <template #header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 class="font-semibold">
                  {{ selectedDefinition.title }} 默认集成
                </h2>
                <p class="text-sm text-muted">
                  维护 `{{ selectedDefinition.integrationCode }}` 的非密配置和 vault secret 绑定。
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <UBadge :color="connectivityBadge(selectedIntegration?.connectivityStatus).color" variant="soft">
                  {{ connectivityBadge(selectedIntegration?.connectivityStatus).label }}
                </UBadge>
                <UBadge color="neutral" variant="subtle">
                  {{ currentCredentialLabel() }}
                </UBadge>
              </div>
            </div>
          </template>

          <div class="grid gap-4 lg:grid-cols-2">
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
            <UFormField label="状态">
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
                {{ selectedSecret?.secretRef || '未找到' }}
              </div>
            </div>
            <div>
              <div class="text-muted">
                当前版本
              </div>
              <div class="mt-1 text-highlighted">
                {{ selectedSecret?.currentVersionNo ? `v${selectedSecret.currentVersionNo}` : '-' }}
              </div>
            </div>
            <div>
              <div class="text-muted">
                最近检查
              </div>
              <div class="mt-1 text-highlighted">
                {{ selectedIntegration?.lastCheckedAt || '-' }}
              </div>
            </div>
          </div>

          <UAlert
            v-if="selectedIntegration?.lastErrorMessage"
            class="mt-4"
            color="error"
            variant="soft"
            title="最近检查失败"
            :description="selectedIntegration.lastErrorMessage"
          />

          <template #footer>
            <div class="flex flex-wrap justify-end gap-2">
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
