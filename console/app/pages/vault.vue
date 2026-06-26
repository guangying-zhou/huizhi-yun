<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('凭证库')

type StorageBackend = 'db_encrypted' | 'env_ref' | 'docker_secret' | 'k8s_secret'
type UsageType = 'integration' | 'service' | 'bootstrap' | 'custody'
type VaultUsageType = UsageType | 'service_client'

type ApiResponse<T> = {
  code: number
  data: T
  message?: string
}

type VaultSecret = {
  secretCode: string
  secretRef: string
  secretName: string
  secretType: string
  usageType: VaultUsageType
  ownerType: string
  ownerKey: string | null
  storageBackend: StorageBackend
  revealPolicy: string
  maskedPreview: string | null
  currentVersionNo: number | null
  expiresAt: string | null
  lastRotatedAt: string | null
  status: string
  createdAt: string
  updatedAt: string
}

type SecretForm = {
  secretCode: string
  secretName: string
  secretType: string
  usageType: UsageType
  ownerType: string
  ownerKey: string
  storageBackend: StorageBackend
  revealPolicy: string
  material: string
  expiresAt: string
}

type RevealResult = VaultSecret & {
  versionNo: number | null
  plaintext: string
  revealedAt: string
}

const usageOptions = [
  { label: '集成凭证', value: 'integration' },
  { label: '服务凭证', value: 'service' },
  { label: '启动凭证', value: 'bootstrap' },
  { label: '托管凭证', value: 'custody' }
]

const backendOptions = [
  { label: '数据库加密', value: 'db_encrypted' },
  { label: '环境变量', value: 'env_ref' },
  { label: 'Docker Secret', value: 'docker_secret' },
  { label: 'Kubernetes Secret', value: 'k8s_secret' }
]

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'active' },
  { label: '停用', value: 'inactive' },
  { label: '已过期', value: 'expired' }
]

const toast = useToast()
const search = ref('')
const usageFilter = ref<'all' | UsageType>('all')
const statusFilter = ref('all')
const selectedCode = ref('')
const expanded = ref<Record<string, boolean>>({})
const isCreateOpen = ref(false)
const isRotateOpen = ref(false)
const isRevealOpen = ref(false)
const saving = ref(false)
const rotating = ref(false)
const revealing = ref(false)
const revealReason = ref('')
const approvalCode = ref('')
const revealResult = ref<RevealResult | null>(null)
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')

if (!permissionsLoaded.value) {
  await loadPermissions()
}

const canEditVault = computed(() => permissionsLoaded.value && hasPermission('credential_vault', 'edit'))

function createEmptyForm(): SecretForm {
  return {
    secretCode: '',
    secretName: '',
    secretType: 'api_key',
    usageType: 'integration',
    ownerType: 'integration',
    ownerKey: '',
    storageBackend: 'db_encrypted',
    revealPolicy: 'approval',
    material: '',
    expiresAt: ''
  }
}

const createForm = reactive<SecretForm>(createEmptyForm())
const rotateForm = reactive<Pick<SecretForm, 'storageBackend' | 'material'>>({
  storageBackend: 'db_encrypted',
  material: ''
})

const { data, pending, refresh } = await useFetch<ApiResponse<{ items: VaultSecret[] }>>(
  '/api/v1/console/vault/secrets',
  {
    default: () => ({ code: 0, data: { items: [] } })
  }
)

const secrets = computed(() => data.value?.data.items || [])
const selectedSecret = computed(() => secrets.value.find(item => item.secretCode === selectedCode.value) || secrets.value[0] || null)
const filteredSecrets = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return secrets.value.filter((item) => {
    if (usageFilter.value !== 'all' && normalizedUsageType(item.usageType) !== usageFilter.value) return false
    if (statusFilter.value !== 'all' && item.status !== statusFilter.value) return false
    if (!keyword) return true
    return [
      item.secretCode,
      item.secretName,
      item.secretType,
      item.ownerType,
      item.ownerKey,
      item.storageBackend
    ].some(value => String(value || '').toLowerCase().includes(keyword))
  })
})

