<script setup lang="ts">
usePageTitle('模板管理')

type TemplateType = 'job' | 'duty' | 'base' | 'management'
type TemplateStatus = 'active' | 'suspended' | 'disabled'

interface TemplateItem {
  id: number
  tenantCode: string | null
  templateCode: string
  templateName: string
  templateType: TemplateType
  description: string | null
  status: TemplateStatus
  sortOrder: number
  createdAt?: string
  updatedAt?: string
}

interface TemplateRoleItem {
  roleId?: number
  roleCode: string
  roleName?: string
  roleType?: string
  appCode?: string | null
  sortOrder: number
}

interface TemplateListResponse {
  items: TemplateItem[]
  total: number
  page: number
  pageSize: number
}

const route = useRoute()
const router = useRouter()
const { currentTenantCode, setCurrentTenantCode } = useTenantContext()
const isDashboardRoute = computed(() => route.path.startsWith('/dashboard'))
const apiPrefix = computed(() => isDashboardRoute.value ? '/api/platform/tenant-admin' : '/api/platform/ops')

const templateTypeOptions = [
  { value: '', label: '全部类型' },
  { value: 'job', label: '岗位模板' },
  { value: 'duty', label: '职责模板' },
  { value: 'base', label: '基础模板' },
  { value: 'management', label: '管理模板' }
]

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'suspended', label: '暂停' },
  { value: 'disabled', label: '停用' }
]

const filters = reactive({
  tenantCode: typeof route.query.tenantCode === 'string' ? route.query.tenantCode : currentTenantCode.value,
  keyword: '',
  templateType: '',
  status: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const templates = ref<TemplateItem[]>([])
const selectedTemplateId = ref<number | null>(null)
const templateRoles = ref<TemplateRoleItem[]>([])
const listPending = ref(false)
const formPending = ref(false)
const rolesPending = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)

const form = reactive({
  tenantCode: filters.tenantCode,
  templateCode: '',
  templateName: '',
  templateType: 'job' as TemplateType,
  description: '',
  status: 'active' as TemplateStatus,
  sortOrder: 0
})

const pageCount = computed(() => Math.max(1, Math.ceil((pagination.total || 0) / pagination.pageSize)))
const selectedTemplate = computed(() => templates.value.find(item => item.id === selectedTemplateId.value) || null)
const hasTenantContext = computed(() => !!filters.tenantCode.trim())

function resetNotice() {
  notice.value = null
}

function emptyRoleRow(sortOrder = (templateRoles.value.length + 1) * 10): TemplateRoleItem {
  return {
    roleCode: '',
    sortOrder
  }
}

function resetForm() {
  formMode.value = 'create'
  selectedTemplateId.value = null
  form.tenantCode = filters.tenantCode
  form.templateCode = ''
  form.templateName = ''
  form.templateType = 'job'
  form.description = ''
  form.status = 'active'
  form.sortOrder = 0
  templateRoles.value = [emptyRoleRow(10)]
}

function fillForm(template: TemplateItem) {
  formMode.value = 'edit'
  selectedTemplateId.value = template.id
  form.tenantCode = template.tenantCode || filters.tenantCode
  form.templateCode = template.templateCode
  form.templateName = template.templateName
  form.templateType = template.templateType
  form.description = template.description || ''
  form.status = template.status
  form.sortOrder = template.sortOrder
}

function syncTenantQuery() {
  setCurrentTenantCode(filters.tenantCode)
  router.replace({
    query: {
      ...route.query,
      tenantCode: filters.tenantCode || undefined
    }
  })
}

async function loadTemplates() {
  if (!filters.tenantCode.trim()) {
    templates.value = []
    pagination.total = 0
    selectedTemplateId.value = null
    if (formMode.value === 'edit') {
      resetForm()
    }
    return
  }

  listPending.value = true
  resetNotice()

  try {
    const response = await platformFetchJson<{ success: true, data: TemplateListResponse }>(`${apiPrefix.value}/templates`, {
      query: {
        tenantCode: filters.tenantCode.trim(),
        keyword: filters.keyword || undefined,
        templateType: filters.templateType || undefined,
        status: filters.status || undefined,
        page: pagination.page,
        pageSize: pagination.pageSize
      }
    })

    templates.value = response.data.items
    pagination.total = response.data.total

    if (selectedTemplateId.value && !templates.value.some(item => item.id === selectedTemplateId.value)) {
      selectedTemplateId.value = null
      if (formMode.value === 'edit') {
        resetForm()
      }
    }
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '模板列表加载失败'
    }
  } finally {
    listPending.value = false
  }
}

