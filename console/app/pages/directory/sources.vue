<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('目录源配置')

type ProviderCode = 'ldap' | 'wecom' | 'dingtalk'
type StorageBackend = 'env_ref' | 'docker_secret' | 'k8s_secret'

interface DirectorySource {
  providerCode: ProviderCode
  integrationCode: string
  integrationName: string
  baseUrl: string | null
  config: Record<string, unknown>
  status: string
  connectivityStatus: string
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
    storageBackend: 'env_ref',
    secretCode: 'directory.ldap.bind_password',
    backendSecretRef: 'LDAP_BIND_PASSWORD',
    config: {
      host: '',
      port: 636,
      bindDN: '',
      baseDN: '',
      userBase: '',
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

async function saveSource(provider: ProviderCode) {
  if (!canEditSources.value) {
    toast.add({
      title: '权限不足',
      description: '需要目录源配置编辑权限。',
      color: 'warning'
    })
    return
  }

  const form = forms[provider]
  savingProvider.value = provider
  try {
    await $fetch<ApiResponse<DirectorySource>>(`/api/v1/console/directory/sources/${provider}`, {
      method: 'PUT',
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
              backendSecretRef: form.backendSecretRef
            }
          : null
      }
    })

    toast.add({ title: '目录源已保存', color: 'success' })
    await refresh()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '保存失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    savingProvider.value = null
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

      <UCard>
        <template #header>
          <div>
            <h2 class="font-semibold">
              {{ providerDefs.find(item => item.code === activeProvider)?.name }} 配置
            </h2>
            <p class="text-sm text-muted">
              这里只保存非敏感配置和 secret 引用，不保存明文密钥。
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
                { label: '环境变量', value: 'env_ref' },
                { label: 'Docker Secret', value: 'docker_secret' },
                { label: 'Kubernetes Secret', value: 'k8s_secret' }
              ]"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
          <UFormField label="Backend Secret Ref（留空则不更新凭证）">
            <UInput
              v-model="forms[activeProvider].backendSecretRef"
              placeholder="例如 LDAP_BIND_PASSWORD / k8s://console/ldap-bind-password"
              class="w-full"
              :disabled="!canEditSources"
            />
          </UFormField>
        </div>

        <USeparator class="my-5" />

        <div v-if="activeProvider === 'ldap'" class="grid gap-4 lg:grid-cols-2">
          <UFormField label="Host">
            <UInput v-model="forms.ldap.config.host" class="w-full" :disabled="!canEditSources" />
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
          <UFormField label="Use TLS">
            <USwitch v-model="forms.ldap.config.useTLS" :disabled="!canEditSources" />
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
          <div class="flex justify-end">
            <UButton
              icon="i-lucide-save"
              :loading="savingProvider === activeProvider"
              :disabled="!canEditSources"
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
