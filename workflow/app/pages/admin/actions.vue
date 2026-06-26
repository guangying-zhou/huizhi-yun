<template>
  <UDashboardPanel grow>
    <UDashboardNavbar>
      <template #right>
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="搜索业务编码或名称..."
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
        <template #app_code-cell="{ row }">
          <span class="font-mono text-sm">{{ row.original.app_code }}</span>
        </template>

        <template #biz_key-cell="{ row }">
          <span class="font-mono text-xs text-muted">
            {{ row.original.resource_code }}:{{ row.original.action_code }}
          </span>
        </template>

        <template #flow_schema-cell="{ row }">
          <UBadge
            v-if="row.original.flow_schema_name"
            color="primary"
            variant="subtle"
            size="xs"
          >
            {{ row.original.flow_schema_name }}
          </UBadge>
          <span v-else class="text-sm text-dimmed">未关联</span>
        </template>

        <template #form_schema-cell="{ row }">
          <UBadge
            v-if="row.original.form_schema"
            color="info"
            variant="subtle"
            size="xs"
          >
            {{ row.original.form_schema.name }}
          </UBadge>
          <span v-else class="text-sm text-dimmed">无</span>
        </template>

        <template #source-cell="{ row }">
          <UBadge
            :color="row.original.source === 'sync' ? 'info' : 'neutral'"
            variant="subtle"
            size="xs"
          >
            {{ row.original.source === 'sync' ? '自动注册' : '手动创建' }}
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
              variant="ghost"
              color="neutral"
              @click="toggleStatus(row.original)"
            >
              {{ row.original.status === 1 ? '禁用' : '启用' }}
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
        <UIcon name="i-lucide-git-pull-request" class="text-6xl text-dimmed mb-4" />
        <p class="text-muted mb-4">
          暂无审批业务定义
        </p>
        <UButton icon="i-lucide-plus" color="primary" @click="openCreateModal">
          创建第一个审批业务
        </UButton>
      </div>
    </div>

    <!-- 创建/编辑弹窗 -->
    <UModal
      v-model:open="showModal"
      :title="editing ? '编辑审批业务' : '新建审批业务'"
      description="配置审批业务及关联流程"
      :ui="{ content: 'w-[calc(100vw-2rem)] sm:max-w-2xl rounded-lg shadow-lg ring ring-default', footer: 'justify-end' }"
    >
      <template #body>
        <div class="space-y-4">
          <!-- 基本信息 -->
          <div class="grid grid-cols-3 gap-4">
            <UFormField label="应用编码" required>
              <UInput
                v-model="formData.app_code"
                placeholder="例如：aims"
                :disabled="!!editing"
              />
            </UFormField>
            <UFormField label="资源编码" required>
              <UInput
                v-model="formData.resource_code"
                placeholder="例如：project"
                :disabled="!!editing"
              />
            </UFormField>
            <UFormField label="动作编码" required>
              <UInput
                v-model="formData.action_code"
                placeholder="例如：initiation"
                :disabled="!!editing"
              />
            </UFormField>
          </div>

          <UFormField label="业务名称" required>
            <UInput v-model="formData.name" placeholder="例如：项目立项审批" />
          </UFormField>

          <UFormField label="业务说明">
            <UTextarea v-model="formData.description" placeholder="描述该审批业务的使用场景" :rows="2" />
          </UFormField>

          <!-- 关联流程 -->
          <UFormField label="审批流程" required>
            <div class="space-y-2">
              <!-- 流程来源选择 -->
              <div class="flex gap-2">
                <UButton
                  size="sm"
                  :color="flowSource === 'template' ? 'primary' : 'neutral'"
                  :variant="flowSource === 'template' ? 'soft' : 'outline'"
                  @click="flowSource = 'template'"
                >
                  <UIcon name="i-lucide-copy" class="size-3.5 mr-1" />
                  使用模板
                </UButton>
                <UButton
                  size="sm"
                  :color="flowSource === 'custom' ? 'primary' : 'neutral'"
                  :variant="flowSource === 'custom' ? 'soft' : 'outline'"
                  @click="flowSource = 'custom'"
                >
                  <UIcon name="i-lucide-git-branch" class="size-3.5 mr-1" />
                  选择已有流程
                </UButton>
              </div>

              <!-- 模板选择 -->
              <div v-if="flowSource === 'template'" class="space-y-2">
                <div
                  v-for="tpl in templates"
                  :key="tpl.id"
                  class="flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors"
                  :class="formData.flow_schema_id === tpl.id
                    ? 'border-primary bg-primary/5'
                    : 'border-default hover:bg-elevated'"
                  @click="formData.flow_schema_id = tpl.id"
                >
                  <div class="flex items-center justify-center size-8 rounded-full bg-primary/10">
                    <UIcon name="i-lucide-workflow" class="size-4 text-primary" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium">
                      {{ tpl.name }}
                    </div>
                    <div class="text-xs text-muted truncate">
                      {{ tpl.description }} · {{ tpl.node_count }} 个节点
                    </div>
                  </div>
                  <UIcon
                    v-if="formData.flow_schema_id === tpl.id"
                    name="i-lucide-check-circle"
                    class="size-5 text-primary shrink-0"
                  />
                </div>
                <p v-if="templates.length === 0" class="text-sm text-dimmed py-2">
                  暂无可用模板，请在流程定义中创建模板
                </p>
              </div>

              <!-- 已有流程选择 -->
              <USelectMenu
                v-if="flowSource === 'custom'"
                v-model="formData.flow_schema_id"
                :items="flowSchemaOptions"
                placeholder="选择已有流程定义"
                value-key="value"
              />
            </div>
          </UFormField>

          <!-- 关联表单 -->
          <UFormField label="关联表单">
            <USelectMenu
              v-model="formData.form_schema_id"
              :items="formSchemaOptions"
              placeholder="选择关联表单（可选）"
              value-key="value"
            />
          </UFormField>

          <!-- 嵌入URL -->
          <UFormField label="业务详情 URL 模式" help="审批时展示业务详情的页面地址，支持变量：{app_base_url} {resource_code} {biz_id}">
            <UInput v-model="formData.embed_url_pattern" placeholder="例如：{app_base_url}/embed/project/{biz_id}" />
          </UFormField>

          <div class="grid grid-cols-2 gap-4">
            <UFormField label="图标">
              <UInput v-model="formData.icon" placeholder="例如：i-lucide-send" />
            </UFormField>
            <UFormField label="排序序号">
              <UInput
                v-model.number="formData.sort_order"
                type="number"
                min="0"
                placeholder="0"
              />
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
            确定要删除审批业务
            <strong class="text-default">"{{ deleteTarget?.name }}"</strong>
            （{{ deleteTarget?.resource_code }}:{{ deleteTarget?.action_code }}）吗？
          </p>
          <p class="text-sm text-muted mt-2">
            删除后关联的路由规则也将失效。
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
usePageTitle('审批业务管理')

