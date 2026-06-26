<script setup lang="ts">
usePageTitle('角色管理')

type RoleType = 'system' | 'custom'
type RoleStatus = 'active' | 'suspended' | 'disabled'
type PermissionAction = 'view' | 'edit' | 'admin'

interface RoleItem {
  id: number
  tenantCode: string | null
  roleCode: string
  roleName: string
  roleType: RoleType
  appCode: string | null
  description: string | null
  isSystem: boolean
  isAssignable: boolean
  status: RoleStatus
}

interface RoleListResponse {
  items: RoleItem[]
  total: number
  page: number
  pageSize: number
}

interface ResourceItem {
  id: number
  tenantCode: string | null
  appCode: string
  resourceCode: string
  resourceName: string
  description: string | null
  sortOrder: number
  status: string
}

interface ResourceListResponse {
  items: ResourceItem[]
  total: number
}

interface RolePermissionItem {
  appCode: string
  resourceCode: string
  resourceName?: string
  action: PermissionAction
}

interface RoleScopeItem {
  appCode: string
  resourceCode: string
  resourceName?: string
  action: PermissionAction
  scopeType: string
  scopeValue: string
  status: 'active' | 'disabled'
}

interface AppRoleItem {
  roleCode: string
  roleName: string
  appCode: string
  permissionCount: number
}

interface AppRoleListResponse {
  items: AppRoleItem[]
  total: number
}

interface RoleAppRoleMapResponse {
  items: Array<{
    appRoleCode: string
  }>
}

const route = useRoute()
const router = useRouter()
const { currentTenantCode, setCurrentTenantCode } = useTenantContext()
const isDashboardRoute = computed(() => route.path.startsWith('/dashboard'))
const apiPrefix = computed(() => isDashboardRoute.value ? '/api/platform/tenant-admin' : '/api/platform/ops')
const roleTypeOptions = [
  { value: '', label: '全部来源' },
  { value: 'system', label: '平台继承' },
  { value: 'custom', label: '企业自定义' }
]

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'suspended', label: '暂停' },
  { value: 'disabled', label: '停用' }
]

const actionOptions = [
  { value: 'view', label: 'view' },
  { value: 'edit', label: 'edit' },
  { value: 'admin', label: 'admin' }
] as const

const scopeStatusOptions = [
  { value: 'active', label: 'active' },
  { value: 'disabled', label: 'disabled' }
] as const

