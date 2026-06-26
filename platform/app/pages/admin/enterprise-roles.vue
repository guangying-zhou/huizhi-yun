<script setup lang="ts">
definePageMeta({
  layout: 'platform'
})

usePageTitle('企业角色')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface EnterpriseRoleItem {
  id: number
  roleCode: string
  roleName: string
  roleType: string
  description: string | null
  isRequired: boolean
  sortOrder: number
  status: string
  policyRevision: number
  policyHash: string | null
  policyUpdatedAt: string | null
  appRoleCount: number
  permissionCount: number
  tenantCount: number
}

interface EnterpriseRoleListResponse {
  items: EnterpriseRoleItem[]
  total: number
  page: number
  pageSize: number
}

interface AppRoleItem {
  roleCode: string
  roleName: string
  appCode: string
  description?: string | null
  status?: string
  permissionCount: number
}

interface AppRoleListResponse {
  items: AppRoleItem[]
  total: number
}

interface EnterpriseRoleDetailResponse {
  role: EnterpriseRoleItem
  appRoles: Array<{
    appRoleCode: string
    appCode: string
    roleName: string
    permissionCount: number
    sortOrder: number
  }>
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'info'> = {
  active: 'success',
  suspended: 'warning',
  disabled: 'neutral',
  draft: 'info'
}

const roleTypeItems = [
  { label: '全部类型', value: 'all' },
  { label: '标准企业角色', value: 'system' },
  { label: '高管角色', value: 'executive' },
  { label: '职能角色', value: 'department' }
]

const statusItems = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'active' },
  { label: '暂停', value: 'suspended' },
  { label: '停用', value: 'disabled' }
]

const q = ref('')
const roleType = ref('all')
const status = ref('all')
const pending = ref(false)
const savingMeta = ref(false)
const savingMaps = ref(false)
const metaModalOpen = ref(false)
const selectedCode = ref<string | null>(null)
const roles = ref<EnterpriseRoleItem[]>([])
const total = ref(0)
const appRoles = ref<AppRoleItem[]>([])
const selectedAppRoleCodes = ref<string[]>([])
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)
const formMode = ref<'create' | 'edit'>('create')

const form = reactive({
  roleCode: '',
  roleName: '',
  roleType: 'system',
  description: '',
  isRequired: false,
  sortOrder: 0,
  status: 'active'
})

const editableRoleTypeItems = roleTypeItems.filter(item => item.value !== 'all')
const editableStatusItems = statusItems.filter(item => item.value !== 'all')
const selectedRole = computed(() => roles.value.find(item => item.roleCode === selectedCode.value) || null)
const appRolesByApp = computed(() => {
  const groups = new Map<string, AppRoleItem[]>()
  for (const role of appRoles.value) {
    const list = groups.get(role.appCode) || []
    list.push(role)
    groups.set(role.appCode, list)
  }

  return Array.from(groups.entries())
    .map(([appCode, items]) => ({
      appCode,
      items: items.sort((a, b) => a.roleCode.localeCompare(b.roleCode))
    }))
    .sort((a, b) => a.appCode.localeCompare(b.appCode))
})

const selectedPermissionCount = computed(() => appRoles.value
  .filter(item => selectedAppRoleCodes.value.includes(item.roleCode))
  .reduce((sum, item) => sum + Number(item.permissionCount || 0), 0))

function roleTypeLabel(value: string) {
  return roleTypeItems.find(item => item.value === value)?.label || value
}

function statusLabel(value: string) {
  return statusItems.find(item => item.value === value)?.label || value
}

function isAppRoleSelected(roleCode: string) {
  return selectedAppRoleCodes.value.includes(roleCode)
}

function setAppRoleSelected(roleCode: string, checked: boolean) {
  if (checked) {
    if (!selectedAppRoleCodes.value.includes(roleCode)) {
      selectedAppRoleCodes.value = [...selectedAppRoleCodes.value, roleCode]
    }
    return
  }

  selectedAppRoleCodes.value = selectedAppRoleCodes.value.filter(item => item !== roleCode)
}

