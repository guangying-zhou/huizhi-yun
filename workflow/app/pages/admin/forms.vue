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

        <template #field_count-cell="{ row }">
          <UBadge color="info" variant="subtle">
            {{ row.original.field_count }} 个字段
          </UBadge>
        </template>

        <template #version-cell="{ row }">
          <span class="text-sm text-gray-600">v{{ row.original.version }}</span>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 1 ? 'success' : 'neutral'"
            variant="subtle"
          >
            {{ row.original.status === 1 ? '启用' : '禁用' }}
          </UBadge>
        </template>

        <template #created_at-cell="{ row }">
          <span class="text-sm text-gray-600">
            {{ formatDateTime(row.original.created_at) }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex items-center gap-1">
            <UButton
              icon="i-lucide-eye"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="openPreviewModal(row.original)"
            >
              预览
            </UButton>
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
        <UIcon name="i-lucide-file-input" class="text-6xl text-gray-300 mb-4" />
        <p class="text-gray-500 mb-4">
          暂无表单定义
        </p>
        <UButton icon="i-lucide-plus" color="primary" @click="openCreateModal">
          创建第一个表单
        </UButton>
      </div>
    </div>

    <!-- 创建/编辑弹窗 -->
    <UModal
      v-model:open="showModal"
      :title="editing ? '编辑表单定义' : '新建表单定义'"
      description="配置动态表单字段定义"
      :ui="{ content: 'w-[calc(100vw-2rem)] sm:max-w-4xl rounded-lg shadow-lg ring ring-default', footer: 'justify-end' }"
    >
      <template #body>
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="表单编码" required>
              <UInput
                v-model="formData.code"
                placeholder="例如：document_publish_form"
                :disabled="!!editing"
              />
            </UFormField>
            <UFormField label="表单名称" required>
              <UInput v-model="formData.name" placeholder="例如：发文审批表单" />
            </UFormField>
          </div>

          <UFormField label="表单说明">
            <UTextarea v-model="formData.description" placeholder="描述该表单的使用场景" :rows="2" />
          </UFormField>

          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-default">字段定义</span>
            <UTabs
              v-model="editMode"
              :items="editModeTabs"
              size="xs"
            />
          </div>

          <!-- JSON 编辑器 -->
          <UFormField v-if="editMode === 'json'" label="" required>
            <UTextarea
              v-model="formData.fieldsJson"
              :rows="14"
              :placeholder="fieldsPlaceholder"
              class="font-mono text-sm"
            />
          </UFormField>

          <!-- 表单预览 -->
          <div v-else class="border rounded-lg p-6 bg-gray-50/50 dark:bg-gray-900/30 min-h-[360px]">
            <FormPreview
              :fields="previewFields"
              :title="formData.name || '未命名表单'"
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

    <!-- 预览弹窗 -->
    <UModal
      v-model:open="showPreviewModal"
      :title="`表单预览 - ${previewTarget?.name || ''}`"
      description="预览表单的实际渲染效果"
      :ui="{ content: 'w-[calc(100vw-2rem)] sm:max-w-2xl rounded-lg shadow-lg ring ring-default', footer: 'justify-end' }"
    >
      <template #body>
        <div class="p-4">
          <FormPreview
            :fields="previewTargetFields"
            empty-text="该表单暂无字段定义"
          />
        </div>
      </template>

      <template #footer="{ close }">
        <UButton color="neutral" variant="outline" @click="close">
          关闭
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
            确定要删除表单定义
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
import type { FormField } from '~/types/workflow'

usePageTitle('表单定义管理')

definePageMeta({
  layout: 'default'
})

interface FormSchemaRaw {
  id: number
  code: string
  name: string
  description: string | null
  fields?: unknown[]
  version: number
  status: number
  created_by: string
  created_at: string
  updated_at: string
}

interface FormSchemaItem extends FormSchemaRaw {
  field_count: number
}

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const search = ref('')
const list = ref<FormSchemaItem[]>([])

const showModal = ref(false)
const showDeleteConfirm = ref(false)
const showPreviewModal = ref(false)
const editing = ref<FormSchemaItem | null>(null)
const deleteTarget = ref<FormSchemaItem | null>(null)
const previewTarget = ref<FormSchemaItem | null>(null)
const previewTargetFields = ref<FormField[]>([])

// 缓存详情数据，避免重复请求
const detailCache = ref<Record<number, { fields: unknown[] }>>({})

const columns = [
  { accessorKey: 'code', header: '表单编码' },
  { accessorKey: 'name', header: '表单名称' },
  { accessorKey: 'description', header: '说明' },
  { accessorKey: 'field_count', header: '字段数' },
  { accessorKey: 'version', header: '版本' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'created_at', header: '创建时间' },
  { id: 'actions', header: '操作' }
]

const fieldsPlaceholder = `[
  {
    "key": "title",
    "label": "文档标题",
    "type": "text",
    "required": true,
    "readonly": true,
    "source": "biz"
  },
  {
    "key": "urgency",
    "label": "紧急程度",
    "type": "select",
    "required": true,
    "default_value": "normal",
    "options": [
      { "label": "普通", "value": "normal" },
      { "label": "紧急", "value": "urgent" }
    ]
  },
  {
    "key": "reason",
    "label": "申请说明",
    "type": "textarea",
    "required": true,
    "max_length": 500
  }
]`

const editMode = ref('json')
const editModeTabs = [
  { label: 'JSON', value: 'json' },
  { label: '预览', value: 'preview' }
]

const formData = ref({
  code: '',
  name: '',
  description: '',
  fieldsJson: ''
})

const previewFields = computed<FormField[]>(() => {
  try {
    const parsed = JSON.parse(formData.value.fieldsJson)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // JSON 无效时返回空
  }
  return []
})

const isFormValid = computed(() => {
  if (!formData.value.code || !formData.value.name || !formData.value.fieldsJson) return false
  try {
    const parsed = JSON.parse(formData.value.fieldsJson)
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
    const res = await $fetch<{ code: number, data: { items: FormSchemaRaw[] } }>('/api/v1/admin/form-schemas', {
      query: { search: search.value, page_size: 100 }
    })
    const items = res.data?.items || []
    list.value = items.map(item => ({
      ...item,
      field_count: Array.isArray(item.fields) ? item.fields.length : 0
    }))
  } catch (error) {
    console.error('Failed to load form schemas:', error)
    toast.add({ title: '加载失败', description: '无法加载表单定义列表', color: 'error' })
  } finally {
    loading.value = false
  }
}

const fetchDetail = async (id: number) => {
  if (detailCache.value[id]) return detailCache.value[id]
  try {
    const res = await $fetch<{ code: number, data: { fields: unknown[] } }>(`/api/v1/admin/form-schemas/${id}`)
    detailCache.value[id] = { fields: res.data?.fields || [] }
    return detailCache.value[id]
  } catch {
    return { fields: [] }
  }
}

const openPreviewModal = async (item: FormSchemaItem) => {
  previewTarget.value = item
  const detail = await fetchDetail(item.id)
  previewTargetFields.value = Array.isArray(detail.fields) ? detail.fields as FormField[] : []
  showPreviewModal.value = true
}

const openCreateModal = () => {
  editing.value = null
  formData.value = { code: '', name: '', description: '', fieldsJson: '' }
  editMode.value = 'json'
  showModal.value = true
}

const openEditModal = async (item: FormSchemaItem) => {
  editing.value = item
  editMode.value = 'json'
  const detail = await fetchDetail(item.id)
  formData.value = {
    code: item.code,
    name: item.name,
    description: item.description || '',
    fieldsJson: JSON.stringify(detail.fields, null, 2)
  }
  showModal.value = true
}

const save = async () => {
  if (!isFormValid.value) return
  saving.value = true
  try {
    const fields = JSON.parse(formData.value.fieldsJson)
    if (editing.value) {
      await $fetch(`/api/v1/admin/form-schemas/${editing.value.id}`, {
        method: 'PATCH',
        body: { name: formData.value.name, description: formData.value.description, fields }
      })
      // 清除缓存
      const { [editing.value.id]: _removed, ...rest } = detailCache.value
      detailCache.value = rest
      toast.add({ title: '更新成功', description: '表单定义已更新', color: 'success' })
    } else {
      await $fetch('/api/v1/admin/form-schemas', {
        method: 'POST',
        body: { code: formData.value.code, name: formData.value.name, description: formData.value.description, fields }
      })
      toast.add({ title: '创建成功', description: '表单定义已创建', color: 'success' })
    }
    showModal.value = false
    await loadList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: '保存失败', description: error.data?.message || '保存表单定义失败', color: 'error' })
  } finally {
    saving.value = false
  }
}

const toggleStatus = async (item: FormSchemaItem) => {
  try {
    await $fetch(`/api/v1/admin/form-schemas/${item.id}`, {
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

const confirmDelete = (item: FormSchemaItem) => {
  deleteTarget.value = item
  showDeleteConfirm.value = true
}

const executeDelete = async () => {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/admin/form-schemas/${deleteTarget.value.id}`, { method: 'DELETE' })
    const { [deleteTarget.value.id]: _removed, ...rest } = detailCache.value
    detailCache.value = rest
    toast.add({ title: '删除成功', description: '表单定义已删除', color: 'success' })
    showDeleteConfirm.value = false
    deleteTarget.value = null
    await loadList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: '删除失败', description: error.data?.message || '删除表单定义失败', color: 'error' })
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  loadList()
})
</script>
