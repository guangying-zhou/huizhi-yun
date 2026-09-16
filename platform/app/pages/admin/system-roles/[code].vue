<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({
  layout: 'platform'
})

type RoleStatus = 'active' | 'suspended' | 'disabled'
type ScopeStatus = 'active' | 'disabled'

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface SystemRoleDetail {
  id: number
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  description: string | null
  isRequired: boolean
  status: string
  permissionCount: number
  templateCount: number
  tenantCount: number
}

interface PermissionItem {
  appCode: string
  resourceCode: string
  resourceName: string
  action: string
  manifestActionId: number | null
}

interface ApplicationItem {
  appCode: string
  appName: string
}

interface ApplicationListResponse {
  items: ApplicationItem[]
}

interface ResourceAction {
  id: number
  action: string
  actionCode: string
  actionName: string | null
  description: string | null
  requiresGrant: boolean
}

interface ResourceItem {
  appCode: string
  resourceCode: string
  resourceName: string
  actions: ResourceAction[]
}

interface ResourceListResponse {
  items: ResourceItem[]
}

interface PermissionActionItem {
  manifestActionId: number | null
  appCode: string
  resourceCode: string
  resourceName: string
  action: string
  actionCode: string
  actionName: string | null
  description: string | null
}

interface ScopeItem {
  appCode: string
  resourceCode: string
  resourceName: string
  action: string
  manifestActionId: number | null
  scopeType: string
  scopeValue: string
  status: string
}

interface ScopeDraft {
  appCode: string
  resourceCode: string
  resourceName: string
  action: string
  manifestActionId: number | null
  scopeType: string
  scopeValue: string
  status: ScopeStatus
}

interface TemplateItem {
  id: number
  templateCode: string
  templateName: string
  templateType: string
  status: string
  usageTenantCount: number
}

interface TenantItem {
  tenantCode: string
  tenantName: string
  localRoleCode: string
  status: string
  memberCount: number
}

interface SystemRoleDetailResponse {
  role: SystemRoleDetail
  permissions: PermissionItem[]
  scopes: ScopeItem[]
  templates: TemplateItem[]
  tenants: TenantItem[]
}

interface PermissionAction {
  code: string
  label: string
  resourceCode: string
  action: string
  granted: boolean
}

interface PermissionGroup {
  app: string
  actions: PermissionAction[]
}