function setNotice(type: 'success' | 'error', message: string) {
  notice.value = { type, message }
}

function errorMessage(error: unknown, fallback: string) {
  const err = error as { data?: { message?: string, statusMessage?: string }, message?: string, statusMessage?: string }
  return err?.data?.message || err?.data?.statusMessage || err?.statusMessage || err?.message || fallback
}

function resetForm() {
  formMode.value = 'create'
  selectedCode.value = null
  form.roleCode = ''
  form.roleName = ''
  form.roleType = 'system'
  form.description = ''
  form.isRequired = false
  form.sortOrder = 0
  form.status = 'active'
  selectedAppRoleCodes.value = []
}

function openCreateModal() {
  resetForm()
  metaModalOpen.value = true
}

function fillForm(role: EnterpriseRoleItem) {
  formMode.value = 'edit'
  selectedCode.value = role.roleCode
  form.roleCode = role.roleCode
  form.roleName = role.roleName
  form.roleType = role.roleType
  form.description = role.description || ''
  form.isRequired = role.isRequired
  form.sortOrder = role.sortOrder
  form.status = role.status
}

function openEditModal(role: EnterpriseRoleItem) {
  fillForm(role)
  metaModalOpen.value = true
}

async function loadRoles() {
  pending.value = true
  try {
    const response = await platformFetchJson<ApiEnvelope<EnterpriseRoleListResponse>>('/api/platform/ops/enterprise-roles', {
      query: {
        keyword: q.value || undefined,
        roleType: roleType.value === 'all' ? undefined : roleType.value,
        status: status.value === 'all' ? undefined : status.value,
        page: 1,
        pageSize: 100
      }
    })
    roles.value = response.data.items
    total.value = response.data.total
  } catch (error) {
    setNotice('error', errorMessage(error, '企业角色加载失败'))
  } finally {
    pending.value = false
  }
}

async function loadAppRoles() {
  const response = await platformFetchJson<ApiEnvelope<AppRoleListResponse>>('/api/platform/ops/app-roles', {
    query: {
      status: 'active',
      page: 1,
      pageSize: 100
    }
  })
  appRoles.value = response.data.items
}

async function selectRole(role: EnterpriseRoleItem) {
  fillForm(role)
  const response = await platformFetchJson<ApiEnvelope<EnterpriseRoleDetailResponse>>(
    `/api/platform/ops/enterprise-roles/${encodeURIComponent(role.roleCode)}`
  )
  selectedAppRoleCodes.value = response.data.appRoles.map(item => item.appRoleCode)
}

async function saveMeta() {
  if (!form.roleCode.trim() || !form.roleName.trim()) {
    setNotice('error', 'roleCode 和 roleName 不能为空')
    return
  }

  savingMeta.value = true
  notice.value = null
  try {
    const wasCreate = formMode.value === 'create'
    const payload = {
      roleCode: form.roleCode.trim(),
      roleName: form.roleName.trim(),
      roleType: form.roleType.trim() || 'system',
      description: form.description.trim() || null,
      isRequired: form.isRequired,
      sortOrder: Number(form.sortOrder || 0),
      status: form.status
    }

    const response = wasCreate
      ? await platformFetchJson<ApiEnvelope<EnterpriseRoleItem>>('/api/platform/ops/enterprise-roles', {
          method: 'POST',
          body: payload
        })
      : await platformFetchJson<ApiEnvelope<EnterpriseRoleItem>>(`/api/platform/ops/enterprise-roles/${encodeURIComponent(form.roleCode)}`, {
          method: 'PATCH',
          body: {
            roleName: payload.roleName,
            roleType: payload.roleType,
            description: payload.description,
            isRequired: payload.isRequired,
            sortOrder: payload.sortOrder,
            status: payload.status
          }
        })

    await loadRoles()
    fillForm(response.data)
    metaModalOpen.value = false
    setNotice('success', wasCreate ? '企业角色已创建' : '企业角色已更新')
  } catch (error) {
    setNotice('error', errorMessage(error, '企业角色保存失败'))
  } finally {
    savingMeta.value = false
  }
}