async function loadTemplateRoles(templateId: number) {
  rolesPending.value = true

  try {
    const response = await platformFetchJson<{ success: true, data: { items: TemplateRoleItem[] } }>(`${apiPrefix.value}/templates/${templateId}/roles`)
    templateRoles.value = response.data.items.length > 0
      ? response.data.items.map(item => ({
          roleId: item.roleId,
          roleCode: item.roleCode,
          roleName: item.roleName,
          roleType: item.roleType,
          appCode: item.appCode,
          sortOrder: item.sortOrder
        }))
      : [emptyRoleRow(10)]
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '模板角色加载失败'
    }
    templateRoles.value = [emptyRoleRow(10)]
  } finally {
    rolesPending.value = false
  }
}

const debouncedReload = useDebounceFn(() => {
  pagination.page = 1
  loadTemplates()
}, 250)

watch(() => filters.keyword, debouncedReload)
watch(() => filters.templateType, () => {
  pagination.page = 1
  loadTemplates()
})
watch(() => filters.status, () => {
  pagination.page = 1
  loadTemplates()
})
watch(() => pagination.page, () => {
  loadTemplates()
})
watch(() => filters.tenantCode, (value) => {
  pagination.page = 1
  form.tenantCode = formMode.value === 'create' ? value : form.tenantCode
  syncTenantQuery()
  loadTemplates()
})

function addRoleRow() {
  templateRoles.value.push(emptyRoleRow((templateRoles.value.length + 1) * 10))
}

function removeRoleRow(index: number) {
  if (templateRoles.value.length === 1) {
    templateRoles.value = [emptyRoleRow(10)]
    return
  }

  templateRoles.value.splice(index, 1)
}

function validateForm() {
  if (!form.tenantCode.trim()) {
    throw new Error('tenantCode 不能为空')
  }
  if (!form.templateCode.trim()) {
    throw new Error('templateCode 不能为空')
  }
  if (!form.templateName.trim()) {
    throw new Error('templateName 不能为空')
  }
  if (!Number.isFinite(Number(form.sortOrder))) {
    throw new Error('sortOrder 非法')
  }
}

function buildRolePayload() {
  const items = templateRoles.value
    .map(item => ({
      roleCode: item.roleCode.trim(),
      sortOrder: Number(item.sortOrder)
    }))
    .filter(item => item.roleCode)

  for (const item of items) {
    if (!Number.isFinite(item.sortOrder)) {
      throw new Error(`角色 ${item.roleCode} 的 sortOrder 非法`)
    }
  }

  return items
}

async function submitForm() {
  formPending.value = true
  resetNotice()

  try {
    validateForm()

    const payload = {
      tenantCode: form.tenantCode.trim(),
      templateCode: form.templateCode.trim(),
      templateName: form.templateName.trim(),
      templateType: form.templateType,
      description: form.description.trim() || null,
      status: form.status,
      sortOrder: Number(form.sortOrder)
    }

    const rolePayload = buildRolePayload()

    const response = formMode.value === 'create'
      ? await platformFetchJson<{ success: true, data: TemplateItem }>(`${apiPrefix.value}/templates`, {
          method: 'POST',
          body: payload
        })
      : await platformFetchJson<{ success: true, data: TemplateItem }>(`${apiPrefix.value}/templates/${selectedTemplateId.value}`, {
          method: 'PATCH',
          body: {
            templateName: payload.templateName,
            templateType: payload.templateType,
            description: payload.description,
            status: payload.status,
            sortOrder: payload.sortOrder
          }
        })

    const templateId = response.data.id

    await $fetch(`${apiPrefix.value}/templates/${templateId}/roles`, {
      method: 'PUT',
      body: {
        roles: rolePayload
      }
    })

    notice.value = {
      type: 'success',
      message: formMode.value === 'create' ? '模板已创建。' : '模板已更新。'
    }

    filters.tenantCode = payload.tenantCode
    await loadTemplates()
    fillForm(response.data)
    await loadTemplateRoles(templateId)
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '模板保存失败'
    }
  } finally {
    formPending.value = false
  }
}

function formatTemplateTag(template: TemplateItem) {
  return `${template.templateType} · ${template.sortOrder}`
}