interface FetchLikeError extends Error {
  statusCode?: number
  status?: number
  data?: {
    message?: string
    statusMessage?: string
  }
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'info'> = {
  active: 'success',
  suspended: 'warning',
  disabled: 'neutral',
  draft: 'info'
}

const route = useRoute()
const router = useRouter()
const toast = useToast()

const code = computed(() => String(route.params.code || ''))

const { data, pending, error, refresh } = usePlatformData<ApiEnvelope<SystemRoleDetailResponse>>(
  () => `/api/platform/ops/system-roles/${encodeURIComponent(code.value)}`,
  { watch: [code] }
)

const { data: applicationData, pending: applicationsPending, refresh: refreshApplications } = usePlatformData<ApiEnvelope<ApplicationListResponse>>(
  '/api/platform/ops/applications',
  {
    query: {
      page: 1,
      pageSize: 200
    }
  }
)

await Promise.all([refresh(), refreshApplications()])

const role = computed<SystemRoleDetail | null>(() => data.value?.data.role || null)
const permissions = computed<PermissionItem[]>(() => (data.value?.data.permissions || []) as PermissionItem[])

usePageTitle('应用权限角色')

const tab = ref<'permissions' | 'scopes' | 'templates' | 'tenants'>('permissions')

const roleStatusItems = [
  { label: 'active', value: 'active' },
  { label: 'suspended', value: 'suspended' },
  { label: 'disabled', value: 'disabled' }
]

const scopeStatusItems = [
  { label: 'active', value: 'active' },
  { label: 'disabled', value: 'disabled' }
]

const appOptions = computed<Array<{ value: string, label: string }>>(() => ((applicationData.value?.data.items || []) as ApplicationItem[])
  .filter(item => item.appCode)
  .map(item => ({
    value: item.appCode,
    label: `${item.appName} (${item.appCode})`
  })))

const tabItems = computed(() => [
  { value: 'permissions', label: 'Permissions', badge: role.value?.permissionCount || 0 },
  { value: 'scopes', label: 'Scopes', badge: data.value?.data.scopes.length || 0 },
  { value: 'templates', label: 'Used by Templates', badge: role.value?.templateCount || 0 },
  { value: 'tenants', label: 'Used by Tenants', badge: role.value?.tenantCount || 0 }
])

const crumbs = computed(() => [
  { label: '工作台', to: '/admin' },
  { label: '应用权限角色', to: '/admin/system-roles' },
  { label: role.value?.roleName || code.value }
])

const permGroups = computed<PermissionGroup[]>(() => {
  const groups = new Map<string, PermissionAction[]>()

  for (const item of data.value?.data.permissions || []) {
    const app = item.appCode || 'unknown'
    const list = groups.get(app) || []
    list.push({
      code: `${item.appCode}.${item.resourceCode}.${item.action}`,
      label: `${item.resourceName} · ${item.action}`,
      resourceCode: item.resourceCode,
      action: item.action,
      granted: true
    })
    groups.set(app, list)
  }

  return Array.from(groups.entries())
    .map(([app, actions]) => ({
      app,
      actions: actions.sort((a, b) => a.code.localeCompare(b.code))
    }))
    .sort((a, b) => a.app.localeCompare(b.app))
})

const permQuery = ref('')
const permStatus = ref<'all' | 'granted' | 'denied'>('all')
const permStatusItems = [
  { label: '状态：全部', value: 'all' },
  { label: '已授予', value: 'granted' },
  { label: '未授予', value: 'denied' }
]

const filteredPermGroups = computed(() => permGroups.value
  .map(group => ({
    app: group.app,
    actions: group.actions.filter((action) => {
      if (permQuery.value) {
        const kw = permQuery.value.toLowerCase()
        if (!action.code.toLowerCase().includes(kw) && !action.label.toLowerCase().includes(kw) && !action.resourceCode.toLowerCase().includes(kw)) {
          return false
        }
      }

      if (permStatus.value === 'granted' && !action.granted) {
        return false
      }

      if (permStatus.value === 'denied' && action.granted) {
        return false
      }

      return true
    })
  }))
  .filter(group => group.actions.length > 0))

const templateRows = computed<TemplateItem[]>(() => (data.value?.data.templates || []) as TemplateItem[])
const scopeRows = computed<ScopeItem[]>(() => (data.value?.data.scopes || []) as ScopeItem[])

const templateColumns: TableColumn<TemplateItem>[] = [
  { accessorKey: 'template', header: '模板' },
  { accessorKey: 'type', header: '类型' },
  { accessorKey: 'usageTenantCount', header: '使用租户', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'status', header: '状态' }
]

const tenantQuery = ref('')
const tenantRows = computed<TenantItem[]>(() => ((data.value?.data.tenants || []) as TenantItem[]).filter((tenant) => {
  if (!tenantQuery.value) {
    return true
  }

  const kw = tenantQuery.value.toLowerCase()
  return tenant.tenantName.toLowerCase().includes(kw) || tenant.tenantCode.toLowerCase().includes(kw)
}))

const tenantColumns: TableColumn<TenantItem>[] = [
  { accessorKey: 'tenant', header: '企业' },
  { accessorKey: 'localRoleCode', header: '本地角色' },
  { accessorKey: 'memberCount', header: '使用人数', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'status', header: '同步状态' }
]

const scopeColumns: TableColumn<ScopeItem>[] = [
  { accessorKey: 'permission', header: '权限' },
  { accessorKey: 'scope', header: '范围' },
  { accessorKey: 'status', header: '状态' }
]

const fetchErrorMessage = computed(() => {
  const err = error.value as { data?: { message?: string, statusMessage?: string }, message?: string, statusMessage?: string } | null
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || err?.message || '应用权限角色加载失败'
})

const editingMeta = ref(false)
const metaSaving = ref(false)
const metaForm = reactive({
  roleName: '',
  appCode: '',
  description: '',
  isRequired: false,
  status: 'active' as RoleStatus
})

function hydrateMetaForm() {
  if (!role.value) {
    return
  }

  metaForm.roleName = role.value.roleName
  metaForm.appCode = role.value.appCode || ''
  metaForm.description = role.value.description || ''
  metaForm.isRequired = role.value.isRequired
  metaForm.status = role.value.status as RoleStatus
}

watch(role, () => {
  if (!editingMeta.value) {
    hydrateMetaForm()
  }
}, { immediate: true })

function errorMessage(error: unknown, fallback: string) {
  const fetchError = error as FetchLikeError
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || fallback
}

function startMetaEdit() {
  hydrateMetaForm()
  editingMeta.value = true
}

function cancelMetaEdit() {
  editingMeta.value = false
  hydrateMetaForm()
}

async function saveMeta() {
  if (!role.value) {
    return
  }

  if (!metaForm.appCode.trim()) {
    toast.add({ title: '请选择所属应用', color: 'warning' })
    return
  }

  metaSaving.value = true
  try {
    await platformFetchJson<ApiEnvelope<SystemRoleDetail>>(
      `/api/platform/ops/system-roles/${encodeURIComponent(role.value.roleCode)}`,
      {
        method: 'PATCH',
        body: {
          roleName: metaForm.roleName.trim(),
          appCode: metaForm.appCode.trim(),
          description: metaForm.description.trim() || null,
          isRequired: metaForm.isRequired,
          status: metaForm.status
        }
      }
    )

    toast.add({ title: '应用权限角色已更新', description: role.value.roleCode, color: 'success' })
    editingMeta.value = false
    await refresh()
  } catch (error) {
    toast.add({ title: '更新失败', description: errorMessage(error, '应用权限角色更新失败'), color: 'error' })
  } finally {
    metaSaving.value = false
  }
}

function permissionCode(item: Pick<PermissionItem, 'appCode' | 'resourceCode' | 'action'>) {
  return `${item.appCode}.${item.resourceCode}.${item.action}`
}

const editingPermissions = ref(false)
const permissionSavePending = ref(false)
const actionPending = ref(false)
const actionError = ref('')
const actionQuery = ref('')
const permissionBrowserAppCode = ref('')
const actionMapByApp = reactive<Record<string, PermissionActionItem[]>>({})
const selectedActionCodes = ref<string[]>([])

const existingPermissionLookup = computed(() => {
  const map = new Map<string, PermissionActionItem>()
  for (const item of data.value?.data.permissions || []) {
    const actionCode = permissionCode(item)
    map.set(actionCode, {
      manifestActionId: item.manifestActionId,
      appCode: item.appCode,
      resourceCode: item.resourceCode,
      resourceName: item.resourceName,
      action: item.action,
      actionCode,
      actionName: null,
      description: null
    })
  }
  return map
})

const allActionLookup = computed(() => {
  const map = new Map(existingPermissionLookup.value)
  for (const appCode of Object.keys(actionMapByApp)) {
    for (const item of actionMapByApp[appCode] || []) {
      map.set(item.actionCode, item)
    }
  }
  return map
})

const selectedPermissions = computed(() => selectedActionCodes.value
  .map(actionCode => allActionLookup.value.get(actionCode))
  .filter((item): item is PermissionActionItem => Boolean(item)))

const selectedByApp = computed(() => {
  const map = new Map<string, number>()
  for (const item of selectedPermissions.value) {
    map.set(item.appCode, (map.get(item.appCode) || 0) + 1)
  }
  return Array.from(map.entries()).map(([appCode, count]) => ({ appCode, count })).sort((a, b) => a.appCode.localeCompare(b.appCode))
})

watch(permissions, (items) => {
  if (!editingPermissions.value) {
    selectedActionCodes.value = items.map(item => permissionCode(item))
  }
}, { immediate: true })

watch(permissionBrowserAppCode, async (appCode) => {
  if (!editingPermissions.value || !appCode) {
    return
  }

  await ensurePermissionActions(appCode)
})

async function ensurePermissionActions(appCode: string) {
  if (!appCode || actionMapByApp[appCode]) {
    return
  }

  actionPending.value = true
  actionError.value = ''

  try {
    const response = await platformFetchJson<ApiEnvelope<ResourceListResponse>>(
      `/api/platform/ops/applications/${encodeURIComponent(appCode)}/resources`,
      {
        query: {
          requiresGrant: 'true'
        }
      }
    )

    const flatten: PermissionActionItem[] = []
    for (const resource of response.data.items || []) {
      for (const action of resource.actions || []) {
        flatten.push({
          manifestActionId: action.id,
          appCode: resource.appCode,
          resourceCode: resource.resourceCode,
          resourceName: resource.resourceName,
          action: action.action,
          actionCode: action.actionCode,
          actionName: action.actionName,
          description: action.description
        })
      }
    }

    actionMapByApp[appCode] = flatten
  } catch (error) {
    actionError.value = errorMessage(error, '权限动作加载失败')
    actionMapByApp[appCode] = []
  } finally {
    actionPending.value = false
  }
}

const browserActions = computed(() => actionMapByApp[permissionBrowserAppCode.value] || [])

const groupedBrowserActions = computed(() => {
  const groups = new Map<string, { resourceCode: string, resourceName: string, actions: PermissionActionItem[] }>()

  for (const item of browserActions.value) {
    if (actionQuery.value) {
      const kw = actionQuery.value.toLowerCase()
      if (!item.actionCode.toLowerCase().includes(kw) && !item.resourceName.toLowerCase().includes(kw) && !(item.actionName || '').toLowerCase().includes(kw)) {
        continue
      }
    }

    const key = `${item.appCode}:${item.resourceCode}`
    if (!groups.has(key)) {
      groups.set(key, {
        resourceCode: item.resourceCode,
        resourceName: item.resourceName,
        actions: []
      })
    }
    groups.get(key)?.actions.push(item)
  }

  return Array.from(groups.values()).map(group => ({
    ...group,
    actions: group.actions.sort((a, b) => a.actionCode.localeCompare(b.actionCode))
  }))
})

function isActionSelected(actionCode: string) {
  return selectedActionCodes.value.includes(actionCode)
}

function setActionSelected(actionCode: string, enabled: boolean) {
  const set = new Set(selectedActionCodes.value)
  if (enabled) {
    set.add(actionCode)
  } else {
    set.delete(actionCode)
  }
  selectedActionCodes.value = Array.from(set)
}

function setResourceSelected(resource: { actions: PermissionActionItem[] }, enabled: boolean) {
  const set = new Set(selectedActionCodes.value)
  for (const action of resource.actions) {
    if (enabled) {
      set.add(action.actionCode)
    } else {
      set.delete(action.actionCode)
    }
  }
  selectedActionCodes.value = Array.from(set)
}

function isResourceFullySelected(resource: { actions: PermissionActionItem[] }) {
  if (resource.actions.length === 0) {
    return false
  }
  return resource.actions.every(item => selectedActionCodes.value.includes(item.actionCode))
}

async function startPermissionEdit() {
  selectedActionCodes.value = permissions.value.map(item => permissionCode(item))
  permissionBrowserAppCode.value = role.value?.appCode || data.value?.data.permissions[0]?.appCode || String(appOptions.value[0]?.value || '')
  editingPermissions.value = true
  if (permissionBrowserAppCode.value) {
    await ensurePermissionActions(permissionBrowserAppCode.value)
  }
}

function cancelPermissionEdit() {
  editingPermissions.value = false
  actionQuery.value = ''
  actionError.value = ''
  selectedActionCodes.value = permissions.value.map(item => permissionCode(item))
}

async function savePermissions() {
  if (!role.value) {
    return
  }

  permissionSavePending.value = true
  try {
    await platformFetchJson<ApiEnvelope<{ total: number }>>(
      `/api/platform/ops/system-roles/${encodeURIComponent(role.value.roleCode)}/permissions`,
      {
        method: 'PUT',
        body: {
          permissions: selectedPermissions.value.map(item => ({
            appCode: item.appCode,
            resourceCode: item.resourceCode,
            action: item.action,
            manifestActionId: item.manifestActionId
          }))
        }
      }
    )

    toast.add({ title: '默认权限已更新', description: `${selectedPermissions.value.length} 个动作`, color: 'success' })
    editingPermissions.value = false
    await refresh()
  } catch (error) {
    toast.add({ title: '权限保存失败', description: errorMessage(error, '默认权限保存失败'), color: 'error' })
  } finally {
    permissionSavePending.value = false
  }
}

const editingScopes = ref(false)
const scopeSavePending = ref(false)
const scopeDrafts = ref<ScopeDraft[]>([])
const scopeActionCode = ref('')
const scopeTypeInput = ref('')
const scopeValueInput = ref('')
const scopeStatusInput = ref<ScopeStatus>('active')

const currentPermissionOptions = computed<Array<{ value: string, label: string }>>(() => permissions.value.map(item => ({
  value: permissionCode(item),
  label: `${item.resourceName} · ${item.action} (${permissionCode(item)})`
})))

const currentPermissionLookup = computed(() => {
  const map = new Map<string, PermissionItem>()
  for (const item of permissions.value) {
    map.set(permissionCode(item), item)
  }
  return map
})

function startScopeEdit() {
  scopeDrafts.value = scopeRows.value.map(item => ({
    appCode: item.appCode,
    resourceCode: item.resourceCode,
    resourceName: item.resourceName,
    action: item.action,
    manifestActionId: item.manifestActionId,
    scopeType: item.scopeType,
    scopeValue: item.scopeValue,
    status: item.status === 'disabled' ? 'disabled' : 'active'
  }))
  scopeActionCode.value = currentPermissionOptions.value[0]?.value || ''
  scopeTypeInput.value = ''
  scopeValueInput.value = ''
  scopeStatusInput.value = 'active'
  editingScopes.value = true
}

function cancelScopeEdit() {
  editingScopes.value = false
  scopeDrafts.value = []
  scopeTypeInput.value = ''
  scopeValueInput.value = ''
}

function addScopeDraft() {
  const permission = currentPermissionLookup.value.get(scopeActionCode.value)
  const scopeType = scopeTypeInput.value.trim()
  const scopeValue = scopeValueInput.value.trim()

  if (!permission || !scopeType || !scopeValue) {
    toast.add({ title: '范围未填写完整', description: '请选择权限动作并填写 scopeType / scopeValue', color: 'warning' })
    return
  }

  const duplicate = scopeDrafts.value.some(item =>
    item.appCode === permission.appCode
    && item.resourceCode === permission.resourceCode
    && item.action === permission.action
    && item.scopeType === scopeType
    && item.scopeValue === scopeValue
  )

  if (duplicate) {
    toast.add({ title: '范围已存在', description: `${scopeType}=${scopeValue}`, color: 'warning' })
    return
  }

  scopeDrafts.value.push({
    appCode: permission.appCode,
    resourceCode: permission.resourceCode,
    resourceName: permission.resourceName,
    action: permission.action,
    manifestActionId: permission.manifestActionId,
    scopeType,
    scopeValue,
    status: scopeStatusInput.value
  })
  scopeTypeInput.value = ''
  scopeValueInput.value = ''
}

function removeScopeDraft(index: number) {
  scopeDrafts.value.splice(index, 1)
}

async function saveScopes() {
  if (!role.value) {
    return
  }

  scopeSavePending.value = true
  try {
    await platformFetchJson<ApiEnvelope<{ total: number }>>(
      `/api/platform/ops/system-roles/${encodeURIComponent(role.value.roleCode)}/scopes`,
      {
        method: 'PUT',
        body: {
          scopes: scopeDrafts.value.map(item => ({
            appCode: item.appCode,
            resourceCode: item.resourceCode,
            action: item.action,
            manifestActionId: item.manifestActionId,
            scopeType: item.scopeType,
            scopeValue: item.scopeValue,
            status: item.status
          }))
        }
      }
    )

    toast.add({ title: '默认范围已更新', description: `${scopeDrafts.value.length} 条 scope`, color: 'success' })
    editingScopes.value = false
    await refresh()
  } catch (error) {
    toast.add({ title: '范围保存失败', description: errorMessage(error, '默认范围保存失败'), color: 'error' })
  } finally {
    scopeSavePending.value = false
  }
}

function copyCode() {
  if (!role.value) {
    return
  }

  navigator.clipboard?.writeText(role.value.roleCode)
  toast.add({ title: '已复制 code', description: role.value.roleCode, color: 'success' })
}

function backToList() {
  router.push('/admin/system-roles')
}
</script>

<template>
  <div>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :title="fetchErrorMessage"
      class="mb-4"
    >
      <template #actions>
        <UButton
          color="error"
          variant="ghost"
          size="sm"
          icon="i-lucide-refresh-cw"
          @click="() => refresh()"
        >
          重试
        </UButton>
      </template>
    </UAlert>