async function saveAppRoleMaps() {
  if (!selectedCode.value) {
    setNotice('error', '请先选择或创建企业角色')
    return
  }

  savingMaps.value = true
  notice.value = null
  try {
    await $fetch(`/api/platform/ops/enterprise-roles/${encodeURIComponent(selectedCode.value)}/app-roles`, {
      method: 'PUT',
      body: {
        appRoles: selectedAppRoleCodes.value.map(appRoleCode => ({ appRoleCode }))
      }
    })
    await loadRoles()
    setNotice('success', '企业角色默认应用权限已保存')
  } catch (error) {
    setNotice('error', errorMessage(error, '应用权限角色保存失败'))
  } finally {
    savingMaps.value = false
  }
}

const debouncedLoadRoles = useDebounceFn(loadRoles, 250)

watch([q, roleType, status], () => {
  debouncedLoadRoles()
})

onMounted(async () => {
  await Promise.all([loadRoles(), loadAppRoles()])
})
</script>

<template>
  <div>
    <div class="page-h">
      <div>
        <h1>企业角色</h1>
        <p>维护平台预置企业角色母版，并配置每个角色默认包含的应用权限角色。</p>
      </div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="loadRoles"
        >
          刷新
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-plus"
          @click="openCreateModal"
        >
          新建企业角色
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="notice"
      class="mb-4"
      :color="notice.type === 'success' ? 'success' : 'error'"
      variant="soft"
      :title="notice.message"
    />

    <div class="enterprise-role-layout">
      <UCard
        :ui="{ body: 'p-0 sm:p-0' }"
      >
        <template #header>
          <div class="enterprise-role-filters">
            <UInput
              v-model="q"
              icon="i-lucide-search"
              placeholder="搜索角色名 / code / 描述"
              size="sm"
              class="enterprise-role-search"
            />
            <USelect
              v-model="roleType"
              :items="roleTypeItems"
              size="sm"
              class="enterprise-role-filter-select"
            />
            <USelect
              v-model="status"
              :items="statusItems"
              size="sm"
              class="enterprise-role-filter-select"
            />
          </div>
        </template>

        <UEmpty
          v-if="pending && roles.length === 0"
          icon="i-lucide-loader-circle"
          title="加载企业角色中"
          description="正在读取平台企业角色母版。"
          class="py-14"
        />

        <div
          v-else-if="roles.length === 0"
          class="px-4 py-12 text-center text-sm text-muted"
        >
          当前没有匹配的企业角色。
        </div>

        <div
          v-else
          class="divide-y divide-default"
        >
          <button
            v-for="role in roles"
            :key="role.roleCode"
            type="button"
            class="enterprise-role-row"
            :class="{ 'is-selected': selectedCode === role.roleCode }"
            @click="selectRole(role)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <p class="truncate text-sm font-medium text-highlighted">
                    {{ role.roleName }}
                  </p>
                  <UBadge
                    :color="STATUS_TONE[role.status] || 'neutral'"
                    variant="soft"
                    size="sm"
                  >
                    {{ statusLabel(role.status) }}
                  </UBadge>
                </div>
                <p class="mono mt-1 truncate text-xs text-dimmed">
                  {{ role.roleCode }}
                </p>
                <p class="mt-2 line-clamp-2 text-xs text-muted">
                  {{ role.description || '未设置描述' }}
                </p>
              </div>
              <div class="shrink-0 text-right text-xs text-muted">
                <div>
                  {{ roleTypeLabel(role.roleType) }}
                </div>
                <div class="mt-1">
                  {{ role.appRoleCount }} 应用角色
                </div>
                <div class="mt-1">
                  {{ role.tenantCount }} 企业继承
                </div>
              </div>
            </div>
          </button>
        </div>

        <template #footer>
          <div class="flex items-center justify-between text-xs text-muted">
            <span>共 {{ total }} 条</span>
            <span>按 sortOrder / roleCode 排序</span>
          </div>
        </template>
      </UCard>

      <div class="grid gap-4">
        <UCard>
          <template #header>
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="font-medium text-highlighted">
                  企业角色详情
                </div>
                <p class="mt-0.5 text-sm text-muted">
                  选择左侧角色后查看基础信息，并配置默认权限组合。
                </p>
              </div>
              <UButton
                v-if="selectedRole"
                color="neutral"
                variant="soft"
                icon="i-lucide-pencil"
                @click="openEditModal(selectedRole)"
              >
                编辑基础信息
              </UButton>
            </div>
          </template>

          <div
            v-if="!selectedRole"
            class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
          >
            从左侧选择一个企业角色，或点击右上角新建企业角色。
          </div>

          <div
            v-else
            class="grid gap-3 text-sm md:grid-cols-2"
          >
            <div>
              <div class="text-xs text-muted">
                角色名称
              </div>
              <div class="mt-1 font-medium text-highlighted">
                {{ selectedRole.roleName }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted">
                角色 Code
              </div>
              <div class="mono mt-1 text-highlighted">
                {{ selectedRole.roleCode }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted">
                角色类型
              </div>
              <div class="mt-1">
                {{ roleTypeLabel(selectedRole.roleType) }}
              </div>
            </div>
            <div>
              <div class="text-xs text-muted">
                状态
              </div>
              <UBadge
                class="mt-1"
                :color="STATUS_TONE[selectedRole.status] || 'neutral'"
                variant="soft"
              >
                {{ statusLabel(selectedRole.status) }}
              </UBadge>
            </div>
            <div>
              <div class="text-xs text-muted">
                默认应用权限角色
              </div>
              <div class="mt-1">
                {{ selectedRole.appRoleCount }} 个
              </div>
            </div>
            <div>
              <div class="text-xs text-muted">
                企业继承
              </div>
              <div class="mt-1">
                {{ selectedRole.tenantCount }} 个企业
              </div>
            </div>
            <div class="md:col-span-2">
              <div class="text-xs text-muted">
                描述
              </div>
              <div class="mt-1 text-muted">
                {{ selectedRole.description || '未设置描述' }}
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="font-medium text-highlighted">
                  默认应用权限角色
                </div>
                <p class="mt-0.5 text-sm text-muted">
                  企业启用该角色时，会继承这里选择的应用权限角色。
                </p>
              </div>
              <div class="text-right text-xs text-muted">
                <div>已选 {{ selectedAppRoleCodes.length }} 个</div>
                <div>{{ selectedPermissionCount }} 项权限</div>
              </div>
            </div>
          </template>

          <div
            v-if="!selectedCode"
            class="rounded-lg border border-dashed border-default px-4 py-10 text-center text-sm text-muted"
          >
            先创建或选择一个企业角色，再配置默认应用权限角色。
          </div>

          <div
            v-else
            class="space-y-4"
          >
            <div class="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted">
              当前企业角色：
              <span class="font-medium text-highlighted">{{ selectedRole?.roleName || form.roleName }}</span>
              <span class="mono text-dimmed">({{ selectedCode }})</span>
            </div>

            <div
              v-if="appRolesByApp.length === 0"
              class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
            >
              当前还没有可绑定的应用权限角色。
            </div>

            <div
              v-for="group in appRolesByApp"
              :key="group.appCode"
              class="space-y-2"
            >
              <div class="mono text-xs font-medium text-muted">
                {{ group.appCode }}
              </div>
              <div class="grid gap-2 md:grid-cols-2">
                <label
                  v-for="appRole in group.items"
                  :key="appRole.roleCode"
                  class="flex items-start gap-3 rounded-lg border border-default px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    class="mt-1 size-4 rounded border-default"
                    :checked="isAppRoleSelected(appRole.roleCode)"
                    @change="setAppRoleSelected(appRole.roleCode, ($event.target as HTMLInputElement).checked)"
                  >
                  <span class="min-w-0">
                    <span class="block font-medium text-highlighted">{{ appRole.roleName }}</span>
                    <span class="mono block truncate text-xs text-dimmed">{{ appRole.roleCode }}</span>
                    <span class="block text-xs text-muted">{{ appRole.permissionCount }} 项权限</span>
                  </span>
                </label>
              </div>
            </div>

            <UButton
              color="primary"
              icon="i-lucide-save"
              :loading="savingMaps"
              @click="saveAppRoleMaps"
            >
              保存默认权限组合
            </UButton>
          </div>
        </UCard>

        <UModal
          v-model:open="metaModalOpen"
          :title="formMode === 'create' ? '新建企业角色' : '编辑企业角色'"
          description="维护企业角色母版的基础信息。默认应用权限角色在页面右侧配置。"
          :ui="{ content: 'max-w-2xl' }"
        >
          <template #body>
            <div class="grid gap-4 md:grid-cols-2">
              <UFormField
                label="角色 Code"
                required
              >
                <UInput
                  v-model="form.roleCode"
                  class="w-full"
                  :readonly="formMode === 'edit'"
                  placeholder="system.admin"
                />
              </UFormField>
              <UFormField
                label="角色名称"
                required
              >
                <UInput
                  v-model="form.roleName"
                  class="w-full"
                  placeholder="系统管理员"
                />
              </UFormField>
              <UFormField label="角色类型">
                <USelect
                  v-model="form.roleType"
                  :items="editableRoleTypeItems"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="排序">
                <UInput
                  v-model.number="form.sortOrder"
                  type="number"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="状态">
                <USelect
                  v-model="form.status"
                  :items="editableStatusItems"
                  class="w-full"
                />
              </UFormField>
              <div class="flex items-end rounded-lg border border-default p-3">
                <UCheckbox
                  v-model="form.isRequired"
                  label="必选企业角色"
                />
              </div>
              <UFormField
                label="描述"
                class="md:col-span-2"
              >
                <UTextarea
                  v-model="form.description"
                  :rows="3"
                  class="w-full"
                  placeholder="说明角色定位，例如企业超管、经营管理、销售管理等。"
                />
              </UFormField>
            </div>
          </template>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                :disabled="savingMeta"
                @click="metaModalOpen = false"
              >
                取消
              </UButton>
              <UButton
                color="primary"
                icon="i-lucide-save"
                :loading="savingMeta"
                @click="saveMeta"
              >
                {{ formMode === 'create' ? '创建企业角色' : '保存基础信息' }}
              </UButton>
            </div>
          </template>
        </UModal>
      </div>
    </div>
  </div>
</template>

<style scoped>
.enterprise-role-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.25fr);
  gap: 1rem;
  align-items: start;
}

.enterprise-role-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.enterprise-role-search,
.enterprise-role-filter-select {
  min-width: 0;
}

.enterprise-role-search {
  grid-column: 1 / -1;
}

.enterprise-role-row {
  position: relative;
  display: block;
  width: 100%;
  padding: 0.875rem 1rem;
  text-align: left;
  transition: background-color 0.16s ease, box-shadow 0.16s ease;
}

.enterprise-role-row::before {
  position: absolute;
  inset: 0.75rem auto 0.75rem 0;
  width: 3px;
  border-radius: 0 999px 999px 0;
  background: transparent;
  content: "";
}

.enterprise-role-row:hover {
  background: var(--ui-bg-muted);
}

.enterprise-role-row:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: -2px;
}

.enterprise-role-row.is-selected {
  background: color-mix(in oklab, var(--ui-primary) 10%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ui-primary) 28%, transparent);
}

.enterprise-role-row.is-selected::before {
  background: var(--ui-primary);
}

@media (max-width: 1100px) {
  .enterprise-role-layout,
  .enterprise-role-filters {
    grid-template-columns: 1fr;
  }
}
</style>
