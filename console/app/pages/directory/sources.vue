<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('目录源配置')

type ProviderCode = 'ldap' | 'wecom' | 'dingtalk'
type StorageBackend = 'db_encrypted' | 'env_ref' | 'docker_secret' | 'k8s_secret'

interface DirectorySource {
  providerCode: ProviderCode
  integrationCode: string
  integrationName: string
  baseUrl: string | null
  config: Record<string, unknown>
  status: string
  connectivityStatus: string
  lastCheckedAt: string | null
  lastErrorMessage: string | null
  credential: {
    secretCode: string
    secretRef: string
    storageBackend: string
    backendSecretRefMasked: string | null
    status: string
  } | null
  updatedAt: string
}

interface ApiResponse<T> {
  code: number
  data: T
}

const providerDefs: Array<{ code: ProviderCode, name: string, description: string, icon: string }> = [
  { code: 'ldap', name: 'LDAP', description: '企业 LDAP / AD 目录源', icon: 'i-lucide-network' },
  { code: 'wecom', name: '企业微信', description: '企业微信通讯录同步', icon: 'i-simple-icons-wechat' },
  { code: 'dingtalk', name: '钉钉', description: '钉钉通讯录同步', icon: 'i-lucide-message-circle' }
]

const toast = useToast()
const savingProvider = ref<ProviderCode | null>(null)
const testingLdap = ref(false)
const ldapTestFeedback = ref<{
  status: 'info' | 'success' | 'error' | 'warning'
  title: string
  description: string
} | null>(null)
const activeProvider = ref<ProviderCode>('ldap')
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()

if (!permissionsLoaded.value) {
  await loadPermissions()
}

const canEditSources = computed(() => permissionsLoaded.value && hasPermission('directory_sources', 'edit'))

const { data, refresh } = await useFetch<ApiResponse<DirectorySource[]>>('/api/v1/console/directory/sources', {
  default: () => ({ code: 0, data: [] })
})

const sourcesByProvider = computed(() => new Map((data.value?.data || []).map(source => [source.providerCode, source])))

const forms = reactive<Record<ProviderCode, {
  integrationName: string
  baseUrl: string
  status: 'active' | 'inactive'
  storageBackend: StorageBackend
  secretCode: string
  backendSecretRef: string
  config: Record<string, string | boolean | number>
}>>({
  ldap: {
    integrationName: 'LDAP 目录源',
    baseUrl: '',
    status: 'active',
    storageBackend: 'db_encrypted',
    secretCode: 'directory.ldap.bind_password',
    backendSecretRef: '',
    config: {
      managementMode: 'readonly',
      directoryType: 'openldap',
      host: '',
      port: 636,
      transport: 'ldaps',
      bindDN: '',
      baseDN: '',
      userBase: '',
      userFilter: '(objectClass=inetOrgPerson)',
      userDnTemplate: '',
      userPrincipalNameSuffix: '',
      serverName: '',
      caPem: '',
      syncIntervalSeconds: 300,
      pageSize: 500,
      useTLS: true
    }
  },
  wecom: {
    integrationName: '企业微信通讯录',
    baseUrl: 'https://qyapi.weixin.qq.com',
    status: 'active',
    storageBackend: 'env_ref',
    secretCode: 'directory.wecom.contact_secret',
    backendSecretRef: 'WECOM_CONTACT_SECRET',
    config: {
      corpId: '',
      agentId: '',
      syncDepartmentId: 1
    }
  },
  dingtalk: {
    integrationName: '钉钉通讯录',
    baseUrl: 'https://api.dingtalk.com',
    status: 'active',
    storageBackend: 'env_ref',
    secretCode: 'directory.dingtalk.app_secret',
    backendSecretRef: 'DINGTALK_APP_SECRET',
    config: {
      appId: '',
      rootDeptId: 1
    }
  }
})

function ldapStringField(key: string) {
  return computed({
    get: () => String(forms.ldap.config[key] || ''),
    set: (value) => { forms.ldap.config[key] = value }
  })
}

const ldapManagementMode = ldapStringField('managementMode')
const ldapDirectoryType = ldapStringField('directoryType')
const ldapTransport = ldapStringField('transport')
const ldapCaPem = ldapStringField('caPem')