    <UCard
      v-else-if="pending && !role"
    >
      <UEmpty
        icon="i-lucide-loader-circle"
        title="加载应用权限角色中"
        description="正在从数据库读取应用权限角色详情。"
      />
    </UCard>

    <UCard
      v-else-if="!role"
    >
      <UEmpty
        icon="i-lucide-shield-off"
        title="未找到应用权限角色"
        description="该角色可能已被删除，或 code 不存在。"
      >
        <template #actions>
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-arrow-left"
            @click="backToList"
          >
            返回列表
          </UButton>
        </template>
      </UEmpty>
    </UCard>

    <template v-else>
      <UBreadcrumb
        :items="crumbs"
        class="mb-4"
      />

      <div class="entity-header">
        <div class="flex items-start gap-3 min-w-0">
          <div class="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-muted">
            <UIcon
              name="i-lucide-shield"
              class="size-5"
            />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-xl font-semibold text-highlighted">
                {{ role.roleName }}
              </h1>
              <UBadge
                :color="STATUS_TONE[role.status] || 'neutral'"
                variant="soft"
                size="sm"
              >
                {{ role.status }}
              </UBadge>
              <UBadge
                v-if="role.isRequired"
                color="warning"
                variant="soft"
                size="sm"
              >
                required
              </UBadge>
            </div>
            <div class="mono text-dimmed text-xs mt-0.5">
              {{ role.roleCode }}
            </div>
            <div class="flex items-center gap-2 mt-2 flex-wrap">
              <UBadge
                color="neutral"
                variant="soft"
                size="sm"
              >
                {{ role.appCode || '未关联应用' }}
              </UBadge>
              <span class="text-muted text-sm">{{ role.description || '未设置描述' }}</span>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-pencil"
            @click="startMetaEdit"
          >
            编辑
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            square
            :loading="pending"
            @click="() => refresh()"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-copy"
            square
            @click="copyCode"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            @click="backToList"
          >
            返回
          </UButton>
        </div>
      </div>

