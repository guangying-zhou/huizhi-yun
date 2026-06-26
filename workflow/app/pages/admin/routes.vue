<template>
  <UDashboardPanel grow>
    <UDashboardNavbar>
      <template #right>
        <USelectMenu
          v-model="filterActionDefId"
          :items="actionDefOptions"
          placeholder="按动作筛选"
          value-key="value"
          class="w-60"
          @update:model-value="loadList"
        />
        <UButton icon="i-lucide-plus" color="primary" @click="openCreateModal">
          新建
        </UButton>
      </template>
    </UDashboardNavbar>

    <div class="p-4">
      <UTable :data="list" :columns="columns" :loading="loading">
        <template #action_label-cell="{ row }">
          <span class="font-mono text-sm">
            {{ row.original.action_label }}
          </span>
        </template>

        <template #flow_schema-cell="{ row }">
          <UBadge v-if="row.original.flow_schema?.name" color="info" variant="subtle">
            {{ row.original.flow_schema.name }}
          </UBadge>
          <span v-else class="text-sm text-gray-400">-</span>
        </template>

        <template #level-cell="{ row }">
          <UBadge
            v-if="row.original.level !== null && row.original.level !== undefined"
            :color="row.original.level >= 3 ? 'error' : row.original.level >= 2 ? 'warning' : 'info'"
            variant="subtle"
          >
            {{ reviewLevelLabel[row.original.level] || row.original.level }}
          </UBadge>
          <span v-else class="text-sm text-gray-400">不限</span>
        </template>

        <template #conditions-cell="{ row }">
          <span class="text-sm text-gray-600 truncate max-w-[200px] block">
            {{ formatConditions(row.original.conditions) }}
          </span>
        </template>

        <template #is_default-cell="{ row }">
          <UBadge
            :color="row.original.is_default ? 'warning' : 'neutral'"
            variant="subtle"
          >
            {{ row.original.is_default ? '兜底' : '条件' }}
          </UBadge>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 1 ? 'success' : 'neutral'"
            variant="subtle"
          >
            {{ row.original.status === 1 ? '启用' : '禁用' }}
          </UBadge>
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
        <UIcon name="i-lucide-route" class="text-6xl text-gray-300 mb-4" />
        <p class="text-gray-500 mb-4">
          暂无路由规则
        </p>
        <UButton icon="i-lucide-plus" color="primary" @click="openCreateModal">
          创建第一条规则
        </UButton>
      </div>
    </div>

    <!-- 创建/编辑弹窗 -->
    <UModal
      v-model:open="showModal"
      :title="editing ? '编辑路由规则' : '新建路由规则'"
      description="配置动作到流程的路由匹配规则"
      :ui="{ content: 'w-[calc(100vw-2rem)] sm:max-w-2xl rounded-lg shadow-lg ring ring-default', footer: 'justify-end' }"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="资源动作" required>
            <USelectMenu
              v-model="formData.action_def_id"
              :items="actionDefOptions"
              placeholder="选择资源动作"
              value-key="value"
            />
          </UFormField>

          <UFormField label="审批流程" required>
            <USelectMenu
              v-model="formData.flow_schema_id"
              :items="flowSchemaOptions"
              placeholder="选择审批流程"
              value-key="value"
            />
          </UFormField>

          <UFormField label="评审级别" description="绑定级别后，业务发起审批时按级别自动匹配此流程">
            <USelectMenu
              v-model="formData.level"
              :items="reviewLevelOptions"
              placeholder="不限级别"
              value-key="value"
            />
          </UFormField>

          <UFormField label="规则名称" required>
            <UInput v-model="formData.name" placeholder="例如：委员会发文走表决流程" />
          </UFormField>

          <UFormField label="规则说明">
            <UTextarea v-model="formData.description" placeholder="描述该路由规则的匹配场景" :rows="2" />
          </UFormField>

          <UFormField label="匹配条件（JSON）">
            <UTextarea
              v-model="formData.conditionsJson"
              :rows="6"
              :placeholder="conditionsPlaceholder"
              class="font-mono text-sm"
            />
          </UFormField>

          <div class="grid grid-cols-2 gap-4">
            <UFormField label="优先级">
              <UInput
                v-model.number="formData.priority"
                type="number"
                min="0"
                placeholder="数值越大越优先匹配"
              />
            </UFormField>
            <UFormField label="兜底规则">
              <div class="flex items-center gap-2 pt-2">
                <USwitch v-model="formData.is_default" />
                <span class="text-sm text-gray-600">{{ formData.is_default ? '是（无条件匹配）' : '否（需满足条件）' }}</span>
              </div>
            </UFormField>
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
            确定要删除路由规则
            <strong class="text-default">"{{ deleteTarget?.name }}"</strong> 吗？
          </p>
          <p class="text-sm text-muted mt-2">
            删除后新发起的流程将不再匹配此规则。
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
usePageTitle('路由规则管理')

