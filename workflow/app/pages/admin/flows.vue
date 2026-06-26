<template>
  <UDashboardPanel grow>
    <UDashboardNavbar>
      <template #right>
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="搜索编码或名称..."
          class="w-60"
          @keyup.enter="loadList"
        />
        <UButton icon="i-lucide-plus" color="primary" @click="openCreateModal">
          新建
        </UButton>
      </template>
    </UDashboardNavbar>

    <div class="p-4">
      <UTable :data="list" :columns="columns" :loading="loading">
        <template #code-cell="{ row }">
          <span class="font-mono text-sm">{{ row.original.code }}</span>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 1 ? 'success' : 'neutral'"
            variant="subtle"
          >
            {{ row.original.status === 1 ? '启用' : '禁用' }}
          </UBadge>
        </template>

        <template #version-cell="{ row }">
          <span class="text-sm text-gray-600">v{{ row.original.version }}</span>
        </template>

        <template #created_at-cell="{ row }">
          <span class="text-sm text-gray-600">
            {{ formatDateTime(row.original.created_at) }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex items-center gap-1">
            <UButton
              icon="i-lucide-edit"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="openEditModal(row.original)"
            >
              编辑
            </UButton>
            <UButton
              :icon="row.original.status === 1 ? 'i-lucide-toggle-right' : 'i-lucide-toggle-left'"
              size="xs"
              :color="row.original.status === 1 ? 'success' : 'neutral'"
              variant="ghost"
              @click="toggleStatus(row.original)"
            >
              {{ row.original.status === 1 ? '启用' : '禁用' }}
            </UButton>
            <UButton
              icon="i-lucide-trash-2"
              size="xs"
              color="error"
              variant="ghost"
              @click="confirmDelete(row.original)"
            >
              删除
            </UButton>
          </div>
        </template>
      </UTable>

      <div v-if="!loading && list.length === 0" class="flex flex-col items-center justify-center py-12">
        <UIcon name="i-lucide-workflow" class="text-6xl text-gray-300 mb-4" />
        <p class="text-gray-500 mb-4">
          暂无流程定义
        </p>
        <UButton icon="i-lucide-plus" color="primary" @click="openCreateModal">
          创建第一个流程
        </UButton>
      </div>
    </div>

    <!-- 创建/编辑弹窗 -->
    <UModal
      v-model:open="showModal"
      :title="editing ? '编辑流程定义' : '新建流程定义'"
      description="配置审批流程节点定义"
      :ui="{ content: 'w-[calc(100vw-2rem)] sm:max-w-6xl rounded-lg shadow-lg ring ring-default', footer: 'justify-end' }"
    >
      <template #body>
        <div class="space-y-4">
          <div class="grid grid-cols-3 gap-4">
            <UFormField label="流程编码" required>
              <UInput
                v-model="formData.code"
                placeholder="例如：sequential_2level"
              />
            </UFormField>
            <UFormField label="流程名称" required>
              <UInput v-model="formData.name" placeholder="例如：两级审批" />
            </UFormField>
            <UFormField label="流程说明">
              <UInput v-model="formData.description" placeholder="描述该流程的使用场景" />
            </UFormField>
          </div>

          <!-- 编辑模式切换 -->
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-default">审批节点</span>
            <UTabs
              v-model="editMode"
              :items="editModeTabs"
              size="xs"
            />
          </div>

          <!-- 可视化编辑器 -->
          <div v-if="editMode === 'visual'" class="border rounded-lg overflow-hidden" style="height: 380px;">
            <FlowDesigner v-model="designerNodes" />
          </div>

          <!-- JSON 编辑器 -->
          <div v-else>
            <UTextarea
              v-model="formData.nodesJson"
              :rows="18"
              :placeholder="nodesPlaceholder"
              class="font-mono text-sm"
            />
          </div>
        </div>
      </template>

      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" @click="close">
          取消
        </UButton>
        <UButton
          color="primary"
          :loading="saving"
          :disabled="!isFormValid"
          @click="save"
        >
          保存
        </UButton>
      </template>
    </UModal>

    <!-- 删除确认弹窗 -->
    <UModal
      v-model:open="showDeleteConfirm"
      title="确认删除"
      description="此操作不可恢复"
      :ui="{ footer: 'justify-end' }"
    >
      <template #body>
        <div class="p-4">
          <p class="text-muted">
            确定要删除流程定义
            <strong class="text-default">"{{ deleteTarget?.name }}"</strong> 吗？
          </p>
          <p class="text-sm text-muted mt-2">
            删除后不会影响已经发起的流程实例。
          </p>
        </div>
      </template>

      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" @click="close">
          取消
        </UButton>
        <UButton color="error" :loading="deleting" @click="executeDelete">
          确认删除
        </UButton>
      </template>
    </UModal>
  </UDashboardPanel>
</template>

<script setup lang="ts">
import { format } from 'date-fns'

usePageTitle('流程定义管理')

definePageMeta({
  layout: 'default'
})

interface FlowSchema {
  id: number
  code: string
  name: string
  description: string | null
  version: number
  status: number
  created_by: string
  created_at: string
  updated_at: string
}

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const search = ref('')
const list = ref<FlowSchema[]>([])

const showModal = ref(false)
const showDeleteConfirm = ref(false)
const editing = ref<FlowSchema | null>(null)
const deleteTarget = ref<FlowSchema | null>(null)

const columns = [
  { accessorKey: 'code', header: '流程编码' },
  { accessorKey: 'name', header: '流程名称' },
  { accessorKey: 'description', header: '说明' },
  { accessorKey: 'version', header: '版本' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'created_at', header: '创建时间' },
  { id: 'actions', header: '操作' }
]

const nodesPlaceholder = `[
  {
    "name": "直属上级审批",
    "type": "approve",
    "approve_mode": "any",
    "assignees": [
      { "type": "initiator_leader" }
    ]
  },
  {
    "name": "部门负责人审批",
    "type": "approve",
    "approve_mode": "any",
    "assignees": [
      { "type": "role", "code": "dept_manager", "scope": "initiator_dept" }
    ]
  }
]`

const editMode = ref('visual')
const editModeTabs = [
  { label: '可视化', value: 'visual' },
  { label: 'JSON', value: 'json' }
]

const formData = ref({
  code: '',
  name: '',
  description: '',
  nodesJson: ''
})

// 可视化编辑器的节点数据
interface AssigneeDef {
  type: string
  uid?: string
  code?: string
  scope?: string
  dept_code?: string
  field_key?: string
}

interface DesignerNode {
  name: string
  type: string
  approve_mode?: string
  min_pass_count?: number
  assignees: AssigneeDef[]
  skip_when?: Record<string, unknown>
  timeout_hours?: number
  auto_action?: string
}

const designerNodes = ref<DesignerNode[]>([])

// 可视化 → JSON 同步
watch(designerNodes, (val) => {
  if (editMode.value === 'visual' && val.length > 0) {
    formData.value.nodesJson = JSON.stringify(val, null, 2)
  }
}, { deep: true })

// 切换到 JSON 模式时同步
// 切换到可视化模式时从 JSON 解析
watch(editMode, (mode) => {
  if (mode === 'visual') {
    try {
      const parsed = JSON.parse(formData.value.nodesJson)
      if (Array.isArray(parsed)) {
        designerNodes.value = parsed
      }
    } catch {
      // JSON 无效时保持原样
    }
  }
})

const isFormValid = computed(() => {
  if (!formData.value.code || !formData.value.name) return false
  if (editMode.value === 'visual') {
    return designerNodes.value.length > 0
  }
  if (!formData.value.nodesJson) return false
  try {
    const parsed = JSON.parse(formData.value.nodesJson)
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
})

const formatDateTime = (dateStr: string) => {
  if (!dateStr) return '-'
  try {
    return format(new Date(dateStr), 'yyyy-MM-dd HH:mm')
  } catch {
    return dateStr
  }
}

const loadList = async () => {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: { items: FlowSchema[] } }>('/api/v1/admin/flow-schemas', {
      query: { search: search.value, page_size: 100 }
    })
    list.value = res.data?.items || []
  } catch (error) {
    console.error('Failed to load flow schemas:', error)
    toast.add({ title: '加载失败', description: '无法加载流程定义列表', color: 'error' })
  } finally {
    loading.value = false
  }
}

