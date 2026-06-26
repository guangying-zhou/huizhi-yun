<template>
  <UDashboardPanel grow>
    <div class="flex justify-end gap-2 px-4 py-2 border-b border-default">
      <UButton icon="i-lucide-plus" color="primary" @click="openCreateModal">
        新建流程
      </UButton>
    </div>

    <div class="p-4">
      <!-- 模板列表 -->
      <UTable :data="templates" :columns="columns" :loading="loading">
        <template #name-cell="{ row }">
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ row.original.name }}</span>
            <UBadge v-if="row.original.status === 0" color="neutral" variant="subtle">
              已禁用
            </UBadge>
          </div>
        </template>

        <template #review_type-cell="{ row }">
          <UBadge color="info" variant="subtle">
            {{ row.original.review_type }}
            {{ row.original.sub_type ? ` - ${row.original.sub_type}` : '' }}
          </UBadge>
        </template>

        <template #target_category-cell="{ row }">
          <span class="text-sm">{{ getCategoryLabel(row.original.target_category) }}</span>
        </template>

        <template #nodes-cell="{ row }">
          <span class="text-sm text-gray-600">
            {{ row.original.nodes?.length || 0 }} 个节点
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

      <!-- 空状态 -->
      <div v-if="!loading && templates.length === 0" class="flex flex-col items-center justify-center py-12">
        <UIcon name="i-lucide-workflow" class="text-6xl text-gray-300 mb-4" />
        <p class="text-gray-500 mb-4">
          暂无审批流程模板
        </p>
        <UButton icon="i-lucide-plus" color="primary" @click="openCreateModal">
          创建第一个流程
        </UButton>
      </div>
    </div>

    <!-- 创建/编辑模板弹窗 -->
    <UModal
      v-model:open="showModal"
      :title="editingTemplate ? '编辑流程模板' : '新建流程模板'"
      description="配置审批流程模板"
      :ui="{ content: 'sm:max-w-3xl' }"
    >
      <template #body>
        <div class="space-y-4 p-4">
          <!-- 基本信息 -->
          <UFormField label="流程名称" required>
            <UInput v-model="formData.name" placeholder="例如：对外发文审批流程" />
          </UFormField>

          <div class="grid grid-cols-2 gap-4">
            <UFormField label="审阅类型" required>
              <USelectMenu
                v-model="formData.review_type"
                :items="reviewTypes"
                placeholder="选择审阅类型"
                value-key="value"
                @update:model-value="handleReviewTypeChange"
              />
            </UFormField>

            <UFormField v-if="showSubType" label="子类型" required>
              <USelectMenu
                v-model="formData.sub_type"
                :items="subTypes"
                placeholder="选择子类型"
                value-key="value"
              />
            </UFormField>
          </div>

          <UFormField label="归档目标栏目" required>
            <USelectMenu
              v-model="formData.target_category"
              :items="categories"
              placeholder="选择归档栏目"
              value-key="value"
            />
          </UFormField>

          <!-- 审批节点配置 -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium">审批节点（最多5个）</label>
              <UButton
                icon="i-lucide-plus"
                size="xs"
                color="primary"
                variant="outline"
                :disabled="formData.nodes.length >= 5"
                @click="addNode"
              >
                添加节点
              </UButton>
            </div>

            <div
              v-for="(node, index) in formData.nodes"
              :key="index"
              class="p-4 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                  节点 {{ index + 1 }}
                </span>
                <UButton
                  icon="i-lucide-x"
                  size="xs"
                  color="error"
                  variant="ghost"
                  @click="removeNode(index)"
                />
              </div>

              <UFormField label="节点名称" required>
                <UInput v-model="node.name" placeholder="例如：部门审核" />
              </UFormField>

              <div class="grid grid-cols-2 gap-3">
                <UFormField label="审阅角色" required>
                  <USelectMenu
                    v-model="node.role"
                    :items="roles"
                    placeholder="选择角色"
                    value-key="value"
                  />
                </UFormField>

                <UFormField label="通过条件" required>
                  <USelectMenu
                    v-model="node.pass_type"
                    :items="passTypes"
                    placeholder="选择条件"
                    value-key="value"
                  />
                </UFormField>
              </div>

              <div v-if="node.pass_type === 'all'" class="grid grid-cols-2 gap-3">
                <UFormField label="需要通过人数" required>
                  <UInput
                    v-model.number="node.pass_count"
                    type="number"
                    min="1"
                    placeholder="例如：2"
                  />
                </UFormField>
              </div>

              <div v-if="node.pass_type === 'ratio'" class="grid grid-cols-2 gap-3">
                <UFormField label="通过人数" required>
                  <UInput
                    v-model.number="node.pass_count"
                    type="number"
                    min="1"
                    placeholder="例如：2"
                  />
                </UFormField>
                <UFormField label="总人数" required>
                  <UInput
                    v-model.number="node.pass_total"
                    type="number"
                    min="1"
                    placeholder="例如：3"
                  />
                </UFormField>
              </div>
            </div>

            <p v-if="formData.nodes.length === 0" class="text-sm text-gray-500 text-center py-4">
              请至少添加一个审批节点
            </p>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="closeModal">
            取消
          </UButton>
          <UButton
            color="primary"
            :loading="saving"
            :disabled="!isFormValid"
            @click="saveTemplate"
          >
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 删除确认弹窗 -->
    <UModal v-model:open="showDeleteConfirm" title="确认删除" description="此操作不可恢复">
      <template #body>
        <div class="p-4">
          <p class="text-muted">
            确定要删除流程模板
            <strong class="text-default">"{{ deleteTarget?.name }}"</strong> 吗？
          </p>
          <p class="text-sm text-muted mt-2">
            此操作不可恢复，但不会影响已经提交的审阅流程。
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="showDeleteConfirm = false">
            取消
          </UButton>
          <UButton color="error" :loading="deleting" @click="executeDelete">
            删除
          </UButton>
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

