<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'

usePageTitle('用户管理')

interface LdapUser {
  id: number
  uid: string
  mobile: string | null
  email: string | null
  dept_code: string | null
  wecom_id: string | null
  dingtalk_id: string | null
  status: number
  user_type: number
  created_at: string
  updated_at: string
  real_name: string | null
  nickname: string | null
  avatar: string | null
  gender: number | null
  departments?: Array<{ id: number, name: string, org_type: string }>
}

interface Department {
  id: number
  name: string
  code: string
  parentId: number | null
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface ApiResponse<T> {
  code?: number
  success?: boolean
  message?: string
  data: T
  pagination?: Pagination
}

const toast = useToast()
const { hasPermission } = usePermissions()
const users = ref<LdapUser[]>([])
const departments = ref<Department[]>([])
const loading = ref(false)
const syncing = ref(false)
const search = ref('')
const statusFilter = ref('1')
const statusFilterOptions = [
  { label: '全部', value: 'all' },
  { label: '正常', value: '1' },
  { label: '禁用', value: '0' },
  { label: '已删除', value: '-1' }
]
const pagination = ref<Pagination>({
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 0
})

// 编辑状态
const editingId = ref<number | null>(null)
const editingField = ref<'real_name' | 'nickname' | 'dept_code' | null>(null)
const editingValue = ref<string | number | null>('')
const editInputRef = ref<HTMLInputElement | null>(null)
const saving = ref(false)

// 编辑弹窗状态
const showEditModal = ref(false)
const editingUser = ref<LdapUser | null>(null)
const editFormData = ref({
  real_name: '',
  nickname: '',
  email: '',
  dept_code: null as string | null,
  status: 1,
  user_type: 1
})

const statusLabels: Record<number, { label: string, color: 'error' | 'neutral' | 'success' | 'warning' }> = {
  [-1]: { label: '已删除', color: 'error' },
  0: { label: '禁用', color: 'neutral' },
  1: { label: '正常', color: 'success' },
  2: { label: '待验证', color: 'warning' }
}

const statusOptions = [
  { label: '正常', value: 1 },
  { label: '禁用', value: 0 }
]

const userTypeOptions = [
  { label: '系统用户', value: 0 },
  { label: '普通用户', value: 1 },
  { label: '外部用户', value: 2 }
]

const departmentOptions = computed(() => [
  { label: '未分配部门', value: null as number | null },
  ...departments.value.map(d => ({
    label: d.name,
    value: d.id
  }))
])

async function loadDepartments() {
  try {
    const result = await $fetch<ApiResponse<Department[]>>('/api/departments')
    departments.value = result.data || []
  } catch (error) {
    console.error('Failed to load departments:', error)
  }
}

async function loadUsers(page = 1) {
  loading.value = true
  try {
    const result = await $fetch<ApiResponse<LdapUser[]>>('/api/ldap-users', {
      query: {
        page,
        page_size: pagination.value.pageSize,
        search: search.value || undefined,
        status: statusFilter.value
      }
    })
    users.value = result.data
    if (result.pagination) {
      pagination.value = result.pagination
    }
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({
      title: '加载失败',
      description: error.message || '无法加载 user 列表',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function syncFromLdap() {
  syncing.value = true
  try {
    const result = await $fetch<ApiResponse<unknown>>('/api/ldap-users/sync', {
      method: 'POST'
    })

    toast.add({
      title: '同步成功',
      description: result.message,
      color: 'success'
    })

    await loadUsers(1)
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({
      title: '同步失败',
      description: error.message || 'LDAP 同步失败',
      color: 'error'
    })
  } finally {
    syncing.value = false
  }
}

const syncingWecom = ref(false)

async function syncWecomIds() {
  syncingWecom.value = true
  try {
    const result = await $fetch<ApiResponse<{ linked: number, alreadyLinked: number, notFound: number, wecomTotal: number }>>('/api/wecom/users-bindall', {
      method: 'POST'
    })

    const data = result.data
    toast.add({
      title: '企业微信同步完成',
      description: `共 ${data.wecomTotal} 人，新关联 ${data.linked} 人，已关联 ${data.alreadyLinked} 人，未匹配 ${data.notFound} 人`,
      color: data.linked > 0 ? 'success' : 'info'
    })

    await loadUsers(pagination.value.page)
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '同步失败',
      description: error.data?.message || error.message || '企业微信同步失败',
      color: 'error'
    })
  } finally {
    syncingWecom.value = false
  }
}

// 开始编辑
function startEditing(user: LdapUser, field: 'real_name' | 'nickname' | 'dept_code') {
  editingId.value = user.id
  editingField.value = field
  if (field === 'real_name') editingValue.value = user.real_name
  else if (field === 'nickname') editingValue.value = user.nickname
  else editingValue.value = user.dept_code

  nextTick(() => {
    if (field !== 'dept_code') {
      editInputRef.value?.focus()
      editInputRef.value?.select()
    }
  })
}

// 取消编辑
function cancelEditing() {
  editingId.value = null
  editingField.value = null
  editingValue.value = ''
}

// 保存编辑
async function saveEditing(user: LdapUser) {
  if (saving.value || !editingField.value) return

  const field = editingField.value
  const oldValue = user[field as keyof LdapUser]

  if (editingValue.value === oldValue) {
    cancelEditing()
    return
  }

  saving.value = true
  try {
    await $fetch(`/api/ldap-users/${user.id}`, {
      method: 'PATCH',
      body: {
        [field]: editingValue.value || null
      }
    })

    // 更新本地数据
    users.value = users.value.map((u) => {
      if (u.id === user.id) {
        return { ...u, [field]: editingValue.value || null }
      }
      return u
    })

    toast.add({
      title: '保存成功',
      color: 'success'
    })

    cancelEditing()
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({
      title: '保存失败',
      description: error.message || '无法保存',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

// 打开编辑弹窗
function openEditModal(user: LdapUser) {
  editingUser.value = user
  editFormData.value = {
    real_name: user.real_name || '',
    nickname: user.nickname || '',
    email: user.email || '',
    dept_code: user.dept_code,
    status: user.status,
    user_type: user.user_type ?? 1
  }
  showEditModal.value = true
}

const deletingUserId = ref<number | null>(null)

async function deleteUser(user: LdapUser) {
  if (!window.confirm(`确定要删除用户 "${user.real_name || user.uid}" 吗？此操作将移除其部门关联。`)) {
    return
  }

  deletingUserId.value = user.id
  try {
    await $fetch(`/api/ldap-users/${user.id}`, { method: 'DELETE' })
    toast.add({ title: '删除成功', color: 'success' })
    await loadUsers(pagination.value.page)
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '删除失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    deletingUserId.value = null
  }
}

// 保存编辑弹窗
async function saveEditModal() {
  if (!editingUser.value) return

  saving.value = true
  try {
    await $fetch(`/api/ldap-users/${editingUser.value.id}`, {
      method: 'PATCH',
      body: editFormData.value
    })

    // 更新本地数据
    Object.assign(editingUser.value, editFormData.value)

    toast.add({
      title: '保存成功',
      color: 'success'
    })

    showEditModal.value = false
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({
      title: '保存失败',
      description: error.message || '无法保存',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

// 处理键盘事件
function handleKeydown(event: KeyboardEvent, user: LdapUser) {
  if (event.key === 'Enter') {
    saveEditing(user)
  } else if (event.key === 'Escape') {
    cancelEditing()
  }
}

function handleSearch() {
  loadUsers(1)
}

onMounted(() => {
  loadUsers()
  loadDepartments()
})

const columns = [
  { accessorKey: 'uid', header: '用户名' },
  { accessorKey: 'real_name', header: '姓名' },
  { accessorKey: 'email', header: '邮箱' },
  { accessorKey: 'mobile', header: '手机号' },
  { accessorKey: 'dept_code', header: '部门' },
  { accessorKey: 'wecom_id', header: '微信ID' },
  { accessorKey: 'dingtalk_id', header: '钉钉ID' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'actions', header: '操作' }
]

const paginationInfo = computed(() => {
  const { page, pageSize, total, totalPages } = pagination.value
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  return { start, end, total, totalPages }
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel grow>
      <UDashboardToolbar>
        <template #left>
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">状态:</span>
            <URadioGroup
              v-model="statusFilter"
              :items="statusFilterOptions"
              orientation="horizontal"
              size="sm"
              @update:model-value="handleSearch"
            />
          </div>
        </template>
        <template #right>
          <div class="flex items-center gap-2">
            <UInput
              v-model="search"
              icon="i-lucide-search"
              placeholder="搜索用户名、邮箱、姓名..."
              size="sm"
              class="w-64"
              @keydown.enter="handleSearch"
            >
              <template v-if="search.length" #trailing>
                <UButton
                  color="neutral"
                  variant="link"
                  size="sm"
                  icon="i-lucide-circle-x"
                  aria-label="Clear input"
                  @click="search = ''; handleSearch()"
                />
              </template>
            </UInput>
            <UButton
              color="primary"
              size="sm"
              icon="i-lucide-refresh-cw"
              :loading="syncing"
              @click="syncFromLdap"
            >
              同步 LDAP
            </UButton>
            <UButton
              color="success"
              size="sm"
              icon="i-lucide-message-circle"
              :loading="syncingWecom"
              @click="syncWecomIds"
            >
              同步企业微信
            </UButton>
            <UButton
              color="neutral"
              size="sm"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="loading"
              @click="() => loadUsers(pagination.page)"
            >
              刷新
            </UButton>
          </div>
        </template>
      </UDashboardToolbar>

      <div class="p-4 flex gap-4">
        <!-- 左侧：用户表格 -->
        <div class="border border-muted rounded-xl py-2">
          <UTable
            :data="users"
            :columns="columns"
            :loading="loading"
            empty-state-title="暂无用户"
            sticky
            class="w-full h-[calc(100vh-180px)] px-1"
          >
            <template #uid-cell="{ row }">
              <span class="font-medium font-mono">{{ row.original.uid }}</span>
            </template>

            <template #email-cell="{ row }">
              <span class="text-blue-600 dark:text-blue-400">{{ row.original.email || '-' }}</span>
            </template>

            <template #mobile-cell="{ row }">
              <span>{{ row.original.mobile || '-' }}</span>
            </template>

            <!-- 姓名列 - 可编辑 -->
            <template #real_name-cell="{ row }">
              <div
                v-if="editingId === row.original.id && editingField === 'real_name'"
                class="flex items-center gap-1"
                @click.stop
              >
                <input
                  ref="editInputRef"
                  v-model="editingValue"
                  class="w-24 px-2 py-1 text-sm border border-primary-500 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-800"
                  :disabled="saving"
                  @keydown="handleKeydown($event, row.original)"
                  @blur="saveEditing(row.original)"
                >
                <UButton
                  size="xs"
                  color="primary"
                  variant="ghost"
                  icon="i-lucide-check"
                  :loading="saving"
                  @click.stop="saveEditing(row.original)"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :disabled="saving"
                  @click.stop="cancelEditing"
                />
              </div>
              <button
                v-else
                class="flex items-center gap-1 px-2 py-1 -ml-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer group"
                @click="startEditing(row.original, 'real_name')"
              >
                <span>{{ row.original.real_name || '-' }}</span>
                <UIcon
                  name="i-lucide-edit"
                  class="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity"
                />
              </button>
            </template>

            <!-- 部门列 -->
            <template #dept_code-cell="{ row }">
              <div
                v-if="editingId === row.original.id && editingField === 'dept_code'"
                class="w-40"
                @click.stop
              >
                <USelectMenu
                  v-model="editingValue as any"
                  :items="departmentOptions"
                  value-key="value"
                  label-key="label"
                  searchable
                  size="xs"
                  :disabled="saving"
                  @update:model-value="() => saveEditing(row.original)"
                />
              </div>
              <button
                v-else
                class="flex items-center gap-1 px-2 py-1 -ml-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer group"
                @click="startEditing(row.original, 'dept_code')"
              >
                <div
                  v-if="row.original.departments && row.original.departments.length > 0"
                  class="flex flex-wrap gap-1 items-center"
                >
                  <UBadge
                    v-for="d in row.original.departments"
                    :key="d.id"
                    :color="d.org_type === 'committee' ? 'success' : 'primary'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ d.name }}
                  </UBadge>
                </div>
                <span v-else class="text-sm text-gray-400">未分配</span>
                <UIcon
                  name="i-lucide-edit"
                  class="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity ml-1"
                />
              </button>
            </template>

            <template #wecom_id-cell="{ row }">
              <span class="text-xs font-mono text-dimmed">{{ row.original.wecom_id || '-' }}</span>
            </template>

            <template #dingtalk_id-cell="{ row }">
              <span class="text-xs font-mono text-dimmed">{{ row.original.dingtalk_id || '-' }}</span>
            </template>

            <template #status-cell="{ row }">
              <UBadge :color="statusLabels[row.original.status]?.color || 'neutral'" variant="subtle" size="xs">
                {{ statusLabels[row.original.status]?.label || '未知' }}
              </UBadge>
            </template>

            <!-- 操作列 -->
            <template #actions-cell="{ row }">
              <div class="flex items-center gap-1">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-edit"
                  @click="openEditModal(row.original)"
                />
                <UButton
                  v-if="hasPermission('admin', 'admin')"
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  :loading="deletingUserId === row.original.id"
                  @click="deleteUser(row.original)"
                />
              </div>
            </template>
          </UTable>

          <div
            v-if="!loading && users.length > 0"
            class="flex items-center justify-between px-4 pt-2 pb-0 border-t border-gray-100 dark:border-gray-800"
          >
            <div class="text-sm text-gray-500">
              显示 {{ paginationInfo.start }}-{{ paginationInfo.end }} / 共 {{ paginationInfo.total }} 个用户
            </div>
            <div class="flex items-center gap-2">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-chevron-left"
                :disabled="pagination.page <= 1"
                @click="loadUsers(pagination.page - 1)"
              >
                上一页
              </UButton>
              <span class="text-sm">
                {{ pagination.page }} / {{ pagination.totalPages }}
              </span>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-chevron-right"
                :disabled="pagination.page >= pagination.totalPages"
                @click="loadUsers(pagination.page + 1)"
              >
                下一页
              </UButton>
            </div>
          </div>
        </div>

        <!-- 右侧：操作说明 -->
        <div class="w-56 shrink-0">
          <div class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg sticky top-4">
            <div class="flex items-center gap-2 mb-3">
              <UIcon name="i-lucide-info" class="text-blue-500" />
              <span class="font-medium text-blue-700 dark:text-blue-300">操作说明</span>
            </div>
            <ul class="text-sm space-y-2 text-blue-600 dark:text-blue-400">
              <li class="flex items-start gap-2">
                <UIcon name="i-lucide-edit" class="w-4 h-4 mt-0.5 shrink-0" />
                <span>点击「姓名」可直接编辑</span>
              </li>
              <li class="flex items-start gap-2">
                <UIcon name="i-lucide-refresh-cw" class="w-4 h-4 mt-0.5 shrink-0" />
                <span>同步 LDAP 不覆盖已有姓名，LDAP 中不存在的本地用户会被标记为已删除</span>
              </li>
              <li class="flex items-start gap-2">
                <UIcon name="i-lucide-message-circle" class="w-4 h-4 mt-0.5 shrink-0" />
                <span>同步企业微信仅同步企业微信ID，不覆盖其他信息，无法获取ID的请确认企业微信的企业邮箱设置是否正确</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </UDashboardPanel>

    <!-- 编辑用户弹窗 -->
    <UModal v-model:open="showEditModal" title="编辑用户" :ui="{ content: 'sm:max-w-xl' }">
      <template #body>
        <div class="space-y-4 p-2">
          <div class="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <UAvatar
              :src="editingUser?.avatar || undefined"
              :alt="editingUser?.uid?.charAt(0).toUpperCase()"
              size="lg"
            />
            <div>
              <div class="font-bold text-lg">
                {{ editingUser?.uid }}
              </div>
              <div class="text-sm text-gray-500">
                {{ editingUser?.email || '无邮箱' }}
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <UFormField label="姓名">
              <UInput v-model="editFormData.real_name" placeholder="请输入姓名" class="w-full" />
            </UFormField>

            <UFormField label="昵称">
              <UInput v-model="editFormData.nickname" placeholder="请输入昵称" class="w-full" />
            </UFormField>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <UFormField label="状态">
              <USelectMenu
                v-model="editFormData.status"
                :items="statusOptions"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>

            <UFormField label="用户类型">
              <USelectMenu
                v-model="editFormData.user_type"
                :items="userTypeOptions"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 px-4 py-3">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="showEditModal = false"
          />
          <UButton
            label="保存"
            color="primary"
            :loading="saving"
            @click="saveEditModal"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