definePageMeta({
  layout: 'default'
})

interface FormSchemaRef {
  id: number
  code: string
  name: string
}

interface FlowTemplate {
  id: number
  code: string
  name: string
  description: string | null
  node_count: number
}

interface ActionDef {
  id: number
  app_code: string
  resource_code: string
  action_code: string
  name: string
  description: string | null
  form_schema_id: number | null
  form_schema: FormSchemaRef | null
  flow_schema_name: string | null
  embed_url_pattern: string | null
  icon: string | null
  sort_order: number
  status: number
  source: 'manual' | 'sync'
  created_by: string
  created_at: string
  updated_at: string
}

const toast = useToast()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const search = ref('')
const list = ref<ActionDef[]>([])

const showModal = ref(false)
const showDeleteConfirm = ref(false)
const editing = ref<ActionDef | null>(null)
const deleteTarget = ref<ActionDef | null>(null)

const formSchemaOptions = ref<{ label: string, value: number }[]>([])
const flowSchemaOptions = ref<{ label: string, value: number }[]>([])
const templates = ref<FlowTemplate[]>([])
const flowSource = ref<'template' | 'custom'>('template')

const columns = [
  { accessorKey: 'app_code', header: '应用' },
  { accessorKey: 'biz_key', header: '资源:动作' },
  { accessorKey: 'name', header: '业务名称' },
  { accessorKey: 'flow_schema', header: '关联流程' },
  { accessorKey: 'form_schema', header: '关联表单' },
  { accessorKey: 'source', header: '来源' },
  { accessorKey: 'status', header: '状态' },
  { id: 'actions', header: '操作' }
]