usePageTitle('发文流程管理')

interface ReviewNode {
  index: number
  name: string
  role: string
  pass_type: string
  pass_count: number
  pass_total?: number
}

interface ReviewTemplate {
  id: number
  name: string
  review_type: string
  sub_type?: string
  target_category: string
  nodes: ReviewNode[]
  status: number
}

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const templates = ref<ReviewTemplate[]>([])

const showModal = ref(false)
const showDeleteConfirm = ref(false)
const editingTemplate = ref<ReviewTemplate | null>(null)
const deleteTarget = ref<ReviewTemplate | null>(null)

interface Column {
  accessorKey?: string
  id?: string
  header: string
}

const columns: Column[] = [
  { accessorKey: 'name', header: '流程名称' },
  { accessorKey: 'review_type', header: '审阅类型' },
  { accessorKey: 'target_category', header: '归档目标' },
  { accessorKey: 'nodes', header: '审批节点' },
  { id: 'actions', header: '操作' }
]

const reviewTypes = [
  { label: '对外发文', value: 'outside' },
  { label: '内部公文', value: 'internal' },
  { label: '知识库', value: 'knowledge' },
  { label: '产品资料', value: 'product' },
  { label: '技术规范', value: 'tech_spec' },
  { label: '文档模板', value: 'template' }
]

const internalSubTypes = [
  { label: '公司制度', value: 'company_rule' },
  { label: '部门规章', value: 'dept_rule' },
  { label: '通知公告', value: 'notice' },
  { label: '法务合规', value: 'legal' }
]

const categories = [
  { label: '对外发文', value: 'outside' },
  { label: '公司制度', value: 'company_rule' },
  { label: '通知公告', value: 'notice' },
  { label: '法务合规', value: 'legal' },
  { label: '技术规范', value: 'tech_spec' },
  { label: '产品文档', value: 'product' },
  { label: '知识库', value: 'knowledge' },
  { label: '文档模板', value: 'template' }
]

const roles = [
  { label: '部门经理', value: 'dept_manager' },
  { label: '分管领导', value: 'supervisor' },
  { label: '管理员', value: 'admin' }
]

const passTypes = [
  { label: '全部通过（会签）', value: 'all' },
  { label: '任一通过（或签）', value: 'any' },
  { label: '按比例通过', value: 'ratio' }
]

const formData = ref({
  name: '',
  review_type: '',
  sub_type: undefined as string | undefined,
  target_category: '',
  nodes: [] as ReviewNode[],
  status: 1
})

const showSubType = computed(() => formData.value.review_type === 'internal')
const subTypes = computed(() => internalSubTypes)