definePageMeta({
  layout: 'default'
})

interface FlowSchemaRef {
  id: number
  code: string
  name: string
}

interface RouteItem {
  id: number
  action_def_id: number
  flow_schema_id: number
  flow_schema: FlowSchemaRef
  name: string
  description: string | null
  level: number | null
  conditions: Record<string, unknown>
  priority: number
  is_default: number | boolean
  status: number
  action_label: string
  created_by: string
  created_at: string
  updated_at: string
}

const reviewLevelLabel: Record<number, string> = {
  0: '免评审',
  1: '一般',
  2: '重要',
  3: '重大',
  4: '关键'
}

const reviewLevelOptions = [
  { label: '不限级别', value: null as number | null },
  { label: '免评审 (0)', value: 0 },
  { label: '一般 (1)', value: 1 },
  { label: '重要 (2)', value: 2 },
  { label: '重大 (3)', value: 3 },
  { label: '关键 (4)', value: 4 }
]

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const filterActionDefId = ref<number | undefined>(undefined)
const list = ref<RouteItem[]>([])

const showModal = ref(false)
const showDeleteConfirm = ref(false)
const editing = ref<RouteItem | null>(null)
const deleteTarget = ref<RouteItem | null>(null)

const actionDefOptions = ref<{ label: string, value: number }[]>([])
const flowSchemaOptions = ref<{ label: string, value: number }[]>([])
// 用于映射 action_def_id 到显示名称
const actionDefMap = ref<Record<number, string>>({})

const columns = [
  { accessorKey: 'name', header: '规则名称' },
  { accessorKey: 'action_label', header: '资源动作' },
  { accessorKey: 'flow_schema', header: '审批流程' },
  { accessorKey: 'level', header: '评审级别' },
  { accessorKey: 'conditions', header: '匹配条件' },
  { accessorKey: 'priority', header: '优先级' },
  { accessorKey: 'is_default', header: '类型' },
  { accessorKey: 'status', header: '状态' },
  { id: 'actions', header: '操作' }
]

const conditionsPlaceholder = `{
  "dept_org_type": "committee"
}

// 或组合条件：
{
  "dept_org_type": "department",
  "initiator_role": "project_manager"
}

// 兜底规则使用空对象：
{}`

const formData = ref({
  action_def_id: undefined as number | undefined,
  flow_schema_id: undefined as number | undefined,
  level: null as number | null,
  name: '',
  description: '',
  conditionsJson: '',
  priority: 0,
  is_default: false
})

const isFormValid = computed(() => {
  if (!formData.value.action_def_id || !formData.value.flow_schema_id || !formData.value.name) return false
  if (formData.value.conditionsJson) {
    try {
      JSON.parse(formData.value.conditionsJson)
    } catch {
      return false
    }
  }
  return true
})

const formatConditions = (conditions: Record<string, unknown>) => {
  if (!conditions || Object.keys(conditions).length === 0) return '（无条件）'
  const json = JSON.stringify(conditions)
  return json.length > 50 ? json.substring(0, 50) + '...' : json
}