      <UCard
        v-if="editingMeta"
        class="mt-4"
      >
        <template #header>
          <div class="font-medium text-highlighted">
            编辑基础信息
          </div>
        </template>

        <div class="col gap-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField
              label="角色名称"
              required
            >
              <UInput
                v-model="metaForm.roleName"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="状态"
              required
            >
              <USelect
                v-model="metaForm.status"
                :items="roleStatusItems"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField
              label="所属应用"
              required
            >
              <USelect
                v-model="metaForm.appCode"
                :items="appOptions"
                class="w-full"
                :disabled="applicationsPending"
                placeholder="选择 appCode"
              />
            </UFormField>
          </div>

          <UFormField label="描述">
            <UTextarea
              v-model="metaForm.description"
              :rows="3"
              class="w-full"
            />
          </UFormField>

          <div class="flex items-center justify-between gap-4">
            <UCheckbox
              v-model="metaForm.isRequired"
              label="标记为必选应用权限角色"
            />
            <div class="flex items-center gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                @click="cancelMetaEdit"
              >
                取消
              </UButton>
              <UButton
                color="primary"
                icon="i-lucide-save"
                :loading="metaSaving"
                @click="saveMeta"
              >
                保存
              </UButton>
            </div>
          </div>
        </div>
      </UCard>