onMounted(() => {
  resetForm()
  if (!filters.tenantCode && currentTenantCode.value) {
    filters.tenantCode = currentTenantCode.value
  }
  if (filters.tenantCode) {
    loadTemplates()
  }
})
</script>

<template>
  <UDashboardPanel
    id="platform-templates"
    :ui="{ body: 'gap-4 sm:p-4' }"
  >
    <template #body>
      <section class="grid gap-4 xl:grid-cols-[0.95fr_1.15fr]">
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                  Authorization
                </p>
                <h1 class="text-xl font-semibold text-slate-900">
                  模板管理
                </h1>
                <p class="mt-1 text-sm text-slate-600">
                  模板承担角色组合分发，先把模板元数据和模板角色组合一起维护起来。
                </p>
              </div>

              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="listPending"
                  @click="loadTemplates"
                >
                  刷新
                </UButton>
                <UButton
                  color="primary"
                  icon="i-lucide-plus"
                  @click="resetForm"
                >
                  新建模板
                </UButton>
              </div>
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid gap-3 md:grid-cols-2">
              <template v-if="!isDashboardRoute || !hasTenantContext">
                <label class="tenant-field md:col-span-2">
                  <span class="tenant-field__label">tenantCode</span>
                  <UInput
                    v-model="filters.tenantCode"
                    placeholder="先输入 tenantCode，例如 acme"
                  />
                </label>
              </template>
              <div
                v-else
                class="tenant-notice md:col-span-2"
                data-tone="success"
              >
                当前租户上下文：{{ filters.tenantCode }}
              </div>

              <label class="tenant-field md:col-span-2">
                <span class="tenant-field__label">关键字</span>
                <UInput
                  v-model="filters.keyword"
                  placeholder="搜索 templateCode / templateName / 描述"
                  icon="i-lucide-search"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">templateType</span>
                <select
                  v-model="filters.templateType"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in templateTypeOptions"
                    :key="option.value || 'all'"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">status</span>
                <select
                  v-model="filters.status"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in statusOptions"
                    :key="option.value || 'all'"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </div>

            <div
              v-if="notice"
              class="tenant-notice"
              :data-tone="notice.type"
            >
              {{ notice.message }}
            </div>

            <div
              v-if="!filters.tenantCode.trim()"
              class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
            >
              {{ isDashboardRoute ? '请先回到 dashboard 设置当前租户上下文，再加载该租户下的模板。' : '先输入 `tenantCode`，再加载该租户下的模板。' }}
            </div>

            <div
              v-else
              class="space-y-3"
            >
              <button
                v-for="template in templates"
                :key="template.id"
                type="button"
                class="tenant-list-card"
                :data-active="template.id === selectedTemplateId"
                @click="fillForm(template); loadTemplateRoles(template.id)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm font-semibold text-slate-900">{{ template.templateName }}</span>
                      <UBadge
                        variant="soft"
                        color="neutral"
                      >
                        {{ template.templateCode }}
                      </UBadge>
                    </div>
                    <p class="mt-1 truncate text-sm text-slate-600">
                      {{ template.description || '未设置描述' }}
                    </p>
                  </div>

                  <UBadge
                    :color="template.status === 'active' ? 'success' : template.status === 'suspended' ? 'warning' : 'neutral'"
                    variant="soft"
                  >
                    {{ template.status }}
                  </UBadge>
                </div>

                <dl class="mt-3 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      类型
                    </dt>
                    <dd class="ml-1 inline">
                      {{ formatTemplateTag(template) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      租户
                    </dt>
                    <dd class="ml-1 inline">
                      {{ template.tenantCode || 'system' }}
                    </dd>
                  </div>
                </dl>
              </button>

              <div
                v-if="!listPending && templates.length === 0"
                class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
              >
                当前租户下还没有模板。
              </div>
            </div>

            <div
              v-if="filters.tenantCode.trim()"
              class="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-sm text-slate-500"
            >
              <span>共 {{ pagination.total }} 条</span>
              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :disabled="pagination.page <= 1"
                  @click="pagination.page -= 1"
                >
                  上一页
                </UButton>
                <span>{{ pagination.page }} / {{ pageCount }}</span>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :disabled="pagination.page >= pageCount"
                  @click="pagination.page += 1"
                >
                  下一页
                </UButton>
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-lime-700">
                  Editor
                </p>
                <h2 class="text-xl font-semibold text-slate-900">
                  {{ formMode === 'create' ? '新建模板' : '编辑模板' }}
                </h2>
              </div>

              <UBadge
                :color="formMode === 'create' ? 'primary' : 'warning'"
                variant="soft"
              >
                {{ formMode }}
              </UBadge>
            </div>
          </template>

          <form
            class="space-y-4"
            @submit.prevent="submitForm"
          >
            <div class="grid gap-4 md:grid-cols-2">
              <label class="tenant-field">
                <span class="tenant-field__label">tenantCode</span>
                <UInput
                  v-model="form.tenantCode"
                  :disabled="formMode === 'edit' || (isDashboardRoute && hasTenantContext)"
                  placeholder="acme"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">templateCode</span>
                <UInput
                  v-model="form.templateCode"
                  :disabled="formMode === 'edit'"
                  placeholder="tpl:rd_staff"
                />
              </label>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <label class="tenant-field">
                <span class="tenant-field__label">templateName</span>
                <UInput
                  v-model="form.templateName"
                  placeholder="研发员工模板"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">sortOrder</span>
                <UInput
                  v-model="form.sortOrder"
                  type="number"
                />
              </label>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <label class="tenant-field">
                <span class="tenant-field__label">templateType</span>
                <select
                  v-model="form.templateType"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in templateTypeOptions.slice(1)"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">status</span>
                <select
                  v-model="form.status"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in statusOptions.slice(1)"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </div>

            <label class="tenant-field">
              <span class="tenant-field__label">description</span>
              <textarea
                v-model="form.description"
                class="tenant-native-field min-h-28 resize-y"
                placeholder="描述这个模板面向什么岗位或职责"
              />
            </label>

            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div class="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-medium text-slate-900">
                    模板角色组合
                  </p>
                  <p class="text-xs text-slate-500">
                    按 roleCode 维护模板展开出来的角色集合。
                  </p>
                </div>

                <div class="flex items-center gap-2">
                  <UBadge
                    variant="soft"
                    color="neutral"
                  >
                    {{ templateRoles.length }} 条
                  </UBadge>
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-plus"
                    @click="addRoleRow"
                  >
                    添加角色
                  </UButton>
                </div>
              </div>

              <div
                v-if="rolesPending"
                class="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500"
              >
                正在加载模板角色...
              </div>

              <div
                v-else
                class="space-y-3"
              >
                <div
                  v-for="(role, index) in templateRoles"
                  :key="`${role.roleCode}-${index}`"
                  class="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[1fr_140px_auto]"
                >
                  <label class="tenant-field">
                    <span class="tenant-field__label">roleCode</span>
                    <UInput
                      v-model="role.roleCode"
                      placeholder="internal_user / aims:member"
                    />
                  </label>

                  <label class="tenant-field">
                    <span class="tenant-field__label">sortOrder</span>
                    <UInput
                      v-model="role.sortOrder"
                      type="number"
                    />
                  </label>

                  <div class="flex items-end justify-end">
                    <UButton
                      color="error"
                      variant="ghost"
                      size="sm"
                      icon="i-lucide-trash-2"
                      @click="removeRoleRow(index)"
                    >
                      删除
                    </UButton>
                  </div>

                  <p
                    v-if="role.roleName || role.roleType"
                    class="md:col-span-3 text-xs text-slate-500"
                  >
                    当前关联：{{ role.roleName || role.roleCode }}<span v-if="role.roleType"> · {{ role.roleType }}</span><span v-if="role.appCode"> · {{ role.appCode }}</span>
                  </p>
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p class="font-medium text-slate-900">
                当前说明
              </p>
              <p class="mt-1">
                模板保存时会同时全量替换其角色组合；`templateCode` 和 `tenantCode` 在 v1 中视为稳定标识。
              </p>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div class="text-xs text-slate-500">
                <span v-if="selectedTemplate">当前选中：{{ selectedTemplate.templateCode }}</span>
                <span v-else>创建后会自动回填列表并切到编辑模式。</span>
              </div>

              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  type="button"
                  @click="resetForm"
                >
                  {{ formMode === 'create' ? '清空' : '切换为新建' }}
                </UButton>
                <UButton
                  color="primary"
                  type="submit"
                  :loading="formPending"
                >
                  {{ formMode === 'create' ? '创建模板' : '保存变更' }}
                </UButton>
              </div>
            </div>
          </form>
        </UCard>
      </section>
    </template>
  </UDashboardPanel>
</template>
