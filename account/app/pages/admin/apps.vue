<script setup lang="ts">
usePageTitle('应用管理')

interface Application {
  id: number
  app_code: string
  app_name: string
  description: string | null
  icon: string | null
  home_url: string | null
  callback_url: string | null
  logout_url: string | null
  app_type: string
  sso_type: string | null
  access_scope: string
  status: number
  created_at: string
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

interface AppList {
  items: Application[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface CreateAppResponse {
  id: number
  app_secret: string
}

const toast = useToast()
const loading = ref(false)
const apps = ref<Application[]>([])
const search = ref('')
const togglingAppIds = ref<number[]>([])

// Logo 上传相关
const logoFile = ref<File | null>(null)
const logoPreview = ref('')
const logoUploading = ref(false)
const logoInputRef = ref<HTMLInputElement | null>(null)

function triggerLogoInput() {
  logoInputRef.value?.click()
}

function onLogoChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  logoFile.value = file
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = URL.createObjectURL(file)
}

function clearLogo() {
  logoFile.value = null
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = ''
  formData.value.icon = ''
  if (logoInputRef.value) logoInputRef.value.value = ''
}

async function uploadLogoFile(): Promise<string | null> {
  if (!logoFile.value) return null
  logoUploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', logoFile.value)
    const res = await $fetch<{ code: number, message: string, data: { url: string } }>('/api/oss/upload-logo', {
      method: 'POST',
      body: fd
    })
    return res.data.url
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '图标上传失败', description: error.data?.message || error.message, color: 'error' })
    return null
  } finally {
    logoUploading.value = false
  }
}

function resetLogoState() {
  logoFile.value = null
  if (logoPreview.value) URL.revokeObjectURL(logoPreview.value)
  logoPreview.value = ''
  if (logoInputRef.value) logoInputRef.value.value = ''
}

const pagination = ref({
  page: 1,
  pageSize: 20,
  total: 0,
  totalPages: 0
})

const showCreateModal = ref(false)
const showEditModal = ref(false)
const showSecretModal = ref(false)
const saving = ref(false)

const formData = ref({
  app_code: '',
  app_name: '',
  description: '',
  icon: '',
  home_url: '',
  callback_url: '',
  logout_url: '',
  app_type: 'internal',
  sso_type: 'CAS',
  access_scope: 'all'
})

const currentApp = ref<Application | null>(null)
const newSecret = ref('')

const typeOptions = [
  { value: 'internal', label: '内部应用' },
  { value: 'external', label: '外部应用' }
]

const ssoOptions = [
  { value: 'CAS', label: 'CAS' },
  { value: 'OAuth', label: 'OAuth 2.0' },
  { value: 'OIDC', label: 'OpenID Connect' }
]

const scopeOptions = [
  { value: 'all', label: '全部用户' },
  { value: 'department', label: '按部门' },
  { value: 'user', label: '指定用户' }
]

const statusLabels: Record<number, { label: string, color: 'success' | 'neutral' }> = {
  1: { label: '启用', color: 'success' },
  0: { label: '禁用', color: 'neutral' }
}