watch(data, () => {
  for (const source of data.value?.data || []) {
    const provider = source.providerCode
    forms[provider].integrationName = source.integrationName
    forms[provider].baseUrl = source.baseUrl || ''
    forms[provider].status = source.status === 'inactive' ? 'inactive' : 'active'
    forms[provider].config = {
      ...forms[provider].config,
      ...source.config
    } as Record<string, string | boolean | number>
    if (source.credential) {
      forms[provider].secretCode = source.credential.secretCode
      forms[provider].storageBackend = source.credential.storageBackend as StorageBackend
      forms[provider].backendSecretRef = ''
    }
  }
}, { immediate: true })

function sourceStatus(provider: ProviderCode) {
  const source = sourcesByProvider.value.get(provider)
  if (!source) return { label: '未配置', color: 'neutral' as const }
  if (source.status === 'active') return { label: '已启用', color: 'success' as const }
  return { label: '已停用', color: 'warning' as const }
}

function credentialSummary(provider: ProviderCode) {
  const credential = sourcesByProvider.value.get(provider)?.credential
  if (!credential) return '未绑定 secret'
  return `${credential.secretRef} (${credential.storageBackend})`
}

async function saveSource(provider: ProviderCode, notify = true) {
  if (!canEditSources.value) {
    toast.add({
      title: '权限不足',
      description: '需要目录源配置编辑权限。',
      color: 'warning'
    })
    return false
  }

  const form = forms[provider]
  savingProvider.value = provider
  try {
    await $fetch<ApiResponse<DirectorySource>>(`/api/v1/console/directory/sources/${provider}`, {
      method: 'PUT',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        integrationName: form.integrationName,
        baseUrl: form.baseUrl || null,
        status: form.status,
        config: form.config,
        credential: form.backendSecretRef
          ? {
              secretCode: form.secretCode,
              secretName: `${form.integrationName} Secret`,
              storageBackend: form.storageBackend,
              ...(form.storageBackend === 'db_encrypted'
                ? { plaintext: form.backendSecretRef }
                : { backendSecretRef: form.backendSecretRef })
            }
          : null
      }
    })

    if (notify) toast.add({ title: '目录源已保存', color: 'success' })
    await refresh()
    return true
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '保存失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
    return false
  } finally {
    savingProvider.value = null
  }
}

function ldapFailureDescription(errorCode: string | null, fallback: string | null) {
  const messages: Record<string, string> = {
    ldap_connect_failed: '无法连接 LDAP 服务，请检查 Host、端口、传输安全、TLS Server Name 与 CA 证书。',
    ldap_invalid_credentials: 'LDAP 已连接，但 Bind DN 或 Vault 中保存的密码不正确。请重新输入密码并再次测试。',
    ldap_user_base_unreadable: 'LDAP 已认证，但 User Base 不存在或 Bind 账号没有读取权限。',
    ldap_configuration_unavailable: 'Connector 无法取得最新 LDAP 配置或解密 Vault 凭据。'
  }
  return messages[errorCode || ''] || fallback || 'LDAP 连接测试失败，请检查 Connector 日志。'
}

async function waitForLdapTest(operationId: string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const response = await $fetch<ApiResponse<{
      status: string
      errorCode: string | null
      errorMessage: string | null
    }>>(`/api/v1/console/directory/operations/${operationId}`)
    const operation = response.data
    if (operation.status === 'succeeded') return operation
    if (['dead_letter', 'cancelled', 'failed'].includes(operation.status)) return operation
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  return null
}

