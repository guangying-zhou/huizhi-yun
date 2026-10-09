<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

usePageTitle('资源管理')

interface Resource {
  id: number
  appId: number
  appCode: string
  appName: string
  resourceCode: string
  resourceName: string
  description: string | null
  sortOrder: number
  status: number
  permissions: string[]
}

interface App {
  id: number
  app_code: string
  app_name: string
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

const toast = useToast()
const loading = ref(false)
const resources = ref<Resource[]>([])
const apps = ref<App[]>([])

// Modal state
const showModal = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const saving = ref(false)
const currentResource = ref<Resource | null>(null)

const formData = ref({
  appId: null as number | null,
  resourceCode: '',
  resourceName: '',
  description: '',
  sortOrder: 0,
  status: 1
})

// Filter
const filterAppId = ref<number | null>(null)

const appOptions = computed(() => [
  { label: '全部应用', value: null },
  ...apps.value.map(a => ({ label: a.app_name, value: a.id }))
])

const formAppOptions = computed(() => [
  { label: '请选择应用', value: null as number | null },
  ...apps.value.map(a => ({ label: a.app_name, value: a.id }))
])

// Filtered resources
const filteredResources = computed(() => {
  if (!filterAppId.value) return resources.value
  return resources.value.filter(r => r.appId === filterAppId.value)
})

const statusLabels: Record<number, { label: string, color: 'success' | 'neutral' }> = {
  1: { label: '启用', color: 'success' },
  0: { label: '禁用', color: 'neutral' }
}

const columns = [
  { accessorKey: 'appName', header: '应用' },
  { accessorKey: 'resourceCode', header: '资源编码' },
  { accessorKey: 'resourceName', header: '资源名称' },
  { accessorKey: 'description', header: '描述' },
  { accessorKey: 'permissions', header: '权限点' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'actions', header: '操作' }
]

async function loadApps() {
  try {
    const res = await $fetch<{ data: { items: App[] } }>('/api/applications', {
      query: { pageSize: 100 }
    })
    apps.value = res.data?.items || []
  } catch (err: unknown) {
    console.error('Load apps failed:', err)
  }
}

async function loadResources() {
  loading.value = true
  try {
    const query: Record<string, string | number> = {}
    if (filterAppId.value) query.app_id = filterAppId.value

    const res = await $fetch<ApiResponse<Resource[]>>('/api/resources', { query })
    resources.value = res.data || []
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '加载失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  modalMode.value = 'create'
  currentResource.value = null
  formData.value = {
    appId: filterAppId.value,
    resourceCode: '',
    resourceName: '',
    description: '',
    sortOrder: 0,
    status: 1
  }
  showModal.value = true
}

function openEditModal(resource: Resource) {
  modalMode.value = 'edit'
  currentResource.value = resource
  formData.value = {
    appId: resource.appId,
    resourceCode: resource.resourceCode,
    resourceName: resource.resourceName,
    description: resource.description || '',
    sortOrder: resource.sortOrder,
    status: resource.status
  }
  showModal.value = true
}

async function saveResource() {
  if (!formData.value.appId) {
    toast.add({ title: '请选择应用', color: 'warning' })
    return
  }
  if (!formData.value.resourceCode || !formData.value.resourceName) {
    toast.add({ title: '请填写资源编码和名称', color: 'warning' })
    return
  }

  saving.value = true
  try {
    if (modalMode.value === 'create') {
      await $fetch('/api/resources', {
        method: 'POST',
        body: formData.value
      })
      toast.add({ title: '创建成功', color: 'success' })
    } else {
      if (!currentResource.value) return
      await $fetch(`/api/resources/${currentResource.value.id}`, {
        method: 'PATCH',
        body: {
          resourceName: formData.value.resourceName,
          description: formData.value.description,
          sortOrder: formData.value.sortOrder,
          status: formData.value.status
        }
      })
      toast.add({ title: '更新成功', color: 'success' })
    }
    showModal.value = false
    loadResources()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '保存失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function deleteResource(resource: Resource) {
  if (!confirm(`确定要删除资源「${resource.resourceName}」吗？相关权限将一并删除。`)) return

  try {
    await $fetch(`/api/resources/${resource.id}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', color: 'success' })
    loadResources()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '删除失败', description: error.data?.message || error.message, color: 'error' })
  }
}

onMounted(() => {
  loadApps()
  loadResources()
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel grow>
      <div class="flex justify-end gap-2 px-4 py-2 border-b border-default">
        <USelectMenu
          v-model="filterAppId"
          :items="appOptions"
          value-key="value"
          label-key="label"
          placeholder="筛选应用"
          size="sm"
          class="w-40"
          @update:model-value="loadResources"
        />
        <UButton
          color="primary"
          size="sm"
          icon="i-lucide-plus"
          @click="openCreateModal"
        >
          新建资源
        </UButton>
        <UButton
          color="neutral"
          size="sm"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="loadResources"
        >
          刷新
        </UButton>
      </div>

      <div class="p-4">
        <UCard :ui="{ body: 'p-0' }">
          <UTable
            :data="filteredResources"
            :columns="columns"
            :loading="loading"
            empty-state-title="暂无资源"
            sticky
            class="w-full max-h-[calc(100vh-200px)]"
          >
            <template #appName-cell="{ row }">
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-box" class="text-primary-500" />
                <span>{{ row.original.appName }}</span>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ row.original.appCode }}
                </UBadge>
              </div>
            </template>

            <template #resourceCode-cell="{ row }">
              <span class="font-mono text-sm text-blue-600 dark:text-blue-400">{{
                row.original.resourceCode }}</span>
            </template>

            <template #resourceName-cell="{ row }">
              <span class="font-medium">{{ row.original.resourceName }}</span>
            </template>

            <template #description-cell="{ row }">
              <span class="text-sm text-gray-500 truncate max-w-48">{{ row.original.description || '-'
              }}</span>
            </template>

            <template #permissions-cell="{ row }">
              <div class="flex flex-wrap gap-1">
                <UBadge
                  v-for="perm in row.original.permissions"
                  :key="perm"
                  color="neutral"
                  variant="soft"
                  size="xs"
                >
                  {{ perm.split(':').pop() }}
                </UBadge>
              </div>
            </template>

            <template #status-cell="{ row }">
              <UBadge :color="statusLabels[row.original.status]?.color || 'neutral'" variant="subtle" size="xs">
                {{ statusLabels[row.original.status]?.label || '未知' }}
              </UBadge>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex items-center gap-1">
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
                  @click="deleteResource(row.original)"
                >
                  删除
                </UButton>
              </div>
            </template>
          </UTable>

          <!-- 底部统计 -->
          <div
            v-if="!loading && filteredResources.length > 0"
            class="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800"
          >
            <div class="text-sm text-gray-500">
              共 {{ filteredResources.length }} 个资源
            </div>
          </div>
        </UCard>
      </div>
    </UDashboardPanel>

    <!-- Create/Edit Modal -->
    <UModal
      v-model:open="showModal"
      :title="modalMode === 'create' ? '新建资源' : '编辑资源'"
      :ui="{ content: 'sm:max-w-lg' }"
    >
      <template #body>
        <div class="space-y-4 p-2">
          <UFormField label="所属应用" required>
            <USelectMenu
              v-model="formData.appId"
              :items="formAppOptions"
              value-key="value"
              label-key="label"
              placeholder="选择应用"
              :disabled="modalMode === 'edit'"
              class="w-full"
            />
          </UFormField>

          <UFormField label="资源编码" required>
            <UInput
              v-model="formData.resourceCode"
              placeholder="如：user, department"
              :disabled="modalMode === 'edit'"
            />
            <template #hint>
              <span class="text-xs text-gray-500">必须以小写字母开头，只能包含小写字母、数字和下划线</span>
            </template>
          </UFormField>

          <UFormField label="资源名称" required>
            <UInput v-model="formData.resourceName" placeholder="如：用户管理" />
          </UFormField>

          <UFormField label="描述">
            <UTextarea v-model="formData.description" placeholder="资源描述..." :rows="2" />
          </UFormField>

          <div class="flex gap-4">
            <UFormField label="排序" class="flex-1">
              <UInput v-model.number="formData.sortOrder" type="number" />
            </UFormField>
            <UFormField label="状态" class="flex-1">
              <USelectMenu
                v-model="formData.status"
                :items="[
                  { label: '启用', value: 1 },
                  { label: '禁用', value: 0 }
                ]"
                value-key="value"
                label-key="label"
              />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="showModal = false"
          />
          <UButton
            :label="modalMode === 'create' ? '创建' : '保存'"
            color="primary"
            :loading="saving"
            @click="saveResource"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