      <UTabs
        v-model="tab"
        :items="tabItems"
        :content="false"
        class="mt-6"
      />

      <div
        v-if="tab === 'permissions'"
        class="mt-4"
      >
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <div class="toolbar">
            <template v-if="editingPermissions">
              <USelect
                v-model="permissionBrowserAppCode"
                :items="appOptions"
                size="sm"
                class="w-60"
                :disabled="applicationsPending || appOptions.length === 0"
                placeholder="选择应用"
              />
              <UInput
                v-model="actionQuery"
                icon="i-lucide-search"
                placeholder="搜索 manifest action…"
                size="sm"
                class="w-full max-w-70"
              />
            </template>
            <template v-else>
              <UInput
                v-model="permQuery"
                icon="i-lucide-search"
                placeholder="搜索权限…"
                size="sm"
                class="w-full max-w-70"
              />
              <USelect
                v-model="permStatus"
                :items="permStatusItems"
                size="sm"
                class="w-36"
              />
            </template>
            <span class="grow" />
            <span class="text-muted text-xs">
              {{ editingPermissions ? `已选 ${selectedPermissions.length}` : `共 ${role.permissionCount} 个权限` }}
            </span>
            <template v-if="editingPermissions">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                @click="cancelPermissionEdit"
              >
                取消
              </UButton>
              <UButton
                color="primary"
                size="sm"
                icon="i-lucide-save"
                :loading="permissionSavePending"
                @click="savePermissions"
              >
                保存权限
              </UButton>
            </template>
            <UButton
              v-else
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-pencil"
              @click="startPermissionEdit"
            >
              编辑权限
            </UButton>
          </div>