const openCreateModal = () => {
  editing.value = null
  formData.value = { code: '', name: '', description: '', nodesJson: '' }
  designerNodes.value = []
  editMode.value = 'visual'
  showModal.value = true
}

const openEditModal = async (item: FlowSchema) => {
  editing.value = item
  editMode.value = 'visual'
  try {
    const res = await $fetch<{ code: number, data: { nodes: unknown, description: string | null, name: string, code: string } }>(`/api/v1/admin/flow-schemas/${item.id}`)
    const detail = res.data
    const nodesJson = JSON.stringify(detail.nodes, null, 2)
    formData.value = {
      code: detail.code,
      name: detail.name,
      description: detail.description || '',
      nodesJson
    }
    designerNodes.value = Array.isArray(detail.nodes) ? JSON.parse(JSON.stringify(detail.nodes)) : []
  } catch {
    formData.value = {
      code: item.code,
      name: item.name,
      description: item.description || '',
      nodesJson: ''
    }
    designerNodes.value = []
  }
  showModal.value = true
}

const save = async () => {
  if (!isFormValid.value) return
  saving.value = true
  try {
    const nodes = JSON.parse(formData.value.nodesJson)
    if (editing.value) {
      await $fetch(`/api/v1/admin/flow-schemas/${editing.value.id}`, {
        method: 'PATCH',
        body: { code: formData.value.code, name: formData.value.name, description: formData.value.description, nodes }
      })
      toast.add({ title: '更新成功', description: '流程定义已更新', color: 'success' })
    } else {
      await $fetch('/api/v1/admin/flow-schemas', {
        method: 'POST',
        body: { code: formData.value.code, name: formData.value.name, description: formData.value.description, nodes }
      })
      toast.add({ title: '创建成功', description: '流程定义已创建', color: 'success' })
    }
    showModal.value = false
    await loadList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: '保存失败', description: error.data?.message || '保存流程定义失败', color: 'error' })
  } finally {
    saving.value = false
  }
}

const toggleStatus = async (item: FlowSchema) => {
  try {
    await $fetch(`/api/v1/admin/flow-schemas/${item.id}`, {
      method: 'PATCH',
      body: { status: item.status === 1 ? 0 : 1 }
    })
    toast.add({ title: '状态已更新', color: 'success' })
    await loadList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: '更新失败', description: error.data?.message || '更新状态失败', color: 'error' })
  }
}

const confirmDelete = (item: FlowSchema) => {
  deleteTarget.value = item
  showDeleteConfirm.value = true
}

const executeDelete = async () => {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/admin/flow-schemas/${deleteTarget.value.id}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', description: '流程定义已删除', color: 'success' })
    showDeleteConfirm.value = false
    deleteTarget.value = null
    await loadList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: '删除失败', description: error.data?.message || '删除流程定义失败', color: 'error' })
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  loadList()
})
</script>