watch(secrets, (items) => {
  if (!selectedCode.value && items[0]) {
    selectedCode.value = items[0].secretCode
  }
  if (selectedCode.value && !items.some(item => item.secretCode === selectedCode.value) && items[0]) {
    selectedCode.value = items[0].secretCode
  }
}, { immediate: true })

watch(() => createForm.usageType, (usageType) => {
  if (!createForm.ownerType || ['integration', 'service', 'bootstrap', 'custody'].includes(createForm.ownerType)) {
    createForm.ownerType = usageType
  }
})

function resetCreateForm() {
  Object.assign(createForm, createEmptyForm())
}

function openRotate(secret: VaultSecret) {
  selectedCode.value = secret.secretCode
  rotateForm.storageBackend = secret.storageBackend
  rotateForm.material = ''
  isRotateOpen.value = true
}

function openReveal(secret: VaultSecret) {
  selectedCode.value = secret.secretCode
  revealReason.value = ''
  approvalCode.value = ''
  revealResult.value = null
  isRevealOpen.value = true
}

function errorMessage(error: unknown) {
  const normalized = error as { data?: { message?: string }, message?: string }
  return normalized.data?.message || normalized.message || String(error)
}

function usageLabel(value: string) {
  if (value === 'service_client') return '服务凭证'
  return usageOptions.find(item => item.value === value)?.label || value
}

function normalizedUsageType(value: string): UsageType | string {
  return value === 'service_client' ? 'service' : value
}

function backendLabel(value: string) {
  return backendOptions.find(item => item.value === value)?.label || value
}

function statusBadge(status: string) {
  if (status === 'active') return { label: '启用', color: 'success' as const }
  if (status === 'expired') return { label: '已过期', color: 'warning' as const }
  if (status === 'inactive') return { label: '停用', color: 'neutral' as const }
  return { label: status || '未知', color: 'neutral' as const }
}

function getSecretRowId(row: VaultSecret) {
  return row.secretCode
}

const secretColumns: TableColumn<VaultSecret>[] = [
  {
    id: 'expand',
    header: '',
    cell: ({ row }) => h(UButton, {
      icon: row.getIsExpanded() ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right',
      color: 'neutral',
      variant: 'ghost',
      size: 'sm',
      onClick: (event: MouseEvent) => {
        event.stopPropagation()
        row.toggleExpanded()
      }
    })
  },
  {
    accessorKey: 'secretName',
    header: '凭证',
    cell: ({ row }) => {
      const secret = row.original
      const meta = statusBadge(secret.status)
      return h('div', { class: 'min-w-0' }, [
        h('div', { class: 'flex min-w-0 items-center gap-2' }, [
          h('span', { class: 'truncate font-medium text-highlighted' }, secret.secretName),
          h(UBadge, { color: meta.color, variant: 'soft' }, () => meta.label)
        ]),
        h('div', { class: 'mt-1 truncate font-mono text-xs text-muted' }, secret.secretCode)
      ])
    }
  },
  {
    accessorKey: 'usageType',
    header: '用途',
    cell: ({ row }) => h(UBadge, { color: 'neutral', variant: 'subtle' }, () => usageLabel(row.original.usageType))
  },
  {
    accessorKey: 'storageBackend',
    header: '存储',
    cell: ({ row }) => h(UBadge, { color: 'neutral', variant: 'subtle' }, () => backendLabel(row.original.storageBackend))
  },
  {
    accessorKey: 'currentVersionNo',
    header: '版本',
    cell: ({ row }) => row.original.currentVersionNo ? `v${row.original.currentVersionNo}` : '-'
  },
  {
    accessorKey: 'updatedAt',
    header: '更新时间',
    cell: ({ row }) => row.original.updatedAt || '-'
  },
  {
    id: 'actions',
    header: '操作',
    cell: ({ row }) => {
      return h('div', { class: 'flex justify-end gap-2' }, [
        h(UButton, {
          label: '复制引用',
          icon: 'i-lucide-copy',
          color: 'neutral',
          variant: 'ghost',
          size: 'sm',
          disabled: !canEditVault.value,
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            copyText(row.original.secretRef)
          }
        })
      ])
    }
  }
]