const filters = reactive({
  tenantCode: typeof route.query.tenantCode === 'string' ? route.query.tenantCode : currentTenantCode.value,
  keyword: '',
  roleType: '',
  appCode: '',
  status: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const roles = ref<RoleItem[]>([])
const resources = ref<ResourceItem[]>([])
const appRoles = ref<AppRoleItem[]>([])
const selectedAppRoleCodes = ref<string[]>([])
const selectedRoleId = ref<number | null>(null)
const listPending = ref(false)
const formPending = ref(false)
const resourcesPending = ref(false)
const appRolesPending = ref(false)
const permissionsPending = ref(false)
const scopesPending = ref(false)
const roleConfigPending = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)

const form = reactive({
  tenantCode: filters.tenantCode,
  roleCode: '',
  roleName: '',
  roleType: 'custom' as RoleType,
  appCode: '',
  description: '',
  isAssignable: true,
  status: 'active' as RoleStatus
})

const permissionRows = ref<RolePermissionItem[]>([{ appCode: '', resourceCode: '', action: 'view' }])
const scopeRows = ref<RoleScopeItem[]>([{ appCode: '', resourceCode: '', action: 'view', scopeType: 'all', scopeValue: 'all', status: 'active' }])

const pageCount = computed(() => Math.max(1, Math.ceil((pagination.total || 0) / pagination.pageSize)))
const selectedRole = computed(() => roles.value.find(item => item.id === selectedRoleId.value) || null)
const hasTenantContext = computed(() => !!filters.tenantCode.trim())
const availableApps = computed(() => Array.from(new Set(resources.value.map(item => item.appCode))).sort())
const availableAppCodes = computed(() => {
  const codes = new Set<string>()
  for (const resource of resources.value) {
    codes.add(resource.appCode)
  }
  for (const appRole of appRoles.value) {
    codes.add(appRole.appCode)
  }
  return Array.from(codes).sort()
})
const selectedRoleTypeLabel = computed(() => selectedRole.value ? roleTypeLabel(selectedRole.value.roleType) : '')
const canEditRoleCode = computed(() => formMode.value === 'create')
const formRoleTypeOptions = computed(() => {
  if (formMode.value === 'create') {
    return roleTypeOptions.filter(item => item.value === 'custom')
  }

  return roleTypeOptions.filter(item => item.value)
})

function resetNotice() {
  notice.value = null
}

function emptyPermissionRow(): RolePermissionItem {
  return {
    appCode: form.appCode || '',
    resourceCode: '',
    action: 'view'
  }
}

function emptyScopeRow(): RoleScopeItem {
  return {
    appCode: form.appCode || '',
    resourceCode: '',
    action: 'view',
    scopeType: 'all',
    scopeValue: 'all',
    status: 'active'
  }
}

function resetRoleConfig() {
  permissionRows.value = [emptyPermissionRow()]
  scopeRows.value = [emptyScopeRow()]
  selectedAppRoleCodes.value = []
}

function resetForm() {
  formMode.value = 'create'
  selectedRoleId.value = null
  form.tenantCode = filters.tenantCode
  form.roleCode = ''
  form.roleName = ''
  form.roleType = 'custom'
  form.appCode = ''
  form.description = ''
  form.isAssignable = true
  form.status = 'active'
  resetRoleConfig()
}

function fillForm(role: RoleItem) {
  formMode.value = 'edit'
  selectedRoleId.value = role.id
  form.tenantCode = role.tenantCode || filters.tenantCode
  form.roleCode = role.roleCode
  form.roleName = role.roleName
  form.roleType = role.roleType
  form.appCode = role.appCode || ''
  form.description = role.description || ''
  form.isAssignable = role.isAssignable
  form.status = role.status
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

function resourceOptionsFor(appCode: string) {
  const targetApp = appCode || form.appCode || ''
  return resources.value.filter(item => !targetApp || item.appCode === targetApp)
}

async function loadRoles() {
  if (!filters.tenantCode.trim()) {
    roles.value = []
    pagination.total = 0
    selectedRoleId.value = null
    if (formMode.value === 'edit') {
      resetForm()
    }
    return
  }

  listPending.value = true
  resetNotice()

  try {
    const response = await platformFetchJson<{ success: true, data: RoleListResponse }>(`${apiPrefix.value}/roles`, {
      query: {
        tenantCode: filters.tenantCode.trim(),
        keyword: filters.keyword || undefined,
        roleType: filters.roleType || undefined,
        appCode: filters.appCode || undefined,
        status: filters.status || undefined,
        page: pagination.page,
        pageSize: pagination.pageSize
      }
    })

    roles.value = response.data.items
    pagination.total = response.data.total

    if (selectedRoleId.value && !roles.value.some(item => item.id === selectedRoleId.value)) {
      selectedRoleId.value = null
      if (formMode.value === 'edit') {
        resetForm()
      }
    }
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '角色列表加载失败'
    }
  } finally {
    listPending.value = false
  }
}

async function loadResources() {
  if (!filters.tenantCode.trim()) {
    resources.value = []
    return
  }

  resourcesPending.value = true

  try {
    const response = await platformFetchJson<{ data: ResourceListResponse }>(`${apiPrefix.value}/resources`, {
      query: {
        tenantCode: filters.tenantCode.trim(),
        status: 'active',
        page: 1,
        pageSize: 200
      }
    })

    resources.value = response.data.items
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '资源列表加载失败'
    }
    resources.value = []
  } finally {
    resourcesPending.value = false
  }
}

async function loadAppRoles() {
  if (!filters.tenantCode.trim()) {
    appRoles.value = []
    return
  }

  appRolesPending.value = true

  try {
    const response = await platformFetchJson<{ success: true, data: AppRoleListResponse }>(`${apiPrefix.value}/app-roles`, {
      query: {
        status: 'active',
        page: 1,
        pageSize: 500
      }
    })
    appRoles.value = response.data.items
  } catch {
    appRoles.value = []
  } finally {
    appRolesPending.value = false
  }
}