const loadActionDefs = async () => {
  try {
    const res = await $fetch<{ code: number, data: { items: { id: number, resource_code: string, action_code: string, name: string }[] } }>('/api/v1/admin/action-defs', {
      query: { page_size: 200 }
    })
    const items = res.data?.items || []
    actionDefOptions.value = items.map(a => ({
      label: `${a.resource_code}:${a.action_code}（${a.name}）`,
      value: a.id
    }))
    const map: Record<number, string> = {}
    items.forEach((a) => {
      map[a.id] = `${a.resource_code}:${a.action_code}`
    })
    actionDefMap.value = map
  } catch {
    actionDefOptions.value = []
  }
}

const loadFlowSchemas = async () => {
  try {
    const res = await $fetch<{ code: number, data: { items: { id: number, code: string, name: string }[] } }>('/api/v1/admin/flow-schemas', {
      query: { page_size: 200, status: 1 }
    })
    flowSchemaOptions.value = (res.data?.items || []).map(f => ({
      label: `${f.name}（${f.code}）`,
      value: f.id
    }))
  } catch {
    flowSchemaOptions.value = []
  }
}

const loadList = async () => {
  loading.value = true
  try {
    const query: Record<string, unknown> = { page_size: 100 }
    if (filterActionDefId.value) {
      query.action_def_id = filterActionDefId.value
    }
    const res = await $fetch<{ code: number, data: { items: RouteItem[] } }>('/api/v1/admin/routes', { query })
    const items = res.data?.items || []
    list.value = items.map(item => ({
      ...item,
      action_label: actionDefMap.value[item.action_def_id] || String(item.action_def_id)
    }))
  } catch (error) {
    console.error('Failed to load routes:', error)
    toast.add({ title: '加载失败', description: '无法加载路由规则列表', color: 'error' })
  } finally {
    loading.value = false
  }
}

const openCreateModal = () => {
  editing.value = null
  formData.value = {
    action_def_id: undefined,
    flow_schema_id: undefined,
    level: null,
    name: '',
    description: '',
    conditionsJson: '',
    priority: 0,
    is_default: false
  }
  loadFlowSchemas()
  showModal.value = true
}

const openEditModal = (item: RouteItem) => {
  editing.value = item
  formData.value = {
    action_def_id: item.action_def_id,
    flow_schema_id: item.flow_schema_id,
    level: item.level ?? null,
    name: item.name,
    description: item.description || '',
    conditionsJson: item.conditions && Object.keys(item.conditions).length > 0
      ? JSON.stringify(item.conditions, null, 2)
      : '',
    priority: item.priority,
    is_default: !!item.is_default
  }
  loadFlowSchemas()
  showModal.value = true
}

const save = async () => {
  if (!isFormValid.value) return
  saving.value = true
  try {
    let conditions = {}
    if (formData.value.conditionsJson) {
      conditions = JSON.parse(formData.value.conditionsJson)
    }
    const payload = {
      action_def_id: formData.value.action_def_id,
      flow_schema_id: formData.value.flow_schema_id,
      level: formData.value.level,
      name: formData.value.name,
      description: formData.value.description || null,
      conditions,
      priority: formData.value.priority,
      is_default: formData.value.is_default
    }
    if (editing.value) {
      await $fetch(`/api/v1/admin/routes/${editing.value.id}`, {
        method: 'PATCH',
        body: payload
      })
      toast.add({ title: '更新成功', description: '路由规则已更新', color: 'success' })
    } else {
      await $fetch('/api/v1/admin/routes', {
        method: 'POST',
        body: payload
      })
      toast.add({ title: '创建成功', description: '路由规则已创建', color: 'success' })
    }
    showModal.value = false
    await loadList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: '保存失败', description: error.data?.message || '保存路由规则失败', color: 'error' })
  } finally {
    saving.value = false
  }
}

const toggleStatus = async (item: RouteItem) => {
  try {
    await $fetch(`/api/v1/admin/routes/${item.id}`, {
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

const confirmDelete = (item: RouteItem) => {
  deleteTarget.value = item
  showDeleteConfirm.value = true
}

const executeDelete = async () => {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/admin/routes/${deleteTarget.value.id}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', description: '路由规则已删除', color: 'success' })
    showDeleteConfirm.value = false
    deleteTarget.value = null
    await loadList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: '删除失败', description: error.data?.message || '删除路由规则失败', color: 'error' })
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  await loadActionDefs()
  await loadList()
})
</script>