async function loadApps(page = 1) {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<AppList>>('/api/applications', {
      query: { page, pageSize: pagination.value.pageSize, search: search.value }
    })
    apps.value = res.data.items
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

function handleSearch() {
  loadApps(1)
}

function openCreateModal() {
  formData.value = {
    app_code: '', app_name: '', description: '', icon: '',
    home_url: '', callback_url: '', logout_url: '',
    app_type: 'internal', sso_type: 'CAS', access_scope: 'all'
  }
  resetLogoState()
  showCreateModal.value = true
}

async function createApp() {
  if (!formData.value.app_code || !formData.value.app_name) {
    toast.add({ title: '请填写应用编码和名称', color: 'warning' })
    return
  }

  saving.value = true
  try {
    // 先上传图标（如有），再创建应用
    if (logoFile.value) {
      const logoUrl = await uploadLogoFile()
      if (logoUrl) formData.value.icon = logoUrl
    }

    const res = await $fetch<ApiResponse<CreateAppResponse>>('/api/applications', {
      method: 'POST',
      body: formData.value
    })
    toast.add({ title: '创建成功', color: 'success' })
    showCreateModal.value = false

    // 显示密钥
    newSecret.value = res.data.app_secret
    currentApp.value = { ...formData.value, id: res.data.id } as unknown as Application
    showSecretModal.value = true

    loadApps()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '创建失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

function openEditModal(app: Application) {
  currentApp.value = app
  formData.value = {
    app_code: app.app_code,
    app_name: app.app_name,
    description: app.description || '',
    icon: app.icon || '',
    home_url: app.home_url || '',
    callback_url: app.callback_url || '',
    logout_url: app.logout_url || '',
    app_type: app.app_type,
    sso_type: app.sso_type || 'CAS',
    access_scope: app.access_scope
  }
  resetLogoState()
  showEditModal.value = true
}

async function updateApp() {
  if (!currentApp.value) return

  saving.value = true
  try {
    // 上传图标（如有新选择）
    if (logoFile.value) {
      const logoUrl = await uploadLogoFile()
      if (logoUrl) formData.value.icon = logoUrl
    }

    await $fetch(`/api/applications/${currentApp.value.id}`, {
      method: 'PATCH',
      body: {
        app_name: formData.value.app_name,
        description: formData.value.description || null,
        icon: formData.value.icon || null,
        home_url: formData.value.home_url || null,
        callback_url: formData.value.callback_url || null,
        logout_url: formData.value.logout_url || null,
        app_type: formData.value.app_type,
        sso_type: formData.value.sso_type,
        access_scope: formData.value.access_scope
      }
    })
    toast.add({ title: '更新成功', color: 'success' })
    showEditModal.value = false
    loadApps(pagination.value.page)
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '更新失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

function isTogglingStatus(appId: number) {
  return togglingAppIds.value.includes(appId)
}

async function toggleAppStatus(app: Application, enabled: boolean) {
  if (isTogglingStatus(app.id)) return

  togglingAppIds.value = [...togglingAppIds.value, app.id]

  try {
    const nextStatus = enabled ? 1 : 0

    await $fetch(`/api/applications/${app.id}`, {
      method: 'PATCH',
      body: { status: nextStatus }
    })

    apps.value = apps.value.map(item =>
      item.id === app.id ? { ...item, status: nextStatus } : item
    )

    toast.add({
      title: enabled ? '应用已启用' : '应用已停用',
      color: 'success'
    })
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: enabled ? '启用失败' : '停用失败',
      description: error.data?.message || error.message,
      color: 'error'
    })
  } finally {
    togglingAppIds.value = togglingAppIds.value.filter(id => id !== app.id)
  }
}

async function deleteApp(app: Application) {
  if (!confirm(`确定要删除应用「${app.app_name}」吗？`)) return

  try {
    await $fetch(`/api/applications/${app.id}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', color: 'success' })
    loadApps(pagination.value.page)
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '删除失败', description: error.data?.message || error.message, color: 'error' })
  }
}

async function regenerateSecret(app: Application) {
  if (!confirm('重置密钥后，使用旧密钥的应用将无法访问。确定要重置吗？')) return

  try {
    const res = await $fetch<ApiResponse<{ app_secret: string }>>(`/api/applications/${app.id}/regenerate-secret`, { method: 'POST' })
    newSecret.value = res.data.app_secret
    currentApp.value = app
    showSecretModal.value = true
    toast.add({ title: '密钥已重置', color: 'success' })
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '重置失败', description: error.data?.message || error.message, color: 'error' })
  }
}

function copySecret() {
  navigator.clipboard.writeText(newSecret.value)
  toast.add({ title: '已复制到剪贴板', color: 'success' })
}

const columns = [
  { accessorKey: 'app_name', header: '应用名称' },
  { accessorKey: 'app_code', header: '应用编码' },
  { accessorKey: 'app_type', header: '类型' },
  { accessorKey: 'sso_type', header: 'SSO' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'actions', header: '操作' }
]

onMounted(() => {
  loadApps()
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel grow>
      <div class="flex justify-end gap-2 px-4 py-2 border-b border-default">
        <UInput
          v-model="search"
          placeholder="搜索应用..."
          icon="i-lucide-search"
          size="sm"
          class="w-48"
          @keydown.enter="handleSearch"
        />
        <UButton
          color="neutral"
          size="sm"
          variant="ghost"
          icon="i-lucide-search"
          @click="handleSearch"
        >
          搜索
        </UButton>
        <UButton
          color="primary"
          size="sm"
          icon="i-lucide-plus"
          @click="openCreateModal"
        >
          新建应用
        </UButton>
      </div>

      <div class="p-4">
        <UCard :ui="{ body: 'p-2' }">
          <UTable
            :data="apps"
            :columns="columns"
            :loading="loading"
            empty-state-title="暂无应用"
            sticky
            :ui="{ th: 'py-2', td: 'py-2' }"
            class="w-full h-[calc(100vh-200px)]"
          >
            <template #app_name-cell="{ row }">
              <div class="flex items-center gap-2">
                <div
                  v-if="row.original.icon"
                  class="w-8 h-8 rounded bg-gray-100 flex items-center justify-center"
                >
                  <img :src="row.original.icon" class="w-6 h-6">
                </div>
                <UIcon v-else name="i-lucide-box" class="w-6 h-6 text-gray-400" />
                <span class="font-medium">{{ row.original.app_name }}</span>
              </div>
            </template>

            <template #app_code-cell="{ row }">
              <span class="font-mono text-sm text-gray-500">{{ row.original.app_code }}</span>
            </template>

            <template #app_type-cell="{ row }">
              <UBadge
                :color="row.original.app_type === 'internal' ? 'primary' : 'neutral'"
                variant="subtle"
                size="xs"
              >
                {{ row.original.app_type === 'internal' ? '内部' : '外部' }}
              </UBadge>
            </template>

            <template #sso_type-cell="{ row }">
              <span class="text-sm">{{ row.original.sso_type || '-' }}</span>
            </template>

            <template #status-cell="{ row }">
              <div class="flex items-center gap-2">
                <USwitch
                  :model-value="row.original.status === 1"
                  :disabled="isTogglingStatus(row.original.id)"
                  @update:model-value="toggleAppStatus(row.original, $event)"
                />
                <span class="text-sm text-gray-600 dark:text-gray-300">
                  {{ statusLabels[row.original.status]?.label || '未知' }}
                </span>
              </div>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex items-center gap-1">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-key"
                  @click="regenerateSecret(row.original)"
                >
                  密钥
                </UButton>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  @click="openEditModal(row.original)"
                >
                  编辑
                </UButton>
                <UButton
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  @click="deleteApp(row.original)"
                >
                  删除
                </UButton>
              </div>
            </template>
          </UTable>

          <div
            v-if="!loading && apps.length > 0"
            class="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800"
          >
            <div class="text-sm text-gray-500">
              共 {{ pagination.total }} 个应用
            </div>
            <div class="flex items-center gap-2">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-chevron-left"
                :disabled="pagination.page <= 1"
                @click="loadApps(pagination.page - 1)"
              >
                上一页
              </UButton>
              <span class="text-sm">{{ pagination.page }} / {{ pagination.totalPages }}</span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-chevron-right"
                :disabled="pagination.page >= pagination.totalPages"
                @click="loadApps(pagination.page + 1)"
              >
                下一页
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
    </UDashboardPanel>

    <!-- 创建应用弹窗 -->
    <UModal v-model:open="showCreateModal" :ui="{ content: 'max-w-xl' }">
      <template #content>
        <UCard>
          <template #header>
            <span class="font-medium">新建应用</span>
          </template>
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <UFormField label="应用编码" required>
                <UInput v-model="formData.app_code" placeholder="如：gitlab" />
              </UFormField>
              <UFormField label="应用名称" required>
                <UInput v-model="formData.app_name" placeholder="如：GitLab" />
              </UFormField>
            </div>
            <UFormField label="应用图标">
              <div class="flex items-center gap-3">
                <div class="w-16 h-16 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-900 shrink-0">
                  <img
                    v-if="logoPreview || formData.icon"
                    :src="logoPreview || formData.icon"
                    class="w-full h-full object-contain"
                    alt="应用图标预览"
                  >
                  <UIcon v-else name="i-lucide-image" class="w-8 h-8 text-gray-300" />
                </div>
                <div class="flex flex-col gap-1">
                  <input
                    ref="logoInputRef"
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                    class="hidden"
                    @change="onLogoChange"
                  >
                  <div class="flex gap-2">
                    <UButton
                      size="sm"
                      color="neutral"
                      variant="outline"
                      icon="i-lucide-upload"
                      :loading="logoUploading"
                      @click="triggerLogoInput"
                    >
                      选择图片
                    </UButton>
                    <UButton
                      v-if="logoPreview || formData.icon"
                      size="sm"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-x"
                      @click="clearLogo"
                    >
                      清除
                    </UButton>
                  </div>
                  <p class="text-xs text-gray-400">
                    支持 PNG、JPG、GIF、WebP、SVG，最大 2MB
                  </p>
                </div>
              </div>
            </UFormField>
            <UFormField label="应用首页">
              <UInput v-model="formData.home_url" placeholder="https://..." />
            </UFormField>
            <UFormField label="SSO回调地址">
              <UInput v-model="formData.callback_url" placeholder="https://...?ticket=" />
            </UFormField>
            <div class="grid grid-cols-3 gap-4">
              <UFormField label="应用类型">
                <USelect v-model="formData.app_type" :items="typeOptions" value-key="value" />
              </UFormField>
              <UFormField label="SSO类型">
                <USelect v-model="formData.sso_type" :items="ssoOptions" value-key="value" />
              </UFormField>
              <UFormField label="访问范围">
                <USelect v-model="formData.access_scope" :items="scopeOptions" value-key="value" />
              </UFormField>
            </div>
            <UFormField label="描述">
              <UTextarea v-model="formData.description" :rows="2" />
            </UFormField>
          </div>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="ghost" @click="showCreateModal = false">
                取消
              </UButton>
              <UButton color="primary" :loading="saving || logoUploading" @click="createApp">
                创建
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- 编辑应用弹窗 -->
    <UModal v-model:open="showEditModal" :ui="{ content: 'max-w-xl' }">
      <template #content>
        <UCard>
          <template #header>
            <span class="font-medium">编辑应用</span>
          </template>
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <UFormField label="应用编码">
                <UInput :model-value="formData.app_code" disabled />
              </UFormField>
              <UFormField label="应用名称" required>
                <UInput v-model="formData.app_name" />
              </UFormField>
            </div>
            <UFormField label="应用图标">
              <div class="flex items-center gap-3">
                <div class="w-16 h-16 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-900 shrink-0">
                  <img
                    v-if="logoPreview || formData.icon"
                    :src="logoPreview || formData.icon"
                    class="w-full h-full object-contain"
                    alt="应用图标预览"
                  >
                  <UIcon v-else name="i-lucide-image" class="w-8 h-8 text-gray-300" />
                </div>
                <div class="flex flex-col gap-1">
                  <input
                    ref="logoInputRef"
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                    class="hidden"
                    @change="onLogoChange"
                  >
                  <div class="flex gap-2">
                    <UButton
                      size="sm"
                      color="neutral"
                      variant="outline"
                      icon="i-lucide-upload"
                      :loading="logoUploading"
                      @click="triggerLogoInput"
                    >
                      选择图片
                    </UButton>
                    <UButton
                      v-if="logoPreview || formData.icon"
                      size="sm"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-x"
                      @click="clearLogo"
                    >
                      清除
                    </UButton>
                  </div>
                  <p class="text-xs text-gray-400">
                    支持 PNG、JPG、GIF、WebP、SVG，最大 2MB
                  </p>
                </div>
              </div>
            </UFormField>
            <UFormField label="应用首页">
              <UInput v-model="formData.home_url" />
            </UFormField>
            <UFormField label="SSO回调地址">
              <UInput v-model="formData.callback_url" />
            </UFormField>
            <div class="grid grid-cols-3 gap-4">
              <UFormField label="应用类型">
                <USelect v-model="formData.app_type" :items="typeOptions" value-key="value" />
              </UFormField>
              <UFormField label="SSO类型">
                <USelect v-model="formData.sso_type" :items="ssoOptions" value-key="value" />
              </UFormField>
              <UFormField label="访问范围">
                <USelect v-model="formData.access_scope" :items="scopeOptions" value-key="value" />
              </UFormField>
            </div>
            <UFormField label="描述">
              <UTextarea v-model="formData.description" :rows="2" />
            </UFormField>
          </div>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="ghost" @click="showEditModal = false">
                取消
              </UButton>
              <UButton color="primary" :loading="saving || logoUploading" @click="updateApp">
                保存
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- 密钥显示弹窗 -->
    <UModal v-model:open="showSecretModal">
      <template #content>
        <UCard>
          <template #header>
            <span class="font-medium">应用密钥</span>
          </template>
          <div class="space-y-4">
            <div class="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <div class="flex items-start gap-2">
                <UIcon name="i-lucide-alert-triangle" class="text-yellow-500 mt-0.5" />
                <p class="text-sm text-yellow-700 dark:text-yellow-300">
                  请立即复制保存密钥，关闭后将无法再次查看！
                </p>
              </div>
            </div>
            <UFormField label="App Code">
              <UInput :model-value="currentApp?.app_code" disabled />
            </UFormField>
            <UFormField label="App Secret">
              <div class="flex gap-2">
                <UInput :model-value="newSecret" disabled class="flex-1 font-mono text-sm" />
                <UButton color="primary" icon="i-lucide-copy" @click="copySecret">
                  复制
                </UButton>
              </div>
            </UFormField>
          </div>
          <template #footer>
            <div class="flex justify-end">
              <UButton color="neutral" @click="showSecretModal = false">
                关闭
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