const formData = ref({
  app_code: '',
  resource_code: '',
  action_code: '',
  name: '',
  description: '',
  form_schema_id: undefined as number | undefined,
  flow_schema_id: undefined as number | undefined,
  embed_url_pattern: '',
  icon: '',
  sort_order: 0
})

const isFormValid = computed(() => {
  return !!formData.value.app_code
    && !!formData.value.resource_code
    && !!formData.value.action_code
    && !!formData.value.name
    && !!formData.value.flow_schema_id
})

const loadFormSchemas = async () => {
  try {
    const res = await $fetch<{ code: number, data: { items: { id: number, name: string, code: string }[] } }>('/api/v1/admin/form-schemas', {
      query: { page_size: 200, status: 1 }
    })
    formSchemaOptions.value = (res.data?.items || []).map(f => ({
      label: `${f.name}（${f.code}）`,
      value: f.id
    }))
  } catch {
    formSchemaOptions.value = []
  }
}

const loadFlowSchemas = async () => {
  try {
    // 加载非模板的流程定义
    const res = await $fetch<{ code: number, data: { items: { id: number, name: string, code: string }[] } }>('/api/v1/admin/flow-schemas', {
      query: { page_size: 200, status: 1, is_template: 0 }
    })
    flowSchemaOptions.value = (res.data?.items || []).map(f => ({
      label: `${f.name}（${f.code}）`,
      value: f.id
    }))
  } catch {
    flowSchemaOptions.value = []
  }
}

const loadTemplates = async () => {
  try {
    const res = await $fetch<{ code: number, data: FlowTemplate[] }>('/api/v1/admin/flow-schemas/templates')
    templates.value = res.data || []
  } catch {
    templates.value = []
  }
}

const loadList = async () => {
  loading.value = true
  try {
    const res = await $fetch<{ code: number, data: { items: ActionDef[] } }>('/api/v1/admin/action-defs', {
      query: { search: search.value, page_size: 100 }
    })
    list.value = res.data?.items || []
  } catch (error) {
    console.error('Failed to load action defs:', error)
    toast.add({ title: '加载失败', description: '无法加载审批业务列表', color: 'error' })
  } finally {
    loading.value = false
  }
}

const openCreateModal = () => {
  editing.value = null
  formData.value = {
    app_code: '',
    resource_code: '',
    action_code: '',
    name: '',
    description: '',
    form_schema_id: undefined,
    flow_schema_id: undefined,
    embed_url_pattern: '',
    icon: '',
    sort_order: 0
  }
  flowSource.value = 'template'
  loadFormSchemas()
  loadFlowSchemas()
  loadTemplates()
  showModal.value = true
}

const openEditModal = (item: ActionDef) => {
  editing.value = item
  formData.value = {
    app_code: item.app_code,
    resource_code: item.resource_code,
    action_code: item.action_code,
    name: item.name,
    description: item.description || '',
    form_schema_id: item.form_schema_id ?? undefined,
    flow_schema_id: undefined, // 编辑时需要从路由中获取
    embed_url_pattern: item.embed_url_pattern || '',
    icon: item.icon || '',
    sort_order: item.sort_order
  }
  flowSource.value = 'custom'
  loadFormSchemas()
  loadFlowSchemas()
  loadTemplates()
  // 加载当前关联的流程（从路由中获取）
  loadCurrentRoute(item.id)
  showModal.value = true
}