          <div
            v-if="editingPermissions"
            class="p-4 col gap-4"
          >
            <UAlert
              v-if="actionError"
              color="warning"
              variant="soft"
              :title="actionError"
            />

            <UEmpty
              v-if="appOptions.length === 0"
              icon="i-lucide-box"
              title="暂无可用应用"
              description="请先在应用管理中完成应用注册与 manifest 导入。"
            />

            <UEmpty
              v-else-if="groupedBrowserActions.length === 0 && !actionPending"
              icon="i-lucide-shield-off"
              title="当前应用没有可授予动作"
              description="该应用可能还未导入 manifest，或所有动作都被标记为无需授权。"
            />

            <div
              v-else
              class="edit-perm-table"
            >
              <div class="edit-perm-row perm-head">
                <div>资源 / 动作</div>
                <div>Action Code</div>
                <div class="text-right">
                  选择
                </div>
              </div>

              <template
                v-for="group in groupedBrowserActions"
                :key="group.resourceCode"
              >
                <div class="edit-perm-row perm-resource">
                  <div class="font-medium text-highlighted">
                    {{ group.resourceName }}
                    <span class="mono text-dimmed text-xs">({{ group.resourceCode }})</span>
                  </div>
                  <div class="text-muted text-xs">
                    {{ group.actions.length }} actions
                  </div>
                  <div class="text-right">
                    <UCheckbox
                      :model-value="isResourceFullySelected(group)"
                      :label="isResourceFullySelected(group) ? '已全选' : '全选'"
                      @update:model-value="(value) => setResourceSelected(group, Boolean(value))"
                    />
                  </div>
                </div>

                <div
                  v-for="action in group.actions"
                  :key="action.actionCode"
                  class="edit-perm-row perm-action"
                >
                  <div class="pl-5">
                    <div class="font-medium text-highlighted">
                      {{ action.actionName || action.action }}
                    </div>
                    <div
                      v-if="action.description"
                      class="text-dimmed text-xs"
                    >
                      {{ action.description }}
                    </div>
                  </div>
                  <div class="mono text-muted text-xs">
                    {{ action.actionCode }}
                  </div>
                  <div class="text-right">
                    <UCheckbox
                      :model-value="isActionSelected(action.actionCode)"
                      @update:model-value="(value) => setActionSelected(action.actionCode, Boolean(value))"
                    />
                  </div>
                </div>
              </template>
            </div>

            <div
              v-if="selectedByApp.length > 0"
              class="flex flex-wrap gap-2"
            >
              <UBadge
                v-for="item in selectedByApp"
                :key="item.appCode"
                color="info"
                variant="soft"
              >
                {{ item.appCode }}: {{ item.count }}
              </UBadge>
            </div>
          </div>

          <div
            v-else
            class="perm-table"
          >
            <div class="perm-row perm-head">
              <div>App / Action</div>
              <div>资源</div>
              <div>Action Code</div>
              <div class="text-right">
                授予
              </div>
            </div>

            <UEmpty
              v-if="filteredPermGroups.length === 0"
              icon="i-lucide-search"
              title="无匹配权限"
              description="尝试调整筛选条件。"
              class="py-10"
            />