const isFormValid = computed(() => {
  return (
    formData.value.name
    && formData.value.review_type
    && formData.value.target_category
    && formData.value.nodes.length > 0
    && formData.value.nodes.every(
      node =>
        node.name
        && node.role
        && node.pass_type
        && (node.pass_type === 'any' || node.pass_count > 0)
        && (node.pass_type !== 'ratio' || (node.pass_total && node.pass_total > 0))
    )
  )
})

// 加载模板列表
const loadTemplates = async () => {
  loading.value = true
  try {
    const { data } = await $fetch<{ data: ReviewTemplate[] }>('/api/reviews/templates')
    templates.value = data || []
  } catch (error) {
    console.error('Failed to load templates:', error)
    toast.add({
      title: '加载失败',
      description: '无法加载流程模板列表',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

// 打开创建弹窗
const openCreateModal = () => {
  editingTemplate.value = null
  formData.value = {
    name: '',
    review_type: '',
    sub_type: undefined,
    target_category: '',
    nodes: [],
    status: 1
  }
  showModal.value = true
}

// 打开编辑弹窗
const openEditModal = (template: ReviewTemplate) => {
  editingTemplate.value = template
  formData.value = {
    name: template.name,
    review_type: template.review_type,
    sub_type: template.sub_type || undefined,
    target_category: template.target_category,
    nodes: JSON.parse(JSON.stringify(template.nodes || [])),
    status: template.status
  }
  showModal.value = true
}

// 关闭弹窗
const closeModal = () => {
  showModal.value = false
  editingTemplate.value = null
}

// 审阅类型变化
const handleReviewTypeChange = () => {
  if (formData.value.review_type !== 'internal') {
    formData.value.sub_type = undefined
  }
}

// 添加节点
const addNode = () => {
  if (formData.value.nodes.length >= 5) return
  formData.value.nodes.push({
    index: formData.value.nodes.length,
    name: '',
    role: '',
    pass_type: 'all',
    pass_count: 1,
    pass_total: undefined
  })
}

// 删除节点
const removeNode = (index: number) => {
  formData.value.nodes.splice(index, 1)
  // 重新设置 index
  formData.value.nodes.forEach((node, i) => {
    node.index = i
  })
}

// 保存模板
const saveTemplate = async () => {
  if (!isFormValid.value) return

  saving.value = true
  try {
    const payload = {
      ...formData.value,
      nodes: formData.value.nodes.map((node, index) => ({
        ...node,
        index
      }))
    }

    if (editingTemplate.value) {
      await $fetch(`/api/reviews/templates/${editingTemplate.value.id}`, {
        method: 'PATCH',
        body: payload
      })
      toast.add({
        title: '更新成功',
        description: '流程模板已更新',
        color: 'success'
      })
    } else {
      await $fetch('/api/reviews/templates', {
        method: 'POST',
        body: payload
      })
      toast.add({
        title: '创建成功',
        description: '流程模板已创建',
        color: 'success'
      })
    }

    closeModal()
    await loadTemplates()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: '保存失败',
      description: error.data?.message || '保存流程模板失败',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

// 切换状态
const toggleStatus = async (template: ReviewTemplate) => {
  try {
    await $fetch(`/api/reviews/templates/${template.id}`, {
      method: 'PATCH',
      body: {
        status: template.status === 1 ? 0 : 1
      }
    })
    toast.add({
      title: '状态已更新',
      color: 'success'
    })
    await loadTemplates()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: '更新失败',
      description: error.data?.message || '更新状态失败',
      color: 'error'
    })
  }
}

// 确认删除
const confirmDelete = (template: ReviewTemplate) => {
  deleteTarget.value = template
  showDeleteConfirm.value = true
}

// 执行删除
const executeDelete = async () => {
  if (!deleteTarget.value) return

  deleting.value = true
  try {
    await $fetch(`/api/reviews/templates/${deleteTarget.value.id}`, {
      method: 'DELETE'
    })
    toast.add({
      title: '删除成功',
      description: '流程模板已删除',
      color: 'success'
    })
    showDeleteConfirm.value = false
    deleteTarget.value = null
    await loadTemplates()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: '删除失败',
      description: error.data?.message || '删除流程模板失败',
      color: 'error'
    })
  } finally {
    deleting.value = false
  }
}

// 辅助函数
const getCategoryLabel = (category: string) => {
  const item = categories.find(c => c.value === category)
  return item?.label || category
}

// 初始加载
onMounted(() => {
  loadTemplates()
})
</script>
