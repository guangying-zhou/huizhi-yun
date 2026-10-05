<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

usePageTitle('API管理')

interface ApiKey {
  id: number
  keyName: string
  apiKey: string
  apiKeyFull: string
  scopes: string[]
  rateLimit: number
  ipWhitelist: string[]
  expiresAt: string | null
  status: number
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

interface ApiKeyList {
  items: ApiKey[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface NewKeyResponse {
  keyName: string
  apiKey: string
  apiSecret: string
}

const toast = useToast()
const loading = ref(false)
const apiKeys = ref<ApiKey[]>([])
const search = ref('')

const pagination = ref({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0
})

const showCreateModal = ref(false)
const showSecretModal = ref(false)
const saving = ref(false)

const formData = ref({
  keyName: '',
  rateLimit: 1000
})

const newKeyInfo = ref({
  keyName: '',
  apiKey: '',
  apiSecret: ''
})

const statusLabels: Record<number, { label: string, color: 'success' | 'neutral' }> = {
  1: { label: '启用', color: 'success' },
  0: { label: '禁用', color: 'neutral' }
}

async function loadApiKeys(page = 1) {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<ApiKeyList>>('/api/api-keys', {
      query: { page, pageSize: pagination.value.pageSize, search: search.value }
    })
    apiKeys.value = res.data.items
    pagination.value = {
      page: res.data.page,
      pageSize: res.data.pageSize,
      total: res.data.total,
      totalPages: res.data.totalPages
    }
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '加载失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  formData.value = {
    keyName: '',
    rateLimit: 1000
  }
  showCreateModal.value = true
}

async function createApiKey() {
  if (!formData.value.keyName) {
    toast.add({ title: '请填写密钥名称', color: 'warning' })
    return
  }

  saving.value = true
  try {
    const res = await $fetch<ApiResponse<NewKeyResponse>>('/api/api-keys', {
      method: 'POST',
      body: formData.value
    })

    // Show secret modal with new key info
    newKeyInfo.value = {
      keyName: res.data.keyName,
      apiKey: res.data.apiKey,
      apiSecret: res.data.apiSecret
    }

    showCreateModal.value = false
    showSecretModal.value = true

    toast.add({ title: '创建成功', color: 'success' })
    await loadApiKeys()
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '创建失败', description: error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function toggleStatus(key: ApiKey) {
  try {
    await $fetch(`/api/api-keys/${key.id}`, {
      method: 'PATCH',
      body: { status: key.status === 1 ? 0 : 1 }
    })
    toast.add({ title: key.status === 1 ? '已禁用' : '已启用', color: 'success' })
    await loadApiKeys(pagination.value.page)
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '操作失败', description: error.message, color: 'error' })
  }
}

async function deleteApiKey(key: ApiKey) {
  if (!confirm(`确定要删除密钥 "${key.keyName}" 吗？此操作不可恢复。`)) return

  try {
    await $fetch(`/api/api-keys/${key.id}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', color: 'success' })
    await loadApiKeys(pagination.value.page)
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '删除失败', description: error.message, color: 'error' })
  }
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text)
  toast.add({ title: `${label} 已复制`, color: 'success' })
}

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

onMounted(() => {
  loadApiKeys()
})

const columns: TableColumn<ApiKey>[] = [
  { accessorKey: 'keyName', header: '密钥名称' },
  { accessorKey: 'apiKey', header: 'API Key' },
  { accessorKey: 'rateLimit', header: '调用限制' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'lastUsedAt', header: '最后使用' },
  { accessorKey: 'createdAt', header: '创建时间' },
  { id: 'actions', header: '操作' }
]
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel id="api-keys-list" :ui="{ body: 'gap-1 sm:p-3' }">
      <template #header>
        <UDashboardToolbar>
          <template #right>
            <div class="flex items-center gap-2">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                placeholder="搜索密钥..."
                size="sm"
                class="w-64"
                @change="loadApiKeys(1)"
              >
                <template v-if="search?.length" #trailing>
                  <UButton
                    color="neutral"
                    variant="link"
                    size="sm"
                    icon="i-lucide-circle-x"
                    @click="search = ''; loadApiKeys(1)"
                  />
                </template>
              </UInput>
              <UButton
                color="primary"
                size="sm"
                variant="solid"
                icon="i-lucide-plus"
                @click="openCreateModal"
              >
                新建密钥
              </UButton>
              <UButton
                color="secondary"
                size="sm"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="loading"
                @click="loadApiKeys()"
              >
                刷新
              </UButton>
            </div>
          </template>
        </UDashboardToolbar>
      </template>

      <template #body>
        <UCard :ui="{ body: 'p-0' }">
          <UTable
            :data="apiKeys"
            :columns="columns"
            :loading="loading"
            empty-state-title="暂无API密钥"
            sticky
            class="w-full h-[calc(100vh-200px)]"
          >
            <template #keyName-cell="{ row }">
              <span class="font-medium">{{ row.original.keyName }}</span>
            </template>

            <template #apiKey-cell="{ row }">
              <div class="flex items-center gap-2">
                <code class="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                  {{ row.original.apiKey }}
                </code>
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-copy"
                  @click="copyToClipboard(row.original.apiKeyFull, 'API Key')"
                />
              </div>
            </template>

            <template #rateLimit-cell="{ row }">
              <span class="text-sm">{{ row.original.rateLimit }}/分钟</span>
            </template>

            <template #status-cell="{ row }">
              <UBadge :color="statusLabels[row.original.status]?.color" size="xs" variant="subtle">
                {{ statusLabels[row.original.status]?.label }}
              </UBadge>
            </template>

            <template #lastUsedAt-cell="{ row }">
              <span class="text-sm text-gray-500">{{ formatDateTime(row.original.lastUsedAt) }}</span>
            </template>

            <template #createdAt-cell="{ row }">
              <span class="text-sm text-gray-500">{{ formatDateTime(row.original.createdAt) }}</span>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex items-center gap-2">
                <UButton
                  size="xs"
                  :color="row.original.status === 1 ? 'warning' : 'success'"
                  variant="ghost"
                  :icon="row.original.status === 1 ? 'i-lucide-pause' : 'i-lucide-play'"
                  @click="toggleStatus(row.original)"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  @click="deleteApiKey(row.original)"
                />
              </div>
            </template>
          </UTable>

          <div
            v-if="!loading && pagination.total > 0"
            class="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800"
          >
            <span class="text-sm text-gray-500">共 {{ pagination.total }} 个密钥</span>
            <UPagination
              v-model:page="pagination.page"
              :total="pagination.total"
              :page-count="pagination.pageSize"
              @update:page="loadApiKeys"
            />
          </div>
        </UCard>
      </template>
    </UDashboardPanel>

    <!-- Create Modal -->
    <UModal v-model:open="showCreateModal" title="新建API密钥" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <div class="space-y-6 p-2">
          <UFormField
            label="密钥名称"
            required
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UInput v-model="formData.keyName" placeholder="例如：CodeInsight后端服务" class="w-full" />
          </UFormField>

          <UFormField
            label="调用限制 (次/分钟)"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UInput
              v-model.number="formData.rateLimit"
              type="number"
              placeholder="1000"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 pt-1">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="showCreateModal = false"
          />
          <UButton
            label="创建密钥"
            color="primary"
            :loading="saving"
            @click="createApiKey"
          />
        </div>
      </template>
    </UModal>

    <!-- Secret Display Modal -->
    <UModal v-model:open="showSecretModal" title="密钥创建成功" :ui="{ content: 'sm:max-w-3xl' }">
      <template #body>
        <div class="space-y-4 p-2">
          <div
            class="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800"
          >
            <div class="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
              <UIcon name="i-lucide-alert-triangle" class="w-5 h-5" />
              <span class="font-medium">请妥善保存以下密钥</span>
            </div>
            <p class="text-sm text-amber-600 dark:text-amber-300">
              API Secret 仅在创建时显示一次，关闭后将无法再次查看。请立即复制并安全保存。
            </p>
          </div>

          <div class="space-y-3">
            <div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">密钥名称</label>
              <div class="mt-1 text-sm">
                {{ newKeyInfo.keyName }}
              </div>
            </div>

            <div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">API Key</label>
              <div class="mt-1 flex items-center gap-2">
                <code class="flex-1 text-sm bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded font-mono">
                  {{ newKeyInfo.apiKey }}
                </code>
                <UButton
                  size="sm"
                  variant="ghost"
                  icon="i-lucide-copy"
                  @click="copyToClipboard(newKeyInfo.apiKey, 'API Key')"
                />
              </div>
            </div>

            <div>
              <label class="text-sm font-medium text-gray-700 dark:text-gray-300">API Secret</label>
              <div class="mt-1 flex items-center gap-2">
                <code
                  class="flex-1 text-sm bg-gray-100 dark:bg-gray-800 px-3 py-2 rounded font-mono break-all"
                >
                  {{ newKeyInfo.apiSecret }}
                </code>
                <UButton
                  size="sm"
                  variant="ghost"
                  icon="i-lucide-copy"
                  @click="copyToClipboard(newKeyInfo.apiSecret, 'API Secret')"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 pt-1">
          <UButton label="我已保存，关闭" color="primary" @click="showSecretModal = false" />
        </div>
      </template>
    </UModal>
  </div>
</template>