async function loadRoleAppRoles(roleId: number) {
  const response = await platformFetchJson<{ success: true, data: RoleAppRoleMapResponse }>(`${apiPrefix.value}/roles/${roleId}/app-roles`, {
    query: {
      tenantCode: filters.tenantCode.trim()
    }
  })
  selectedAppRoleCodes.value = response.data.items.map(item => item.appRoleCode)
}

async function refreshListAndResources() {
  await Promise.all([loadRoles(), loadResources(), loadAppRoles()])
}

async function loadRolePermissions(roleId: number) {
  permissionsPending.value = true

  try {
    const response = await platformFetchJson<{ data: { items: RolePermissionItem[] } }>(`${apiPrefix.value}/roles/${roleId}/permissions`)
    permissionRows.value = response.data.items.length > 0
      ? response.data.items.map(item => ({
          appCode: item.appCode,
          resourceCode: item.resourceCode,
          resourceName: item.resourceName,
          action: item.action
        }))
      : [emptyPermissionRow()]
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '角色权限加载失败'
    }
    permissionRows.value = [emptyPermissionRow()]
  } finally {
    permissionsPending.value = false
  }
}

async function loadRoleScopes(roleId: number) {
  scopesPending.value = true

  try {
    const response = await platformFetchJson<{ data: { items: RoleScopeItem[] } }>(`${apiPrefix.value}/roles/${roleId}/scopes`)
    scopeRows.value = response.data.items.length > 0
      ? response.data.items.map(item => ({
          appCode: item.appCode,
          resourceCode: item.resourceCode,
          resourceName: item.resourceName,
          action: item.action,
          scopeType: item.scopeType,
          scopeValue: item.scopeValue,
          status: item.status
        }))
      : [emptyScopeRow()]
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '角色 scope 加载失败'
    }
    scopeRows.value = [emptyScopeRow()]
  } finally {
    scopesPending.value = false
  }
}

async function selectRole(role: RoleItem) {
  fillForm(role)
  await Promise.all([
    loadRoleAppRoles(role.id),
    loadRolePermissions(role.id),
    loadRoleScopes(role.id)
  ])
}

const debouncedReload = useDebounceFn(() => {
  pagination.page = 1
  loadRoles()
}, 250)

watch(() => filters.keyword, debouncedReload)
watch(() => filters.appCode, debouncedReload)
watch(() => filters.roleType, () => {
  pagination.page = 1
  loadRoles()
})
watch(() => filters.status, () => {
  pagination.page = 1
  loadRoles()
})
watch(() => pagination.page, () => {
  loadRoles()
})
watch(() => filters.tenantCode, async (value) => {
  pagination.page = 1
  form.tenantCode = formMode.value === 'create' ? value : form.tenantCode
  syncTenantQuery()
  resetForm()
  await refreshListAndResources()
})

function validateForm() {
  if (!form.tenantCode.trim()) {
    throw new Error('tenantCode 不能为空')
  }
  if (!form.roleCode.trim()) {
    throw new Error('roleCode 不能为空')
  }
  if (!form.roleName.trim()) {
    throw new Error('roleName 不能为空')
  }
}

function addPermissionRow() {
  permissionRows.value.push(emptyPermissionRow())
}

function removePermissionRow(index: number) {
  if (permissionRows.value.length === 1) {
    permissionRows.value = [emptyPermissionRow()]
    return
  }
  permissionRows.value.splice(index, 1)
}

function addScopeRow() {
  scopeRows.value.push(emptyScopeRow())
}

function removeScopeRow(index: number) {
  if (scopeRows.value.length === 1) {
    scopeRows.value = [emptyScopeRow()]
    return
  }
  scopeRows.value.splice(index, 1)
}

function buildPermissionPayload() {
  const items = permissionRows.value
    .map(item => ({
      appCode: item.appCode.trim() || form.appCode.trim(),
      resourceCode: item.resourceCode.trim(),
      action: item.action
    }))
    .filter(item => item.appCode && item.resourceCode)

  return items
}