async function testLdapConnection() {
  if (!canEditSources.value || testingLdap.value) return
  testingLdap.value = true
  ldapTestFeedback.value = {
    status: 'info',
    title: '正在测试 LDAP 连接与认证',
    description: '正在保存当前配置，并等待客户侧 Directory Connector 完成网络、Bind 与 User Base 检查。'
  }
  try {
    if (!await saveSource('ldap', false)) return
    const queued = await $fetch<ApiResponse<{ operationId: string }>>('/api/v1/console/directory/sources/ldap/test', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() }
    })
    const operation = await waitForLdapTest(queued.data.operationId)
    if (!operation) {
      ldapTestFeedback.value = {
        status: 'warning',
        title: '测试等待超时',
        description: '60 秒内未收到 Connector 结果，请确认 hzy-data-runtime-directory 服务在线。'
      }
      return
    }
    if (operation.status === 'succeeded') {
      ldapTestFeedback.value = {
        status: 'success',
        title: 'LDAP 连接与认证成功',
        description: '网络/TLS、Bind 凭据和 User Base 读取均已通过。'
      }
      toast.add({ title: 'LDAP 测试通过', color: 'success' })
    } else {
      ldapTestFeedback.value = {
        status: 'error',
        title: 'LDAP 连接测试失败',
        description: ldapFailureDescription(operation.errorCode, operation.errorMessage)
      }
    }
    await refresh()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    ldapTestFeedback.value = {
      status: 'error',
      title: 'LDAP 连接测试失败',
      description: error.data?.message || error.message || '未知错误'
    }
  } finally {
    testingLdap.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="directory-sources" :ui="dashboardPanelUi">
    <template #body>
      <UAlert
        v-if="data?.code && data.code !== 0"
        color="error"
        variant="soft"
        title="加载失败"
        description="无法加载目录源数据"
      />

      <div class="grid gap-3 lg:grid-cols-3">
        <UCard
          v-for="provider in providerDefs"
          :key="provider.code"
          class="cursor-pointer transition hover:border-primary"
          :class="activeProvider === provider.code ? 'border-primary' : ''"
          @click="activeProvider = provider.code"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-start gap-3">
              <UIcon :name="provider.icon" class="mt-1 size-6 text-primary" />
              <div>
                <p class="font-semibold">
                  {{ provider.name }}
                </p>
                <p class="text-sm text-muted">
                  {{ provider.description }}
                </p>
              </div>
            </div>
            <UBadge :color="sourceStatus(provider.code).color" variant="soft">
              {{ sourceStatus(provider.code).label }}
            </UBadge>
          </div>
          <p class="mt-3 truncate text-xs text-muted">
            {{ credentialSummary(provider.code) }}
          </p>
        </UCard>
      </div>

      <UCard class="shrink-0">
        <template #header>
          <div>
            <h2 class="font-semibold">
              {{ providerDefs.find(item => item.code === activeProvider)?.name }} 配置
            </h2>
            <p class="text-sm text-muted">
              敏感凭证可由 Console Vault 加密保存，也可使用外部 secret 引用。
            </p>
          </div>
        </template>

        <div class="grid gap-4 lg:grid-cols-2">
          <UFormField label="名称">
            <UInput v-model="forms[activeProvider].integrationName" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="状态">
            <USelect
              v-model="forms[activeProvider].status"
              :items="[
                { label: '启用', value: 'active' },
                { label: '停用', value: 'inactive' }
              ]"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
          <UFormField label="Base URL">
            <UInput v-model="forms[activeProvider].baseUrl" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="Secret Code">
            <UInput v-model="forms[activeProvider].secretCode" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="Secret Backend">
            <USelect
              v-model="forms[activeProvider].storageBackend"
              :items="[
                { label: 'Console Vault（加密）', value: 'db_encrypted' },
                { label: '环境变量', value: 'env_ref' },
                { label: 'Docker Secret', value: 'docker_secret' },
                { label: 'Kubernetes Secret', value: 'k8s_secret' }
              ]"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
          <UFormField :label="forms[activeProvider].storageBackend === 'db_encrypted' ? '密码 / Secret（留空则不更新）' : 'Backend Secret Ref（留空则不更新）'">
            <UInput
              v-model="forms[activeProvider].backendSecretRef"
              :type="forms[activeProvider].storageBackend === 'db_encrypted' ? 'password' : 'text'"
              :placeholder="forms[activeProvider].storageBackend === 'db_encrypted' ? '输入后由 Console Vault 加密保存' : '例如 LDAP_BIND_PASSWORD / k8s://console/ldap-bind-password'"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
        </div>

        <USeparator class="my-5" />

        <div v-if="activeProvider === 'ldap'" class="grid gap-4 lg:grid-cols-2">
          <UAlert
            color="info"
            variant="soft"
            icon="i-lucide-server-cog"
            title="LDAP 由客户侧 Directory Connector 访问"
            description="托管模式允许在目录用户页创建 LDAP 用户，并允许用户在个人资料页修改密码。"
            class="lg:col-span-2"
          />
          <UAlert
            v-if="ldapTestFeedback"
            :color="ldapTestFeedback.status"
            variant="soft"
            :icon="ldapTestFeedback.status === 'success' ? 'i-lucide-circle-check' : ldapTestFeedback.status === 'info' ? 'i-lucide-loader-circle' : 'i-lucide-triangle-alert'"
            :title="ldapTestFeedback.title"
            :description="ldapTestFeedback.description"
            class="lg:col-span-2"
          />
          <UAlert
            v-else-if="sourcesByProvider.get('ldap')?.lastCheckedAt"
            :color="sourcesByProvider.get('ldap')?.connectivityStatus === 'healthy' ? 'success' : 'error'"
            variant="soft"
            :icon="sourcesByProvider.get('ldap')?.connectivityStatus === 'healthy' ? 'i-lucide-circle-check' : 'i-lucide-triangle-alert'"
            :title="sourcesByProvider.get('ldap')?.connectivityStatus === 'healthy' ? '最近一次连接测试通过' : '最近一次连接测试失败'"
            :description="sourcesByProvider.get('ldap')?.lastErrorMessage || `检测时间：${sourcesByProvider.get('ldap')?.lastCheckedAt}`"
            class="lg:col-span-2"
          />
          <UFormField label="管理模式">
            <USelect
              v-model="ldapManagementMode"
              :items="[
                { label: '只读同步', value: 'readonly' },
                { label: 'Console 托管读写', value: 'managed' }
              ]"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
          <UFormField label="目录类型">
            <USelect
              v-model="ldapDirectoryType"
              :items="[
                { label: 'OpenLDAP', value: 'openldap' },
                { label: 'Active Directory', value: 'active-directory' }
              ]"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
          <UFormField label="Host">
            <UInput v-model="forms.ldap.config.host" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="传输安全">
            <USelect
              v-model="ldapTransport"
              :items="[
                { label: 'LDAPS', value: 'ldaps' },
                { label: 'LDAP + StartTLS', value: 'starttls' }
              ]"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
          <UFormField label="Port">
            <UInput
              v-model.number="forms.ldap.config.port"
              type="number"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
          <UFormField label="Bind DN">
            <UInput v-model="forms.ldap.config.bindDN" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="Base DN">
            <UInput v-model="forms.ldap.config.baseDN" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="User Base">
            <UInput v-model="forms.ldap.config.userBase" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="用户筛选器">
            <UInput v-model="forms.ldap.config.userFilter" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="用户 DN 模板">
            <UInput
              v-model="forms.ldap.config.userDnTemplate"
              class="w-full"
              :disabled="!canEditSources"
              placeholder="留空使用 uid={{uid}},User Base"
            />
          </UFormField>
          <UFormField v-if="ldapDirectoryType === 'active-directory'" label="UPN 后缀">
            <UInput
              v-model="forms.ldap.config.userPrincipalNameSuffix"
              class="w-full"
              :disabled="!canEditSources"
              placeholder="例如 wiztek.cn"
            />
          </UFormField>
          <UFormField label="TLS Server Name">
            <UInput
              v-model="forms.ldap.config.serverName"
              class="w-full"
              :disabled="!canEditSources"
              placeholder="留空使用 Host"
            />
          </UFormField>
          <UFormField
            label="配置刷新间隔（秒）"
            description="仅刷新 Connector 的加密配置；LDAP 用户只在目录同步页显式点击同步时读取。"
          >
            <UInput
              v-model.number="forms.ldap.config.syncIntervalSeconds"
              type="number"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
          <UFormField label="分页大小">
            <UInput
              v-model.number="forms.ldap.config.pageSize"
              type="number"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
          <UFormField label="企业 CA PEM" class="lg:col-span-2">
            <UTextarea
              v-model="ldapCaPem"
              :rows="6"
              class="w-full font-mono text-xs"
              :disabled="!canEditSources"
              placeholder="使用企业自签 CA 时粘贴 PEM；公共 CA 可留空"
            />
          </UFormField>
        </div>

        <div v-else-if="activeProvider === 'wecom'" class="grid gap-4 lg:grid-cols-2">
          <UFormField label="Corp ID">
            <UInput v-model="forms.wecom.config.corpId" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="Agent ID">
            <UInput v-model="forms.wecom.config.agentId" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="同步部门 ID">
            <UInput
              v-model.number="forms.wecom.config.syncDepartmentId"
              type="number"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
        </div>

        <div v-else class="grid gap-4 lg:grid-cols-2">
          <UFormField label="App ID">
            <UInput v-model="forms.dingtalk.config.appId" class="w-full" :disabled="!canEditSources" />
          </UFormField>
          <UFormField label="Root Dept ID">
            <UInput
              v-model.number="forms.dingtalk.config.rootDeptId"
              type="number"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
        </div>

        <template #footer>
          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              v-if="activeProvider === 'ldap'"
              icon="i-lucide-plug-zap"
              color="neutral"
              variant="outline"
              :loading="testingLdap"
              :disabled="!canEditSources || savingProvider !== null"
              @click="testLdapConnection"
            >
              测试连接与认证
            </UButton>
            <UButton
              icon="i-lucide-save"
              :loading="savingProvider === activeProvider"
              :disabled="!canEditSources || testingLdap"
              @click="saveSource(activeProvider)"
            >
              保存配置
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