const loadCurrentRoute = async (actionDefId: number) => {
  try {
    const res = await $fetch<{ code: number, data: { items: { flow_schema_id: number }[] } }>('/api/v1/admin/routes', {
      query: { action_def_id: actionDefId, page_size: 1 }
    })
    const items = res.data?.items
    if (items?.length) {
      formData.value.flow_schema_id = items[0]!.flow_schema_id
    }
  } catch {
    // silent
  }
}

const save = async () => {
  if (!isFormValid.value) return
  saving.value = true
  try {
    const payload = {
      app_code: formData.value.app_code,
      resource_code: formData.value.resource_code,
      action_code: formData.value.action_code,
      name: formData.value.name,
      description: formData.value.description || null,
      form_schema_id: formData.value.form_schema_id || null,
      embed_url_pattern: formData.value.embed_url_pattern || null,
      icon: formData.value.icon || null,
      sort_order: formData.value.sort_order
    }

    let actionDefId: number

    if (editing.value) {
      await $fetch(`/api/v1/admin/action-defs/${editing.value.id}`, {
        method: 'PATCH',
        body: payload
      })
      actionDefId = editing.value.id
      toast.add({ title: '更新成功', color: 'success' })
    } else {
      const res = await $fetch<{ code: number, data: { id: number } }>('/api/v1/admin/action-defs', {
        method: 'POST',
        body: payload
      })
      actionDefId = res.data.id
      toast.add({ title: '创建成功', color: 'success' })
    }

    // 自动创建/更新默认路由（关联流程）
    if (formData.value.flow_schema_id) {
      await ensureDefaultRoute(actionDefId, formData.value.flow_schema_id)
    }

    showModal.value = false
    await loadList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: '保存失败', description: error.data?.message || '保存审批业务失败', color: 'error' })
  } finally {
    saving.value = false
  }
}

interface RouteRow {
  id: number
  flow_schema_id: number
  is_default: number
}

/**
 * 确保 action_def 有一个默认路由指向指定的 flow_schema
 */
const ensureDefaultRoute = async (actionDefId: number, flowSchemaId: number) => {
  try {
    // 查询是否已有默认路由
    const res = await $fetch<{ code: number, data: { items: RouteRow[] } }>('/api/v1/admin/routes', {
      query: { action_def_id: actionDefId, page_size: 10 }
    })

    const existingDefault = res.data?.items?.find((r: RouteRow) => r.is_default === 1)

    if (existingDefault) {
      // 更新已有默认路由的 flow_schema_id
      if (existingDefault.flow_schema_id !== flowSchemaId) {
        await $fetch(`/api/v1/admin/routes/${existingDefault.id}`, {
          method: 'PATCH',
          body: { flow_schema_id: flowSchemaId }
        })
      }
    } else {
      // 创建默认路由
      await $fetch('/api/v1/admin/routes', {
        method: 'POST',
        body: {
          action_def_id: actionDefId,
          flow_schema_id: flowSchemaId,
          name: '默认路由',
          conditions: {},
          priority: 100,
          is_default: 1
        }
      })
    }
  } catch (err) {
    console.error('创建默认路由失败:', err)
  }
}

const toggleStatus = async (item: ActionDef) => {
  try {
    await $fetch(`/api/v1/admin/action-defs/${item.id}`, {
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

const confirmDelete = (item: ActionDef) => {
  deleteTarget.value = item
  showDeleteConfirm.value = true
}

const executeDelete = async () => {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/admin/action-defs/${deleteTarget.value.id}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', color: 'success' })
    showDeleteConfirm.value = false
    deleteTarget.value = null
    await loadList()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: '删除失败', description: error.data?.message || '删除审批业务失败', color: 'error' })
  } finally {
    deleting.value = false
  }
}

onMounted(() => {
  loadList()
})
</script>