function buildScopePayload() {
  const items = scopeRows.value
    .map(item => ({
      appCode: item.appCode.trim() || form.appCode.trim(),
      resourceCode: item.resourceCode.trim(),
      action: item.action,
      scopeType: item.scopeType.trim(),
      scopeValue: item.scopeValue.trim(),
      status: item.status
    }))
    .filter(item => item.appCode && item.resourceCode && item.scopeType && item.scopeValue)

  return items
}

async function saveRoleMeta() {
  formPending.value = true
  resetNotice()

  try {
    validateForm()

    const payload = {
      tenantCode: form.tenantCode.trim(),
      roleCode: form.roleCode.trim(),
      roleName: form.roleName.trim(),
      roleType: form.roleType,
      appCode: null,
      description: form.description.trim() || null,
      isAssignable: form.isAssignable,
      status: form.status
    }

    const response = formMode.value === 'create'
      ? await platformFetchJson<{ success: true, data: RoleItem }>(`${apiPrefix.value}/roles`, {
          method: 'POST',
          body: payload
        })
      : await platformFetchJson<{ success: true, data: RoleItem }>(`${apiPrefix.value}/roles/${selectedRoleId.value}`, {
          method: 'PATCH',
          body: {
            roleName: payload.roleName,
            roleType: payload.roleType,
            appCode: payload.appCode,
            description: payload.description,
            isAssignable: payload.isAssignable,
            status: payload.status
          }
        })

    notice.value = {
      type: 'success',
      message: formMode.value === 'create' ? '角色已创建。' : '角色已更新。'
    }

    filters.tenantCode = payload.tenantCode
    await loadRoles()
    fillForm(response.data)
    await Promise.all([
      loadRoleAppRoles(response.data.id),
      loadRolePermissions(response.data.id),
      loadRoleScopes(response.data.id)
    ])
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '角色保存失败'
    }
  } finally {
    formPending.value = false
  }
}

async function saveRoleConfig() {
  if (!selectedRoleId.value) {
    notice.value = {
      type: 'error',
      message: '请先创建或选择企业角色，再配置应用权限角色和高级权限。'
    }
    return
  }

  roleConfigPending.value = true
  resetNotice()

  try {
    await $fetch(`${apiPrefix.value}/roles/${selectedRoleId.value}/permissions`, {
      method: 'PUT',
      body: {
        permissions: buildPermissionPayload()
      }
    })

    await $fetch(`${apiPrefix.value}/roles/${selectedRoleId.value}/scopes`, {
      method: 'PUT',
      body: {
        scopes: buildScopePayload()
      }
    })

    await $fetch(`${apiPrefix.value}/roles/${selectedRoleId.value}/app-roles`, {
      method: 'PUT',
      query: {
        tenantCode: filters.tenantCode.trim()
      },
      body: {
        appRoles: selectedAppRoleCodes.value.map(appRoleCode => ({ appRoleCode }))
      }
    })

    notice.value = {
      type: 'success',
      message: '企业角色权限配置已更新。'
    }

    await Promise.all([
      loadRoleAppRoles(selectedRoleId.value),
      loadRolePermissions(selectedRoleId.value),
      loadRoleScopes(selectedRoleId.value)
    ])
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '角色权限配置保存失败'
    }
  } finally {
    roleConfigPending.value = false
  }
}

function formatRoleTag(role: RoleItem) {
  if (role.appCode) {
    return `${roleTypeLabel(role.roleType)} · ${role.appCode}`
  }

  return roleTypeLabel(role.roleType)
}

function roleTypeLabel(type: string) {
  return roleTypeOptions.find(item => item.value === type)?.label || type
}

function statusLabel(status: string) {
  return statusOptions.find(item => item.value === status)?.label || status
}

onMounted(async () => {
  if (!filters.tenantCode && currentTenantCode.value) {
    filters.tenantCode = currentTenantCode.value
  }
  if (filters.tenantCode) {
    await refreshListAndResources()
  }
})
</script>