function materialBody(storageBackend: StorageBackend, value: string) {
  const material = value.trim()
  if (storageBackend === 'db_encrypted') {
    return { plaintext: material }
  }
  return { backendSecretRef: material }
}

function materialLabel(storageBackend: StorageBackend) {
  return storageBackend === 'db_encrypted' ? 'Secret 明文' : 'Backend Ref'
}

function materialPlaceholder(storageBackend: StorageBackend) {
  if (storageBackend === 'env_ref') return '例如 AI_PROVIDER_API_KEY'
  if (storageBackend === 'docker_secret') return '例如 /run/secrets/provider_key 或 provider_key'
  if (storageBackend === 'k8s_secret') return '当前版本填写绝对路径或 file:// 引用'
  return '保存后加密入库，不会在列表中回显'
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: '已复制', color: 'success' })
  } catch {
    toast.add({ title: '复制失败', color: 'error' })
  }
}

async function createSecret() {
  if (!canEditVault.value) {
    toast.add({ title: '权限不足', description: '需要凭证库编辑权限。', color: 'warning' })
    return
  }
  saving.value = true
  try {
    await $fetch<ApiResponse<VaultSecret>>('/api/v1/console/vault/secrets', {
      method: 'POST',
      body: {
        secretCode: createForm.secretCode,
        secretName: createForm.secretName,
        secretType: createForm.secretType,
        usageType: createForm.usageType,
        ownerType: createForm.ownerType,
        ownerKey: createForm.ownerKey || null,
        storageBackend: createForm.storageBackend,
        revealPolicy: createForm.revealPolicy,
        expiresAt: createForm.expiresAt || null,
        material: materialBody(createForm.storageBackend, createForm.material)
      }
    })
    toast.add({ title: '凭证已创建', color: 'success' })
    isCreateOpen.value = false
    await refresh()
    selectedCode.value = createForm.secretCode
    resetCreateForm()
  } catch (error) {
    toast.add({ title: '创建失败', description: errorMessage(error), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function rotateSecret() {
  const secret = selectedSecret.value
  if (!secret) return
  rotating.value = true
  try {
    await $fetch<ApiResponse<{ versionNo: number }>>(
      `/api/v1/console/vault/secrets/${encodeURIComponent(secret.secretCode)}/rotate`,
      {
        method: 'POST',
        body: {
          storageBackend: rotateForm.storageBackend,
          material: materialBody(rotateForm.storageBackend, rotateForm.material)
        }
      }
    )
    toast.add({ title: '凭证已轮换', color: 'success' })
    isRotateOpen.value = false
    await refresh()
  } catch (error) {
    toast.add({ title: '轮换失败', description: errorMessage(error), color: 'error' })
  } finally {
    rotating.value = false
  }
}

async function revealSecret() {
  const secret = selectedSecret.value
  if (!secret) return
  revealing.value = true
  try {
    const response = await $fetch<ApiResponse<RevealResult>>(
      `/api/v1/console/vault/secrets/${encodeURIComponent(secret.secretCode)}/reveal`,
      {
        method: 'POST',
        body: {
          reason: revealReason.value,
          approvalCode: approvalCode.value || null
        }
      }
    )
    revealResult.value = response.data
    toast.add({ title: '凭证已展示', color: 'success' })
  } catch (error) {
    toast.add({ title: '展示失败', description: errorMessage(error), color: 'error' })
  } finally {
    revealing.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="vault" :ui="dashboardPanelUi">
    <template #body>
      <div class="space-y-4">
        <div class="grid gap-3 lg:grid-cols-4">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            placeholder="搜索 code / owner / backend"
            class="lg:col-span-2"
          />
          <USelect
            v-model="usageFilter"
            :items="[{ label: '全部用途', value: 'all' }, ...usageOptions]"
          />
          <USelect
            v-model="statusFilter"
            :items="statusOptions"
          />
        </div>

        <div>
          <UTable
            v-model:expanded="expanded"
            sticky
            :data="filteredSecrets"
            :columns="secretColumns"
            :get-row-id="getSecretRowId"
            :ui="{ tr: 'data-[expanded=true]:bg-elevated/50' }"
            :loading="pending"
            empty="暂无凭证"
            class="flex-1 max-h-[calc(100svh-16rem)] rounded-lg border border-default"
          >
            <template #expanded="{ row }">
              <div class="space-y-4 bg-muted/30 p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 class="font-semibold text-highlighted">
                      {{ row.original.secretName }}
                    </h2>
                    <p class="mt-1 font-mono text-xs text-muted">
                      {{ row.original.secretRef }}
                    </p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <UButton
                      icon="i-lucide-copy"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                      @click="copyText(row.original.secretRef)"
                    >
                      复制引用
                    </UButton>
                    <UButton
                      icon="i-lucide-rotate-cw"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                      :disabled="!canEditVault"
                      @click="openRotate(row.original)"
                    >
                      轮换
                    </UButton>
                    <UButton
                      icon="i-lucide-eye"
                      size="sm"
                      :disabled="!canEditVault"
                      @click="openReveal(row.original)"
                    >
                      Reveal
                    </UButton>
                  </div>
                </div>

                <div class="grid gap-3 text-sm md:grid-cols-3 xl:grid-cols-6">
                  <div>
                    <div class="text-muted">
                      Secret Type
                    </div>
                    <div class="mt-1 text-highlighted">
                      {{ row.original.secretType }}
                    </div>
                  </div>
                  <div>
                    <div class="text-muted">
                      Storage
                    </div>
                    <div class="mt-1 text-highlighted">
                      {{ backendLabel(row.original.storageBackend) }}
                    </div>
                  </div>
                  <div>
                    <div class="text-muted">
                      Owner
                    </div>
                    <div class="mt-1 truncate text-highlighted">
                      {{ row.original.ownerType }}{{ row.original.ownerKey ? ` / ${row.original.ownerKey}` : '' }}
                    </div>
                  </div>
                  <div>
                    <div class="text-muted">
                      Reveal Policy
                    </div>
                    <div class="mt-1 text-highlighted">
                      {{ row.original.revealPolicy }}
                    </div>
                  </div>
                  <div>
                    <div class="text-muted">
                      Masked
                    </div>
                    <div class="mt-1 font-mono text-xs text-highlighted">
                      {{ row.original.maskedPreview || '-' }}
                    </div>
                  </div>
                  <div>
                    <div class="text-muted">
                      Current Version
                    </div>
                    <div class="mt-1 text-highlighted">
                      {{ row.original.currentVersionNo ? `v${row.original.currentVersionNo}` : '-' }}
                    </div>
                  </div>
                </div>

                <div class="grid gap-2 rounded-lg border border-default bg-default/60 p-3 text-sm md:grid-cols-3">
                  <div class="flex items-center justify-start gap-3">
                    <span class="text-muted">Last Rotated</span>
                    <span class="text-right">{{ row.original.lastRotatedAt || '-' }}</span>
                  </div>
                  <div class="flex items-center justify-start gap-3">
                    <span class="text-muted">Expires</span>
                    <span class="text-right">{{ row.original.expiresAt || '-' }}</span>
                  </div>
                  <div class="flex items-center justify-start gap-3">
                    <span class="text-muted">Updated</span>
                    <span class="text-right">{{ row.original.updatedAt || '-' }}</span>
                  </div>
                </div>
              </div>
            </template>
          </UTable>
        </div>

        <UModal
          v-model:open="isCreateOpen"
          title="新建凭证"
          :ui="{ content: 'sm:max-w-3xl' }"
        >
          <template #body>
            <div class="grid gap-4 md:grid-cols-2">
              <UFormField label="Secret Code">
                <UInput v-model="createForm.secretCode" class="w-full" placeholder="integration.vendor.default.api_key" />
              </UFormField>
              <UFormField label="名称">
                <UInput v-model="createForm.secretName" class="w-full" placeholder="Vendor default API key" />
              </UFormField>
              <UFormField label="Secret Type">
                <UInput v-model="createForm.secretType" class="w-full" placeholder="api_key" />
              </UFormField>
              <UFormField label="用途">
                <USelect v-model="createForm.usageType" :items="usageOptions" class="w-full" />
              </UFormField>
              <UFormField label="Owner Type">
                <UInput v-model="createForm.ownerType" class="w-full" />
              </UFormField>
              <UFormField label="Owner Key">
                <UInput v-model="createForm.ownerKey" class="w-full" placeholder="integration code / service client / tenant" />
              </UFormField>
              <UFormField label="Storage Backend">
                <USelect v-model="createForm.storageBackend" :items="backendOptions" class="w-full" />
              </UFormField>
              <UFormField label="Reveal Policy">
                <USelect
                  v-model="createForm.revealPolicy"
                  :items="[
                    { label: '需授权', value: 'approval' },
                    { label: '禁止展示', value: 'deny' }
                  ]"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Expires At">
                <UInput v-model="createForm.expiresAt" type="datetime-local" class="w-full" />
              </UFormField>
              <UFormField :label="materialLabel(createForm.storageBackend)" class="md:col-span-2">
                <UInput
                  v-model="createForm.material"
                  type="password"
                  class="w-full"
                  :placeholder="materialPlaceholder(createForm.storageBackend)"
                />
              </UFormField>
            </div>
          </template>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="soft" @click="isCreateOpen = false">
                取消
              </UButton>
              <UButton
                icon="i-lucide-save"
                :loading="saving"
                :disabled="!canEditVault"
                @click="createSecret"
              >
                创建
              </UButton>
            </div>
          </template>
        </UModal>

        <UModal
          v-model:open="isRotateOpen"
          :title="`轮换：${selectedSecret?.secretCode || ''}`"
          :ui="{ content: 'sm:max-w-2xl' }"
        >
          <template #body>
            <div class="space-y-4">
              <UFormField label="Storage Backend">
                <USelect v-model="rotateForm.storageBackend" :items="backendOptions" class="w-full" />
              </UFormField>
              <UFormField :label="materialLabel(rotateForm.storageBackend)">
                <UInput
                  v-model="rotateForm.material"
                  type="password"
                  class="w-full"
                  :placeholder="materialPlaceholder(rotateForm.storageBackend)"
                />
              </UFormField>
            </div>
          </template>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="soft" @click="isRotateOpen = false">
                取消
              </UButton>
              <UButton
                icon="i-lucide-rotate-cw"
                :loading="rotating"
                :disabled="!canEditVault"
                @click="rotateSecret"
              >
                轮换当前版本
              </UButton>
            </div>
          </template>
        </UModal>

        <UModal
          v-model:open="isRevealOpen"
          :title="`Reveal：${selectedSecret?.secretCode || ''}`"
          :ui="{ content: 'sm:max-w-2xl' }"
        >
          <template #body>
            <div class="space-y-4">
              <UFormField label="Reason">
                <UTextarea
                  v-model="revealReason"
                  class="w-full"
                  :rows="3"
                  placeholder="填写本次展示原因"
                />
              </UFormField>
              <UFormField label="Approval Code">
                <UInput v-model="approvalCode" class="w-full" placeholder="可选" />
              </UFormField>
              <UFormField v-if="revealResult" label="Plaintext">
                <div class="flex gap-2">
                  <UTextarea
                    :model-value="revealResult.plaintext"
                    class="w-full font-mono"
                    :rows="4"
                    readonly
                  />
                  <UButton
                    icon="i-lucide-copy"
                    color="neutral"
                    variant="subtle"
                    @click="copyText(revealResult.plaintext)"
                  />
                </div>
              </UFormField>
            </div>
          </template>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="soft" @click="isRevealOpen = false">
                关闭
              </UButton>
              <UButton
                icon="i-lucide-eye"
                :loading="revealing"
                :disabled="!canEditVault"
                @click="revealSecret"
              >
                Reveal
              </UButton>
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