            <template
              v-for="group in filteredPermGroups"
              v-else
              :key="group.app"
            >
              <div class="perm-row perm-resource">
                <div class="flex items-center gap-2">
                  <UIcon
                    name="i-lucide-box"
                    class="size-3.5 text-muted"
                  />
                  <span class="font-medium text-highlighted">{{ group.app }}</span>
                </div>
                <div class="text-muted">
                  —
                </div>
                <div />
                <div class="text-right text-xs text-muted">
                  {{ group.actions.filter((action) => action.granted).length }} / {{ group.actions.length }}
                </div>
              </div>
              <div
                v-for="action in group.actions"
                :key="action.code"
                class="perm-row perm-action"
              >
                <div class="flex items-center gap-2 pl-5">
                  <span class="text-dimmed">└</span>
                  <span>{{ action.label }}</span>
                </div>
                <div class="mono text-muted text-xs">
                  {{ action.resourceCode }}
                </div>
                <div class="mono text-muted text-xs">
                  {{ action.code }}
                </div>
                <div class="text-right">
                  <UBadge
                    v-if="action.granted"
                    color="success"
                    variant="soft"
                    size="sm"
                    icon="i-lucide-check"
                  >
                    已授予
                  </UBadge>
                  <span
                    v-else
                    class="text-dimmed text-xs"
                  >—</span>
                </div>
              </div>
            </template>
          </div>
        </UCard>
      </div>

      <div
        v-if="tab === 'scopes'"
        class="mt-4"
      >
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <div class="toolbar">
            <div>
              <div class="font-medium text-highlighted">
                默认范围
              </div>
              <div class="text-muted text-xs">
                {{ editingScopes ? `${scopeDrafts.length} 条待保存` : `${scopeRows.length} 条 scope` }}
              </div>
            </div>
            <span class="grow" />
            <template v-if="editingScopes">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                @click="cancelScopeEdit"
              >
                取消
              </UButton>
              <UButton
                color="primary"
                icon="i-lucide-save"
                size="sm"
                :loading="scopeSavePending"
                @click="saveScopes"
              >
                保存范围
              </UButton>
            </template>
            <UButton
              v-else
              color="neutral"
              variant="soft"
              size="sm"
              icon="i-lucide-crosshair"
              @click="startScopeEdit"
            >
              编辑范围
            </UButton>
          </div>

          <div
            v-if="editingScopes"
            class="p-4 col gap-4"
          >
            <div class="scope-editor-grid">
              <UFormField label="权限动作">
                <USelect
                  v-model="scopeActionCode"
                  :items="currentPermissionOptions"
                  class="w-full"
                  :disabled="currentPermissionOptions.length === 0"
                  placeholder="选择权限动作"
                />
              </UFormField>
              <UFormField label="scopeType">
                <UInput
                  v-model="scopeTypeInput"
                  class="w-full"
                  placeholder="department"
                />
              </UFormField>
              <UFormField label="scopeValue">
                <UInput
                  v-model="scopeValueInput"
                  class="w-full"
                  placeholder="self_and_children"
                />
              </UFormField>
              <UFormField label="状态">
                <USelect
                  v-model="scopeStatusInput"
                  :items="scopeStatusItems"
                  class="w-full"
                />
              </UFormField>
              <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-plus"
                :disabled="currentPermissionOptions.length === 0"
                @click="addScopeDraft"
              >
                添加
              </UButton>
            </div>

            <UEmpty
              v-if="scopeDrafts.length === 0"
              icon="i-lucide-crosshair"
              title="未配置默认范围"
              description="添加 scope 后会随应用权限角色映射进入企业角色的有效权限。"
              class="py-10"
            />

            <div
              v-else
              class="scope-draft-table"
            >
              <div class="scope-draft-row perm-head">
                <div>权限</div>
                <div>范围</div>
                <div>状态</div>
                <div />
              </div>
              <div
                v-for="(item, index) in scopeDrafts"
                :key="`${item.appCode}.${item.resourceCode}.${item.action}.${item.scopeType}.${item.scopeValue}`"
                class="scope-draft-row"
              >
                <div>
                  <div class="font-medium text-highlighted">
                    {{ item.resourceName }} · {{ item.action }}
                  </div>
                  <div class="mono text-dimmed text-xs">
                    {{ item.appCode }}.{{ item.resourceCode }}.{{ item.action }}
                  </div>
                </div>
                <div class="mono text-muted text-xs">
                  {{ item.scopeType }}={{ item.scopeValue }}
                </div>
                <div>
                  <UBadge
                    :color="STATUS_TONE[item.status] || 'neutral'"
                    variant="soft"
                    size="sm"
                  >
                    {{ item.status }}
                  </UBadge>
                </div>
                <div class="text-right">
                  <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    square
                    @click="removeScopeDraft(index)"
                  />
                </div>
              </div>
            </div>
          </div>