<template>
  <UDashboardPanel
    id="platform-roles"
    :ui="{ body: 'gap-4 sm:p-4' }"
  >
    <template #body>
      <section class="grid gap-4 xl:grid-cols-[0.95fr_1.2fr]">
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                  Authorization
                </p>
                <h1 class="text-xl font-semibold text-slate-900">
                  企业角色管理
                </h1>
                <p class="mt-1 text-sm text-slate-600">
                  管理企业继承角色和自定义角色，通过应用权限角色组合定义业务权限。
                </p>
              </div>

              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="listPending || resourcesPending"
                  @click="refreshListAndResources"
                >
                  刷新
                </UButton>
                <UButton
                  color="primary"
                  icon="i-lucide-plus"
                  @click="resetForm"
                >
                  新建自定义角色
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
                  placeholder="搜索 roleCode / roleName / 描述"
                  icon="i-lucide-search"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">角色来源</span>
                <select
                  v-model="filters.roleType"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in roleTypeOptions"
                    :key="option.value || 'all'"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">状态</span>
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

              <label class="tenant-field md:col-span-2">
                <span class="tenant-field__label">关联应用</span>
                <select
                  v-model="filters.appCode"
                  class="tenant-native-field"
                >
                  <option value="">全部应用</option>
                  <option
                    v-for="appCode in availableAppCodes"
                    :key="appCode"
                    :value="appCode"
                  >
                    {{ appCode }}
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

            <div class="grid gap-3">
              <button
                v-for="role in roles"
                :key="role.id"
                type="button"
                class="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-left shadow-sm shadow-slate-200/40 transition hover:border-sky-300"
                :class="{ 'border-sky-300 bg-sky-50/80': selectedRoleId === role.id }"
                @click="selectRole(role)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="space-y-1">
                    <p class="text-sm font-semibold text-slate-900">
                      {{ role.roleName }}
                    </p>
                    <p class="text-xs text-slate-500">
                      {{ role.roleCode }}
                    </p>
                    <div class="flex flex-wrap gap-2 text-xs text-slate-500">
                      <span>{{ formatRoleTag(role) }}</span>
                      <span>·</span>
                      <span>{{ statusLabel(role.status) }}</span>
                      <span v-if="!role.isAssignable">· 不可分配</span>
                    </div>
                  </div>

                  <UBadge
                    color="neutral"
                    variant="soft"
                  >
                    {{ roleTypeLabel(role.roleType) }}
                  </UBadge>
                </div>
              </button>

              <div
                v-if="!listPending && roles.length === 0"
                class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500"
              >
                当前企业还没有角色定义。
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-sm text-slate-500">
              <span>共 {{ pagination.total }} 条角色</span>
              <UPagination
                v-model:page="pagination.page"
                :page-count="pageCount"
                :total="pagination.total"
                :items-per-page="pagination.pageSize"
                size="sm"
              />
            </div>
          </div>
        </UCard>

        <div class="grid gap-4">
          <UCard>
            <template #header>
              <div class="space-y-1">
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-lime-700">
                  Metadata
                </p>
                <h2 class="text-lg font-semibold text-slate-900">
                  {{ formMode === 'create' ? '新建企业自定义角色' : '编辑企业角色' }}
                </h2>
              </div>
            </template>

            <form
              class="space-y-4"
              @submit.prevent="saveRoleMeta"
            >
              <div class="grid gap-3 md:grid-cols-2">
                <label class="tenant-field">
                  <span class="tenant-field__label">tenantCode</span>
                  <UInput
                    v-model="form.tenantCode"
                    :readonly="isDashboardRoute"
                    placeholder="租户编码"
                  />
                </label>
                <label class="tenant-field">
                  <span class="tenant-field__label">roleCode</span>
                  <UInput
                    v-model="form.roleCode"
                    :readonly="!canEditRoleCode"
                    placeholder="角色稳定编码"
                  />
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">roleName</span>
                  <UInput
                    v-model="form.roleName"
                    placeholder="角色名称"
                  />
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">角色来源</span>
                  <select
                    v-model="form.roleType"
                    class="tenant-native-field"
                  >
                    <option
                      v-for="option in formRoleTypeOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">状态</span>
                  <select
                    v-model="form.status"
                    class="tenant-native-field"
                  >
                    <option
                      v-for="option in statusOptions.filter(item => item.value)"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>

                <label class="tenant-field md:col-span-2">
                  <span class="tenant-field__label">描述</span>
                  <UTextarea
                    v-model="form.description"
                    :rows="3"
                    placeholder="角色描述，可选"
                  />
                </label>

                <label class="tenant-field md:col-span-2">
                  <span class="tenant-field__label">允许分配给员工</span>
                  <UToggle v-model="form.isAssignable" />
                </label>
              </div>

              <div class="flex flex-wrap gap-2">
                <UButton
                  color="primary"
                  type="submit"
                  :loading="formPending"
                >
                  {{ formMode === 'create' ? '创建自定义角色' : '保存角色' }}
                </UButton>
                <UButton
                  color="neutral"
                  variant="soft"
                  type="button"
                  @click="resetForm"
                >
                  重置
                </UButton>
              </div>
            </form>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-start justify-between gap-3">
                <div class="space-y-1">
                  <p class="text-xs font-semibold uppercase tracking-[0.24em] text-violet-700">
                    Permissions
                  </p>
                  <h2 class="text-lg font-semibold text-slate-900">
                    应用权限角色与自定义权限
                  </h2>
                  <p class="text-sm text-slate-600">
                    优先选择应用权限角色；仅在需要企业特例时补充额外权限和 Scope。
                  </p>
                </div>
                <UButton
                  color="primary"
                  :disabled="!selectedRoleId"
                  :loading="roleConfigPending || permissionsPending || scopesPending"
                  @click="saveRoleConfig"
                >
                  保存权限配置
                </UButton>
              </div>
            </template>

            <div
              v-if="!selectedRoleId"
              class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500"
            >
              先从左侧创建或选择一个企业角色，再配置应用权限角色和高级权限。
            </div>

            <div
              v-else
              class="space-y-6"
            >
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                当前角色：<strong class="text-slate-900">{{ selectedRole?.roleName }}</strong>
                <span class="text-slate-500">({{ selectedRole?.roleCode }})</span>
                <UBadge
                  class="ml-2"
                  color="neutral"
                  variant="soft"
                >
                  {{ selectedRoleTypeLabel }}
                </UBadge>
              </div>

              <section class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-semibold text-slate-900">
                      应用权限角色
                    </h3>
                    <p class="text-xs text-slate-500">
                      企业角色通过这些应用权限角色获得应用内权限；下方高级配置仅用于补充企业特例。
                    </p>
                  </div>
                  <UBadge
                    color="neutral"
                    variant="soft"
                  >
                    已选 {{ selectedAppRoleCodes.length }} 个
                  </UBadge>
                </div>

                <div
                  v-if="appRolesPending"
                  class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500"
                >
                  应用权限角色加载中...
                </div>
                <div
                  v-else-if="!appRoles.length"
                  class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500"
                >
                  暂无可绑定的应用权限角色。
                </div>
                <div
                  v-else
                  class="grid gap-2 md:grid-cols-2"
                >
                  <label
                    v-for="appRole in appRoles"
                    :key="appRole.roleCode"
                    class="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <UCheckbox
                      v-model="selectedAppRoleCodes"
                      :value="appRole.roleCode"
                    />
                    <span class="min-w-0">
                      <span class="block font-medium text-slate-900">{{ appRole.roleName }}</span>
                      <span class="block truncate text-xs text-slate-500">
                        {{ appRole.roleCode }} · {{ appRole.appCode }} · {{ appRole.permissionCount }} 项权限
                      </span>
                    </span>
                  </label>
                </div>
              </section>

              <section class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-semibold text-slate-900">
                      高级：额外权限
                    </h3>
                    <p class="text-xs text-slate-500">
                      在应用权限角色之外，追加当前企业角色独有的 `app/resource/action`。
                    </p>
                  </div>
                  <UButton
                    color="neutral"
                    variant="soft"
                    @click="addPermissionRow"
                  >
                    添加权限
                  </UButton>
                </div>

                <div class="grid gap-3">
                  <div
                    v-for="(item, index) in permissionRows"
                    :key="`permission-${index}`"
                    class="grid gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 md:grid-cols-[0.85fr_1fr_0.7fr_auto]"
                  >
                    <label class="tenant-field">
                      <span class="tenant-field__label">appCode</span>
                      <select
                        v-model="item.appCode"
                        class="tenant-native-field"
                      >
                        <option value="">选择应用</option>
                        <option
                          v-for="appCode in availableApps"
                          :key="appCode"
                          :value="appCode"
                        >
                          {{ appCode }}
                        </option>
                      </select>
                    </label>
                    <label class="tenant-field">
                      <span class="tenant-field__label">resourceCode</span>
                      <select
                        v-model="item.resourceCode"
                        class="tenant-native-field"
                      >
                        <option value="">选择资源</option>
                        <option
                          v-for="resource in resourceOptionsFor(item.appCode)"
                          :key="`${resource.appCode}:${resource.resourceCode}`"
                          :value="resource.resourceCode"
                        >
                          {{ resource.resourceCode }} · {{ resource.resourceName }}
                        </option>
                      </select>
                    </label>
                    <label class="tenant-field">
                      <span class="tenant-field__label">action</span>
                      <select
                        v-model="item.action"
                        class="tenant-native-field"
                      >
                        <option
                          v-for="option in actionOptions"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                    </label>
                    <div class="flex items-end">
                      <UButton
                        color="error"
                        variant="soft"
                        @click="removePermissionRow(index)"
                      >
                        删除
                      </UButton>
                    </div>
                  </div>
                </div>
              </section>

              <section class="space-y-3">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-semibold text-slate-900">
                      高级：Scope 规则
                    </h3>
                    <p class="text-xs text-slate-500">
                      在应用权限角色之外，为额外权限补充 `scopeType / scopeValue` 数据范围。
                    </p>
                  </div>
                  <UButton
                    color="neutral"
                    variant="soft"
                    @click="addScopeRow"
                  >
                    添加 scope
                  </UButton>
                </div>

                <div class="grid gap-3">
                  <div
                    v-for="(item, index) in scopeRows"
                    :key="`scope-${index}`"
                    class="grid gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 md:grid-cols-[0.75fr_0.95fr_0.65fr_0.7fr_0.7fr_0.65fr_auto]"
                  >
                    <label class="tenant-field">
                      <span class="tenant-field__label">appCode</span>
                      <select
                        v-model="item.appCode"
                        class="tenant-native-field"
                      >
                        <option value="">选择应用</option>
                        <option
                          v-for="appCode in availableApps"
                          :key="appCode"
                          :value="appCode"
                        >
                          {{ appCode }}
                        </option>
                      </select>
                    </label>
                    <label class="tenant-field">
                      <span class="tenant-field__label">resourceCode</span>
                      <select
                        v-model="item.resourceCode"
                        class="tenant-native-field"
                      >
                        <option value="">选择资源</option>
                        <option
                          v-for="resource in resourceOptionsFor(item.appCode)"
                          :key="`${resource.appCode}:${resource.resourceCode}`"
                          :value="resource.resourceCode"
                        >
                          {{ resource.resourceCode }} · {{ resource.resourceName }}
                        </option>
                      </select>
                    </label>
                    <label class="tenant-field">
                      <span class="tenant-field__label">action</span>
                      <select
                        v-model="item.action"
                        class="tenant-native-field"
                      >
                        <option
                          v-for="option in actionOptions"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                    </label>
                    <label class="tenant-field">
                      <span class="tenant-field__label">scopeType</span>
                      <UInput
                        v-model="item.scopeType"
                        placeholder="all / relation / org"
                      />
                    </label>
                    <label class="tenant-field">
                      <span class="tenant-field__label">scopeValue</span>
                      <UInput
                        v-model="item.scopeValue"
                        placeholder="all / member / department"
                      />
                    </label>
                    <label class="tenant-field">
                      <span class="tenant-field__label">status</span>
                      <select
                        v-model="item.status"
                        class="tenant-native-field"
                      >
                        <option
                          v-for="option in scopeStatusOptions"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                    </label>
                    <div class="flex items-end">
                      <UButton
                        color="error"
                        variant="soft"
                        @click="removeScopeRow(index)"
                      >
                        删除
                      </UButton>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </UCard>
        </div>
      </section>
    </template>
  </UDashboardPanel>
</template>
