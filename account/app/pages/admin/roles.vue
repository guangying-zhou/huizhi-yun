<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'

usePageTitle('角色管理')

interface Role {
  id: number
  role_code: string
  role_name: string
  description: string | null
  parent_id: number | null
  is_system: number
  status: number
  created_at: string
  updated_at: string
  user_count?: number
  children?: Role[]
}

interface RoleUser {
  uid: string
  real_name?: string
  email: string
  status: number
}

interface ResourcePermission {
  resourceId: number
  resourceCode: string
  resourceName: string
  actions: ('view' | 'edit' | 'admin')[]
}

interface AppPermissions {
  appId: number
  appCode: string
  appName: string
  resources: ResourcePermission[]
}

interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
  success?: boolean
}

interface RolesListData {
  items: Role[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface PermissionsData {
  permissions: AppPermissions[]
  permissionStrings?: string[]
  role?: {
    id: number
    roleCode: string
    roleName: string
    parentId: number | null
  }
}

interface AvailablePermissionsData {
  parentRole: {
    id: number
    roleCode: string
    roleName: string
  }
  availablePermissions: AppPermissions[]
}

interface ResourceData {
  id: number
  appId: number
  appCode: string
  appName: string
  resourceCode: string
  resourceName: string
}

interface UsersData {
  items: RoleUser[]
}

const toast = useToast()
const loading = ref(false)
const roles = ref<Role[]>([])
const selectedRole = ref<Role | null>(null)

// 弹窗状态
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showUsersModal = ref(false)
const saving = ref(false)
const permLoading = ref(false)

// 编辑表单
const formData = ref({
  role_code: '',
  role_name: '',
  description: '',
  parent_id: null as number | null,
  status: 1
})

const currentRole = ref<Role | null>(null)

// 权限相关 - 新系统
const availablePermissions = ref<AppPermissions[]>([])
const selectedPermissions = ref<Map<number, Set<string>>>(new Map()) // resourceId -> Set<action>

// 角色下用户
const roleUsers = ref<RoleUser[]>([])
const usersLoading = ref(false)
const allUsers = ref<{ uid: string, realName: string, email?: string }[]>([])
const selectedUsersToAdd = ref<string[]>([])
const addingUser = ref(false)

function getUserDisplayName(user: { uid: string, realName?: string }) {
  return user.realName?.trim() || user.uid
}

const statusLabels: Record<number, { label: string, color: 'success' | 'neutral' }> = {
  1: { label: '启用', color: 'success' },
  0: { label: '禁用', color: 'neutral' }
}

// 构建角色树
const roleTree = computed(() => {
  const roleMap = new Map<number, Role>()
  const tree: Role[] = []

  // 复制角色并创建映射
  roles.value.forEach((role) => {
    roleMap.set(role.id, { ...role, children: [] })
  })

  // 构建树结构
  roleMap.forEach((role) => {
    if (role.parent_id === null) {
      tree.push(role)
    } else {
      const parent = roleMap.get(role.parent_id)
      if (parent) {
        if (!parent.children) parent.children = []
        parent.children.push(role)
      } else {
        tree.push(role) // 如果父节点不存在，作为顶级节点
      }
    }
  })

  return tree
})

// 父角色选项
const parentRoleOptions = computed(() => [
  { label: '无（顶级角色）', value: null as number | null },
  ...roles.value
    .filter(r => r.id !== currentRole.value?.id) // 排除自己
    .map(r => ({ label: r.role_name, value: r.id }))
])

// 加载角色列表
async function loadRoles() {
  loading.value = true
  try {
    const res = await $fetch<ApiResponse<RolesListData>>('/api/roles', {
      query: {
        page: 1,
        pageSize: 1000
      }
    })
    roles.value = res.data.items
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '加载失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

// 选中角色并加载权限和用户
async function selectRole(role: Role) {
  selectedRole.value = role
  // Parallel loading
  await Promise.all([
    loadRolePermissions(role),
    loadRoleUsers(role)
  ])
}

// 打开创建弹窗
function openCreateModal() {
  formData.value = {
    role_code: '',
    role_name: '',
    description: '',
    parent_id: null,
    status: 1
  }
  showCreateModal.value = true
}

// 打开创建子角色弹窗
function openCreateChildModal(parentRole: Role) {
  formData.value = {
    role_code: '',
    role_name: '',
    description: '',
    parent_id: parentRole.id,
    status: 1
  }
  showCreateModal.value = true
}

// 创建角色
async function createRole() {
  if (!formData.value.role_code || !formData.value.role_name) {
    toast.add({ title: '请填写角色编码和名称', color: 'warning' })
    return
  }

  saving.value = true
  try {
    await $fetch('/api/roles', {
      method: 'POST',
      body: formData.value
    })
    toast.add({ title: '创建成功', color: 'success' })
    showCreateModal.value = false
    loadRoles()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '创建失败', description: error.data?.message || error.message || '未知错误', color: 'error' })
  } finally {
    saving.value = false
  }
}

// 打开编辑弹窗
function openEditModal(role: Role) {
  currentRole.value = role
  formData.value = {
    role_code: role.role_code,
    role_name: role.role_name,
    description: role.description || '',
    parent_id: role.parent_id,
    status: role.status
  }
  showEditModal.value = true
}

// 更新角色
async function updateRole() {
  if (!currentRole.value) return

  saving.value = true
  try {
    await $fetch(`/api/roles/${currentRole.value.id}`, {
      method: 'PATCH',
      body: {
        role_name: formData.value.role_name,
        description: formData.value.description,
        status: formData.value.status
      }
    })
    toast.add({ title: '更新成功', color: 'success' })
    showEditModal.value = false
    loadRoles()
    if (selectedRole.value?.id === currentRole.value.id) {
      selectedRole.value = { ...selectedRole.value, ...formData.value }
    }
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '更新失败', description: error.data?.message || error.message || '未知错误', color: 'error' })
  } finally {
    saving.value = false
  }
}