          <template v-else>
            <UEmpty
              v-if="scopeRows.length === 0"
              icon="i-lucide-crosshair"
              title="未配置默认范围"
              description="此角色当前只有权限动作，没有额外 scope 约束。"
              class="py-10"
            />
            <UTable
              v-else
              :data="scopeRows"
              :columns="scopeColumns"
              :ui="{
                th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
                td: 'text-sm text-muted whitespace-nowrap'
              }"
            >
              <template #permission-cell="{ row }">
                <div class="font-medium text-highlighted">
                  {{ row.original.resourceName }} · {{ row.original.action }}
                </div>
                <div class="mono text-dimmed text-xs">
                  {{ row.original.appCode }}.{{ row.original.resourceCode }}.{{ row.original.action }}
                </div>
              </template>
              <template #scope-cell="{ row }">
                <span class="mono text-muted text-xs">
                  {{ row.original.scopeType }}={{ row.original.scopeValue }}
                </span>
              </template>
              <template #status-cell="{ row }">
                <UBadge
                  :color="STATUS_TONE[row.original.status] || 'neutral'"
                  variant="soft"
                  size="sm"
                >
                  {{ row.original.status }}
                </UBadge>
              </template>
            </UTable>
          </template>
        </UCard>
      </div>

      <div
        v-if="tab === 'templates'"
        class="mt-4"
      >
        <UCard
          v-if="templateRows.length === 0"
        >
          <UEmpty
            icon="i-lucide-file-text"
            title="未被模板引用"
            description="此应用权限角色目前未被任何企业系统角色引用。"
          />
        </UCard>
        <UCard
          v-else
          :ui="{ body: 'p-0 sm:p-0' }"
        >
          <UTable
            :data="templateRows"
            :columns="templateColumns"
            :ui="{
              th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
              td: 'text-sm text-muted whitespace-nowrap'
            }"
          >
            <template #template-cell="{ row }">
              <div class="font-medium text-highlighted">
                {{ row.original.templateName }}
              </div>
              <div class="mono text-dimmed text-xs">
                {{ row.original.templateCode }}
              </div>
            </template>
            <template #type-cell="{ row }">
              <UBadge
                color="info"
                variant="soft"
                size="sm"
              >
                {{ row.original.templateType }}
              </UBadge>
            </template>
            <template #usageTenantCount-cell="{ row }">
              <span class="mono text-highlighted">{{ row.original.usageTenantCount }}</span>
            </template>
            <template #status-cell="{ row }">
              <UBadge
                :color="STATUS_TONE[row.original.status] || 'neutral'"
                variant="soft"
                size="sm"
              >
                {{ row.original.status }}
              </UBadge>
            </template>
          </UTable>
        </UCard>
      </div>

      <div
        v-if="tab === 'tenants'"
        class="mt-4"
      >
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <div class="toolbar">
            <UInput
              v-model="tenantQuery"
              icon="i-lucide-search"
              placeholder="搜索企业…"
              size="sm"
              class="w-full max-w-60"
            />
            <span class="grow" />
            <span class="text-muted text-xs">共 {{ role.tenantCount }} 个企业继承此角色</span>
          </div>
          <UEmpty
            v-if="tenantRows.length === 0"
            icon="i-lucide-search"
            title="无匹配企业"
            class="py-10"
          />
          <UTable
            v-else
            :data="tenantRows"
            :columns="tenantColumns"
            :ui="{
              th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
              td: 'text-sm text-muted whitespace-nowrap'
            }"
          >
            <template #tenant-cell="{ row }">
              <div>
                <div class="font-medium text-highlighted">
                  {{ row.original.tenantName }}
                </div>
                <div class="mono text-dimmed text-xs">
                  {{ row.original.tenantCode }}
                </div>
              </div>
            </template>
            <template #localRoleCode-cell="{ row }">
              <span class="mono text-muted text-xs">{{ row.original.localRoleCode }}</span>
            </template>
            <template #memberCount-cell="{ row }">
              <span class="mono text-highlighted">{{ row.original.memberCount }}</span>
            </template>
            <template #status-cell="{ row }">
              <UBadge
                :color="STATUS_TONE[row.original.status] || 'neutral'"
                variant="soft"
                size="sm"
              >
                {{ row.original.status }}
              </UBadge>
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </div>
</template>

<style scoped>
.entity-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--ui-border);
}

.perm-table,
.edit-perm-table,
.scope-draft-table {
  display: flex;
  flex-direction: column;
}

.edit-perm-table,
.scope-draft-table {
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  overflow: hidden;
}

.perm-row,
.edit-perm-row,
.scope-draft-row {
  display: grid;
  gap: 1rem;
  padding: 0.625rem 0.875rem;
  font-size: 0.875rem;
  align-items: center;
  border-bottom: 1px solid var(--ui-border);
}

.perm-row {
  grid-template-columns: minmax(220px, 1.6fr) minmax(140px, 1fr) minmax(180px, 1.1fr) 120px;
}

.edit-perm-row {
  grid-template-columns: minmax(260px, 1.4fr) minmax(220px, 1fr) 130px;
}

.scope-draft-row {
  grid-template-columns: minmax(260px, 1.4fr) minmax(200px, 1fr) 120px 56px;
}

.perm-row:last-child,
.edit-perm-row:last-child,
.scope-draft-row:last-child {
  border-bottom: none;
}

.perm-head {
  background: var(--ui-bg-muted);
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ui-text-muted);
}

.perm-resource {
  background: var(--ui-bg-elevated);
}

.perm-action {
  color: var(--ui-text);
}

.scope-editor-grid {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 180px 180px 140px auto;
  gap: 0.75rem;
  align-items: end;
}

@media (max-width: 900px) {
  .entity-header {
    flex-direction: column;
  }

  .perm-row,
  .edit-perm-row,
  .scope-draft-row,
  .scope-editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>