// 删除角色
async function deleteRole(role: Role) {
  if (role.is_system === 1) {
    toast.add({ title: '系统角色不能删除', color: 'warning' })
    return
  }

  if (!confirm(`确定要删除角色「${role.role_name}」吗？`)) return

  try {
    await $fetch(`/api/roles/${role.id}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', color: 'success' })
    if (selectedRole.value?.id === role.id) {
      selectedRole.value = null
    }
    loadRoles()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '删除失败', description: error.data?.message || error.message || '未知错误', color: 'error' })
  }
}

// 加载角色权限
async function loadRolePermissions(role: Role) {
  permLoading.value = true
  selectedPermissions.value = new Map()

  try {
    // 加载可用权限范围
    if (role.parent_id) {
      const res = await $fetch<ApiResponse<AvailablePermissionsData>>(`/api/roles/${role.parent_id}/available-permissions`)
      availablePermissions.value = res.data.availablePermissions
    } else {
      const res = await $fetch<ApiResponse<ResourceData[]>>('/api/resources')
      const apps: Record<string, AppPermissions> = {}
      for (const r of res.data) {
        if (!apps[r.appCode]) {
          apps[r.appCode] = {
            appId: r.appId,
            appCode: r.appCode,
            appName: r.appName,
            resources: []
          }
        }
        apps[r.appCode]!.resources.push({
          resourceId: r.id,
          resourceCode: r.resourceCode,
          resourceName: r.resourceName,
          actions: ['view', 'edit', 'admin']
        })
      }
      availablePermissions.value = Object.values(apps)
    }

    // 加载角色当前权限
    const permRes = await $fetch<ApiResponse<PermissionsData>>(`/api/roles/${role.id}/permissions`)
    for (const app of permRes.data.permissions) {
      for (const res of app.resources) {
        const actions = new Set<string>(res.actions)
        selectedPermissions.value.set(res.resourceId, actions)
      }
    }

    const removedCount = sanitizeSelectedPermissions()
    if (removedCount > 0) {
      toast.add({
        title: '已清理越界权限',
        description: `检测到并移除了 ${removedCount} 项超出当前可分配范围的旧权限`,
        color: 'warning'
      })
    }
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '加载权限失败', description: error.message, color: 'error' })
  } finally {
    permLoading.value = false
  }
}

// 切换权限选中状态
function togglePermission(resourceId: number, action: string) {
  const actions = selectedPermissions.value.get(resourceId) || new Set()
  if (actions.has(action)) {
    actions.delete(action)
    if (actions.size === 0) {
      selectedPermissions.value.delete(resourceId)
    }
  } else {
    actions.add(action)
    selectedPermissions.value.set(resourceId, actions)
  }
  // Trigger reactivity
  selectedPermissions.value = new Map(selectedPermissions.value)
}

// 检查权限是否选中
function isPermissionSelected(resourceId: number, action: string): boolean {
  return selectedPermissions.value.get(resourceId)?.has(action) ?? false
}

function buildAssignablePermissionSet() {
  const assignablePermissions = new Set<string>()

  for (const app of availablePermissions.value) {
    for (const resource of app.resources) {
      for (const action of resource.actions) {
        assignablePermissions.add(`${resource.resourceId}:${action}`)
      }
    }
  }

  return assignablePermissions
}

function sanitizeSelectedPermissions() {
  const assignablePermissions = buildAssignablePermissionSet()
  const nextSelectedPermissions = new Map<number, Set<string>>()
  let removedCount = 0

  selectedPermissions.value.forEach((actions, resourceId) => {
    const validActions = Array.from(actions).filter((action) => {
      const isAssignable = assignablePermissions.has(`${resourceId}:${action}`)
      if (!isAssignable) {
        removedCount += 1
      }
      return isAssignable
    })

    if (validActions.length > 0) {
      nextSelectedPermissions.set(resourceId, new Set(validActions))
    }
  })

  selectedPermissions.value = nextSelectedPermissions

  return removedCount
}

// 选中应用下的所有权限
function selectAllAppPermissions(app: AppPermissions) {
  app.resources.forEach((res) => {
    const actions = selectedPermissions.value.get(res.resourceId) || new Set()
    res.actions.forEach(action => actions.add(action))
    selectedPermissions.value.set(res.resourceId, actions)
  })
  // 触发响应式更新
  selectedPermissions.value = new Map(selectedPermissions.value)
}

// 取消选中应用下的所有权限
function deselectAllAppPermissions(app: AppPermissions) {
  app.resources.forEach((res) => {
    selectedPermissions.value.delete(res.resourceId)
  })
  // 触发响应式更新
  selectedPermissions.value = new Map(selectedPermissions.value)
}

// 保存权限分配
async function savePermissions() {
  if (!selectedRole.value) return

  const removedCount = sanitizeSelectedPermissions()
  if (removedCount > 0) {
    toast.add({
      title: '已移除无效权限',
      description: `保存前自动移除了 ${removedCount} 项超出当前可分配范围的权限`,
      color: 'warning'
    })
  }

  const permissions: { resourceId: number, actions: string[] }[] = []

  // 保存所有选中的权限
  selectedPermissions.value.forEach((actions, resourceId) => {
    if (actions.size > 0) {
      permissions.push({
        resourceId,
        actions: Array.from(actions)
      })
    }
  })

  saving.value = true
  try {
    await $fetch(`/api/roles/${selectedRole.value.id}/permissions`, {
      method: 'PUT',
      body: { permissions }
    })
    toast.add({ title: '权限保存成功', color: 'success' })
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '保存失败', description: error.data?.message || error.message || '未知错误', color: 'error' })
  } finally {
    saving.value = false
  }
}

// 加载角色用户
async function loadRoleUsers(role: Role) {
  usersLoading.value = true
  selectedUsersToAdd.value = []

  try {
    // 加载角色用户
    const res = await $fetch<ApiResponse<UsersData>>(`/api/roles/${role.id}/users`, {
      query: {
        page: 1,
        pageSize: 1000
      }
    })
    roleUsers.value = res.data.items

    // 加载所有用户供选择
    const usersRes = await $fetch<{ data: { uid: string, realName: string }[] }>('/api/system-users', {
      query: { status: 1 }
    })
    allUsers.value = usersRes.data
  } catch {
    roleUsers.value = []
  } finally {
    usersLoading.value = false
  }
}

async function openUsersModal(role: Role) {
  currentRole.value = role
  showUsersModal.value = true
  await loadRoleUsers(role)
}

// 添加用户到角色
async function addUserToRole() {
  if (!currentRole.value || selectedUsersToAdd.value.length === 0) return

  addingUser.value = true
  try {
    await $fetch(`/api/roles/${currentRole.value.id}/users`, {
      method: 'POST',
      body: { uids: selectedUsersToAdd.value }
    })
    toast.add({ title: `成功添加 ${selectedUsersToAdd.value.length} 个用户`, color: 'success' })
    selectedUsersToAdd.value = []
    // 刷新用户列表
    await loadRoleUsers(currentRole.value)
    loadRoles() // 刷新角色列表更新用户数
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '添加失败', description: error.data?.message || error.message || '未知错误', color: 'error' })
  } finally {
    addingUser.value = false
  }
}

// 从角色移除用户
async function removeUserFromRole(uid: string) {
  if (!currentRole.value) return
  if (!confirm(`确定要从角色中移除用户「${uid}」吗？`)) return

  try {
    await $fetch(`/api/roles/${currentRole.value.id}/users`, {
      method: 'DELETE',
      query: { uid }
    })
    toast.add({ title: '移除成功', color: 'success' })
    // 刷新用户列表
    await loadRoleUsers(currentRole.value)
    loadRoles() // 刷新角色列表更新用户数
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({ title: '移除失败', description: error.data?.message || error.message || '未知错误', color: 'error' })
  }
}

const roleUserUidSet = computed(() => new Set(roleUsers.value.map(u => u.uid)))
const selectedUsersToAddSet = computed(() => new Set(selectedUsersToAdd.value))

// 可添加的用户列表（排除已在角色中的用户和当前已选中的用户）
const availableUsersToAdd = computed(() => {
  return allUsers.value
    .filter(u => !roleUserUidSet.value.has(u.uid) && !selectedUsersToAddSet.value.has(u.uid))
    .map(u => ({
      label: getUserDisplayName(u),
      uid: getUserDisplayName(u) !== u.uid ? u.uid : undefined,
      email: u.email,
      value: u.uid
    }))
})

watch(roleUsers, () => {
  if (selectedUsersToAdd.value.length === 0) return
  selectedUsersToAdd.value = selectedUsersToAdd.value.filter(uid => !roleUserUidSet.value.has(uid))
})

const actionLabels: Record<string, string> = {
  view: '查看',
  edit: '编辑',
  admin: '管理'
}

onMounted(() => {
  loadRoles()
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0 min-h-0">
    <UDashboardPanel grow :ui="{ root: 'min-h-0' }">
      <div class="flex justify-end gap-2 px-4 py-2 border-b border-default">
        <UButton
          color="neutral"
          size="sm"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="loadRoles"
        >
          刷新
        </UButton>
        <UButton
          color="primary"
          size="sm"
          icon="i-lucide-plus"
          @click="openCreateModal"
        >
          新建角色
        </UButton>
      </div>

      <div class="flex flex-1 min-h-0 overflow-hidden">
        <!-- 左侧：角色树 -->
        <div class="w-80 border-r border-gray-200 dark:border-gray-800 min-h-0 overflow-y-auto">
          <div class="p-4">
            <div v-if="loading" class="py-8 text-center text-gray-500">
              加载中...
            </div>
            <div v-else-if="roleTree.length === 0" class="py-8 text-center text-gray-500">
              暂无角色
            </div>
            <div v-else class="space-y-1">
              <RoleTreeItem
                v-for="role in roleTree"
                :key="role.id"
                :role="role"
                :selected-role="selectedRole"
                @select="selectRole"
                @edit="openEditModal"
                @delete="deleteRole"
                @create-child="openCreateChildModal"
              />
            </div>
          </div>
        </div>

        <!-- 右侧：权限管理 -->
        <div class="flex-1 min-h-0 overflow-y-auto">
          <div v-if="!selectedRole" class="flex items-center justify-center h-full text-gray-500">
            <div class="text-center">
              <UIcon name="i-lucide-shield" class="text-6xl mb-4 text-gray-300" />
              <div>请从左侧选择一个角色</div>
            </div>
          </div>
          <div v-else class="p-6">
            <!-- 角色信息卡片 -->
            <UCard class="mb-4">
              <div class="flex items-start justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-2">
                    <h2 class="text-xl font-bold">
                      {{ selectedRole.role_name }}
                    </h2>
                    <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">{{
                      selectedRole.role_code }}</code>
                    <UBadge
                      v-if="selectedRole.is_system === 1"
                      color="primary"
                      variant="subtle"
                      size="xs"
                    >
                      系统角色
                    </UBadge>
                    <UBadge
                      :color="statusLabels[selectedRole.status]?.color || 'neutral'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ statusLabels[selectedRole.status]?.label }}
                    </UBadge>
                  </div>
                  <div class="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <div v-if="selectedRole.description">
                      {{ selectedRole.description }}
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <UButton
                    color="secondary"
                    size="sm"
                    :loading="saving"
                    icon="i-lucide-user-plus"
                    @click="selectedRole && openUsersModal(selectedRole)"
                  >
                    授权用户
                  </UButton>
                  <UButton
                    color="primary"
                    size="sm"
                    :loading="saving"
                    icon="i-lucide-save"
                    @click="savePermissions"
                  >
                    保存权限
                  </UButton>
                </div>
              </div>
              <USeparator />
              <div class="pt-2">
                <div v-if="usersLoading" class="py-4 text-center text-gray-500">
                  加载中...
                </div>
                <div v-else-if="roleUsers.length === 0" class="py-4 text-center text-gray-500 text-sm">
                  暂无授权用户
                </div>
                <div v-else class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-1">
                  <div
                    v-for="user in roleUsers"
                    :key="user.uid"
                    class="flex items-center justify-between p-1 rounded border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <div class="truncate text-sm">
                        <div class="font-medium truncate">
                          {{ user.real_name || user.uid }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </UCard>

            <!-- 权限列表 -->
            <div v-if="permLoading" class="py-8 text-center text-gray-500">
              加载权限中...
            </div>
            <div v-else class="space-y-4">
              <UCard v-for="app in availablePermissions" :key="app.appCode">
                <template #header>
                  <div class="flex items-center justify-between w-full">
                    <div class="flex items-center gap-2">
                      <UIcon name="i-lucide-box" class="text-primary-500" />
                      <span class="font-medium">{{ app.appName }}</span>
                      <UBadge color="neutral" size="xs" variant="subtle">
                        {{ app.appCode }}
                      </UBadge>
                    </div>
                    <div class="flex items-center gap-2">
                      <UButton
                        size="xs"
                        color="primary"
                        variant="ghost"
                        @click="selectAllAppPermissions(app)"
                      >
                        全选
                      </UButton>
                      <UButton
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        @click="deselectAllAppPermissions(app)"
                      >
                        全不选
                      </UButton>
                    </div>
                  </div>
                </template>

                <div class="space-y-3">
                  <div
                    v-for="res in app.resources"
                    :key="res.resourceId"
                    class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800 last:border-0"
                  >
                    <div class="font-medium text-sm flex-1">
                      {{ res.resourceName }}
                      <span class="text-xs text-gray-500 font-mono">
                        {{ res.resourceCode }}
                      </span>
                    </div>
                    <div class="flex gap-4">
                      <label
                        v-for="action in res.actions"
                        :key="action"
                        class="flex items-center gap-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          :checked="isPermissionSelected(res.resourceId, action)"
                          class="rounded border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                          @change="togglePermission(res.resourceId, action)"
                        >
                        <span class="text-sm">
                          {{ actionLabels[action] || action }}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </UCard>

              <div v-if="availablePermissions.length === 0" class="text-center py-8 text-gray-500">
                <UIcon name="i-lucide-shield-off" class="text-4xl mb-2 text-gray-300" />
                <div>暂无可分配的权限</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </UDashboardPanel>

    <!-- 创建角色弹窗 -->
    <UModal v-model:open="showCreateModal" title="新建角色" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-4 p-2">
          <UFormField label="角色编码" required>
            <UInput v-model="formData.role_code" placeholder="如：editor, user:pm" />
            <template #hint>
              <span class="text-xs text-gray-500">子角色格式: 父角色:子角色 (如 user:pm)</span>
            </template>
          </UFormField>
          <UFormField label="角色名称" required>
            <UInput v-model="formData.role_name" placeholder="如：编辑员" />
          </UFormField>
          <UFormField label="父角色">
            <USelectMenu
              v-model="formData.parent_id"
              :items="parentRoleOptions"
              value-key="value"
              label-key="label"
              placeholder="选择父角色"
              class="w-full"
              :disabled="!!formData.parent_id && formData.role_code.includes(':')"
            />
            <template #hint>
              <span class="text-xs text-gray-500">子角色的权限不能超过父角色</span>
            </template>
          </UFormField>
          <UFormField label="描述">
            <UTextarea v-model="formData.description" placeholder="角色描述..." :rows="3" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3">
          <UButton color="neutral" variant="ghost" @click="showCreateModal = false">
            取消
          </UButton>
          <UButton color="primary" :loading="saving" @click="createRole">
            创建
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 编辑角色弹窗 -->
    <UModal v-model:open="showEditModal" title="编辑角色" :ui="{ content: 'sm:max-w-lg' }">
      <template #body>
        <div class="space-y-4 p-2">
          <UFormField label="角色编码">
            <UInput :model-value="formData.role_code" disabled />
          </UFormField>
          <UFormField label="角色名称" required>
            <UInput v-model="formData.role_name" />
          </UFormField>
          <UFormField label="描述">
            <UTextarea v-model="formData.description" :rows="3" />
          </UFormField>
          <UFormField label="状态">
            <USelectMenu
              v-model="formData.status"
              :items="[
                { value: 1, label: '启用' },
                { value: 0, label: '禁用' }
              ]"
              value-key="value"
              label-key="label"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3">
          <UButton color="neutral" variant="ghost" @click="showEditModal = false">
            取消
          </UButton>
          <UButton color="primary" :loading="saving" @click="updateRole">
            保存
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 角色用户弹窗 -->
    <UModal
      v-model:open="showUsersModal"
      :title="`角色用户 - ${currentRole?.role_name}`"
      :ui="{ content: 'sm:max-w-lg' }"
    >
      <template #body>
        <div class="flex gap-2 w-full pb-2 justify-center">
          <USelectMenu
            :key="`${currentRole?.id ?? 'none'}:${availableUsersToAdd.length}:${selectedUsersToAdd.join(',')}`"
            v-model="selectedUsersToAdd"
            :items="availableUsersToAdd"
            :filter-fields="['label', 'uid', 'email']"
            size="sm"
            placeholder="选择一个或多个用户..."
            class="flex-1"
            searchable
            multiple
            value-key="value"
            label-key="label"
          >
            <template #item-label="{ item }">
              {{ item.label }}
              <span v-if="item.uid" class="text-muted">({{ item.uid }})</span>
              <span v-if="item.email" class="text-muted"> - {{ item.email }}</span>
            </template>
          </USelectMenu>
          <UButton
            color="primary"
            size="sm"
            icon="i-lucide-plus"
            :loading="addingUser"
            :disabled="selectedUsersToAdd.length === 0"
            @click="addUserToRole"
          />
        </div>
        <div class="h-64 overflow-y-auto mt-4">
          <div v-if="usersLoading" class="py-4 text-center text-gray-500">
            加载中...
          </div>
          <div v-else-if="roleUsers.length === 0" class="py-4 text-center text-gray-500 text-sm">
            暂无授权用户
          </div>
          <div v-else class="flex flex-wrap gap-2">
            <div
              v-for="user in roleUsers"
              :key="user.uid"
              class="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800/60"
            >
              <span class="font-medium">{{ user.real_name || user.uid }}</span>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-x"
                square
                @click="removeUserFromRole(user.uid)"
              />
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton color="neutral" variant="ghost" @click="showUsersModal = false">
            关闭
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
