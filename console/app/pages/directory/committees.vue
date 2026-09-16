<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('委员会')

type CommitteeStatus = 'active' | 'inactive' | 'deleted'
type CommitteeMemberRole = 'leader' | 'manager' | 'member' | 'observer'

interface DirectoryCommittee {
  id: number
  committeeCode: string
  name: string
  parentDeptCode: string | null
  parentDeptName: string | null
  managerUid: string | null
  managerName: string | null
  leaderUid: string | null
  leaderName: string | null
  description: string | null
  sortOrder: number
  status: CommitteeStatus
  memberCount: number
  createdAt: string
  updatedAt: string
}

interface DirectoryCommitteeMember {
  id: number
  uid: string
  role: CommitteeMemberRole
  sourceProvider: string
  joinedAt: string | null
  status: string
  displayName: string
  realName: string | null
  avatar: string | null
  email: string | null
  positionTitle: string | null
  userStatus: string
  primaryDeptCode: string | null
  deptName: string | null
}

interface SelectedUser {
  uid: string
  realName: string
  deptCode?: string | null
  deptName?: string | null
  avatar?: string | null
}

interface ApiResponse<T> {
  code: number
  data: T
}

interface CommitteeListResponse {
  items: DirectoryCommittee[]
  total: number
  page: number
  pageSize: number
}

interface CommitteeMemberListResponse {
  items: DirectoryCommitteeMember[]
  total: number
  page: number
  pageSize: number
}

const toast = useToast()
const { confirm } = useConfirm()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
if (!permissionsLoaded.value) {
  await loadPermissions()
}
const canEdit = computed(() => permissionsLoaded.value && hasPermission('directory_departments', 'edit'))

const { search, debounced: debouncedSearch, flush: flushSearch, reset: resetSearch } = useDebouncedSearch()
const status = ref('active')
const { page, pageSize, resetFilters: resetListFilters } = useListPage({
  pageSize: 20,
  filters: { search, status },
  defaults: { search: '', status: 'active' }
})

const query = computed(() => ({
  page: page.value,
  pageSize,
  search: debouncedSearch.value || undefined,
  status: status.value
}))

const { data, pending, error, refresh } = await useFetch<ApiResponse<CommitteeListResponse>>(
  '/api/v1/console/directory/committees',
  {
    query,
    default: () => ({
      code: 0,
      data: { items: [], total: 0, page: 1, pageSize }
    })
  }
)
const errorAlert = useApiErrorAlert(error, {
  appName: 'Console',
  fallbackTitle: '委员会加载失败'
})

const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => {
  setRefresh(refresh)
})
onBeforeUnmount(clearRefresh)

const { data: departmentData } = await useFetch<ApiResponse<{
  flat: Array<{ deptCode: string, name: string, level: number, orgType: string }>
}>>('/api/v1/console/directory/departments', {
  default: () => ({ code: 0, data: { flat: [] } })
})

const committees = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)
const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')

const statusOptions = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'inactive' },
  { label: '全部', value: 'all' }
]
const formStatusOptions = statusOptions.filter(item => item.value !== 'all')
const roleOptions: Array<{ label: string, value: CommitteeMemberRole }> = [
  { label: '主任', value: 'leader' },
  { label: '秘书', value: 'manager' },
  { label: '委员', value: 'member' },
  { label: '观察员', value: 'observer' }
]
const roleFilterOptions = [
  { label: '全部角色', value: 'all' },
  ...roleOptions
]
const noParentDepartmentValue = '__none__'
const parentDepartmentOptions = computed(() => [
  { label: '不归属具体部门', value: noParentDepartmentValue },
  ...(departmentData.value?.data.flat || [])
    .filter(department => department.orgType === 'department')
    .map(department => ({
      label: `${'  '.repeat(Math.max(0, department.level - 1))}${department.name}`,
      value: department.deptCode
    }))
])

function resetFilters() {
  resetSearch()
  resetListFilters()
}

function statusMeta(value: CommitteeStatus) {
  if (value === 'active') return { label: '启用', color: 'success' as const }
  if (value === 'deleted') return { label: '已删除', color: 'error' as const }
  return { label: '停用', color: 'neutral' as const }
}

function roleLabel(value: CommitteeMemberRole) {
  return roleOptions.find(option => option.value === value)?.label || value
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

const committeeColumns: TableColumn<DirectoryCommittee>[] = [
  {
    accessorKey: 'name',
    header: '委员会',
    cell: ({ row }) => h('div', { class: 'min-w-44' }, [
      h('p', { class: 'font-medium text-highlighted' }, row.original.name),
      h('p', { class: 'text-xs text-muted' }, row.original.committeeCode)
    ])
  },
  {
    accessorKey: 'parentDeptName',
    header: '归属部门',
    cell: ({ row }) => row.original.parentDeptName || row.original.parentDeptCode || '-'
  },
  {
    accessorKey: 'leaderName',
    header: '主任',
    cell: ({ row }) => row.original.leaderName || row.original.leaderUid || '-'
  },
  {
    accessorKey: 'managerName',
    header: '秘书',
    cell: ({ row }) => row.original.managerName || row.original.managerUid || '-'
  },
  {
    accessorKey: 'memberCount',
    header: '成员',
    cell: ({ row }) => h(UButton, {
      color: 'neutral',
      variant: 'soft',
      size: 'xs',
      icon: 'i-lucide-users',
      onClick: () => openMembers(row.original)
    }, () => `${row.original.memberCount} 人`)
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => {
      const meta = statusMeta(row.original.status)
      return h(UBadge, { color: meta.color, variant: 'soft' }, () => meta.label)
    }
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => h('div', { class: 'flex justify-end gap-1' }, [
      h(UButton, {
        ...{ 'aria-label': `管理${row.original.name}成员` },
        color: 'neutral',
        variant: 'ghost',
        size: 'xs',
        icon: 'i-lucide-users',
        onClick: () => openMembers(row.original)
      }, () => canEdit.value ? '成员' : '查看'),
      canEdit.value
        ? h(UButton, {
            ...{ 'aria-label': `编辑${row.original.name}` },
            color: 'neutral',
            variant: 'ghost',
            size: 'xs',
            icon: 'i-lucide-pencil',
            onClick: () => openEditCommittee(row.original)
          }, () => '编辑')
        : null,
      canEdit.value
        ? h(UButton, {
            ...{ 'aria-label': `删除${row.original.name}` },
            color: 'error',
            variant: 'ghost',
            size: 'xs',
            icon: 'i-lucide-trash-2',
            onClick: () => deleteCommittee(row.original)
          }, () => '删除')
        : null
    ])
  }
]

const committeeModalOpen = ref(false)
const committeeModalMode = ref<'create' | 'edit'>('create')
const savingCommittee = ref(false)
const formError = ref('')
const form = reactive({
  committeeCode: '',
  name: '',
  parentDeptCode: noParentDepartmentValue,
  description: '',
  sortOrder: 100,
  status: 'active'
})

function resetCommitteeForm() {
  form.committeeCode = ''
  form.name = ''
  form.parentDeptCode = noParentDepartmentValue
  form.description = ''
  form.sortOrder = 100
  form.status = 'active'
  formError.value = ''
}

function openCreateCommittee() {
  resetCommitteeForm()
  committeeModalMode.value = 'create'
  committeeModalOpen.value = true
}

function openEditCommittee(committee: DirectoryCommittee) {
  resetCommitteeForm()
  committeeModalMode.value = 'edit'
  form.committeeCode = committee.committeeCode
  form.name = committee.name
  form.parentDeptCode = committee.parentDeptCode || noParentDepartmentValue
  form.description = committee.description || ''
  form.sortOrder = committee.sortOrder
  form.status = committee.status === 'deleted' ? 'inactive' : committee.status
  committeeModalOpen.value = true
}

function committeePayload() {
  return {
    committeeCode: form.committeeCode.trim(),
    name: form.name.trim(),
    parentDeptCode: form.parentDeptCode === noParentDepartmentValue ? null : form.parentDeptCode,
    description: form.description.trim() || null,
    sortOrder: form.sortOrder,
    status: form.status
  }
}

async function submitCommittee() {
  if (!form.committeeCode.trim() || !form.name.trim()) {
    formError.value = '委员会编码和名称不能为空'
    return
  }

  savingCommittee.value = true
  formError.value = ''
  try {
    const payload = committeePayload()
    if (committeeModalMode.value === 'create') {
      await $fetch('/api/v1/console/directory/committees', {
        method: 'POST',
        headers: { 'idempotency-key': `directory:committee:create:${globalThis.crypto?.randomUUID?.() || Date.now()}` },
        body: payload
      })
    } else {
      await $fetch(`/api/v1/console/directory/committees/${encodeURIComponent(form.committeeCode)}`, {
        method: 'PATCH',
        headers: { 'idempotency-key': `directory:committee:update:${form.committeeCode}:${globalThis.crypto?.randomUUID?.() || Date.now()}` },
        body: payload
      })
    }
    committeeModalOpen.value = false
    toast.add({
      title: committeeModalMode.value === 'create' ? '已创建委员会' : '已更新委员会',
      color: 'success'
    })
    await refresh()
  } catch (error) {
    formError.value = error instanceof Error ? error.message : '保存委员会失败'
  } finally {
    savingCommittee.value = false
  }
}

async function deleteCommittee(committee: DirectoryCommittee) {
  if (!(await confirm({
    title: '删除委员会',
    message: `确认删除委员会「${committee.name}」？请先移除全部成员；删除后不可恢复。`,
    tone: 'danger'
  }))) return

  try {
    await $fetch(`/api/v1/console/directory/committees/${encodeURIComponent(committee.committeeCode)}`, {
      method: 'DELETE',
      headers: { 'idempotency-key': `directory:committee:delete:${committee.committeeCode}:${globalThis.crypto?.randomUUID?.() || Date.now()}` }
    })
    toast.add({ title: '已删除委员会', color: 'success' })
    await refresh()
  } catch (error) {
    toast.add({
      title: '删除委员会失败',
      description: error instanceof Error ? error.message : '请稍后重试',
      color: 'error'
    })
  }
}

const selectedCommittee = ref<DirectoryCommittee | null>(null)
const membersOpen = ref(false)
const members = ref<DirectoryCommitteeMember[]>([])
const memberTotal = ref(0)
const memberPage = ref(1)
const memberPageSize = 10
const membersPending = ref(false)
const membersError = ref('')
const memberRoleFilter = ref('all')
const memberUpdatingUid = ref('')
const addingMembers = ref(false)
const newMemberUids = ref<string[]>([])
const newMemberUsers = ref<SelectedUser[]>([])
const newMemberRole = ref<CommitteeMemberRole>('member')
const {
  search: memberSearch,
  debounced: debouncedMemberSearch,
  flush: flushMemberSearch,
  reset: resetMemberSearch
} = useDebouncedSearch()

const memberColumns: TableColumn<DirectoryCommitteeMember>[] = [
  { accessorKey: 'uid', header: '成员' },
  { accessorKey: 'role', header: '角色' },
  { accessorKey: 'deptName', header: '主部门' },
  { accessorKey: 'joinedAt', header: '加入时间' },
  { id: 'actions', header: '' }
]

async function loadMembers() {
  if (!selectedCommittee.value) return
  membersPending.value = true
  membersError.value = ''
  try {
    const response = await $fetch<ApiResponse<CommitteeMemberListResponse>>(
      `/api/v1/console/directory/committees/${encodeURIComponent(selectedCommittee.value.committeeCode)}/members`,
      {
        query: {
          page: memberPage.value,
          pageSize: memberPageSize,
          search: debouncedMemberSearch.value || undefined,
          role: memberRoleFilter.value === 'all' ? undefined : memberRoleFilter.value
        }
      }
    )
    members.value = response.data.items
    memberTotal.value = response.data.total
  } catch (error) {
    membersError.value = error instanceof Error ? error.message : '加载委员会成员失败'
  } finally {
    membersPending.value = false
  }
}

function openMembers(committee: DirectoryCommittee) {
  selectedCommittee.value = committee
  membersOpen.value = true
  memberPage.value = 1
  memberRoleFilter.value = 'all'
  resetMemberSearch()
  newMemberUids.value = []
  newMemberUsers.value = []
  newMemberRole.value = 'member'
  void loadMembers()
}

watch([debouncedMemberSearch, memberRoleFilter], () => {
  if (!membersOpen.value) return
  if (memberPage.value !== 1) {
    memberPage.value = 1
    return
  }
  void loadMembers()
})

watch(memberPage, () => {
  if (membersOpen.value) void loadMembers()
})

async function addMembers() {
  if (!selectedCommittee.value || !newMemberUids.value.length) {
    toast.add({ title: '请先选择成员', color: 'warning' })
    return
  }
  if (['leader', 'manager'].includes(newMemberRole.value) && newMemberUids.value.length > 1) {
    toast.add({ title: '主任或秘书每次只能选择一人', color: 'warning' })
    return
  }

  addingMembers.value = true
  membersError.value = ''
  try {
    await $fetch(
      `/api/v1/console/directory/committees/${encodeURIComponent(selectedCommittee.value.committeeCode)}/members`,
      {
        method: 'POST',
        headers: {
          'idempotency-key': `directory:committee:members:add:${selectedCommittee.value.committeeCode}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
        },
        body: {
          members: newMemberUids.value.map(uid => ({
            uid,
            role: newMemberRole.value
          }))
        }
      }
    )
    toast.add({ title: '已添加委员会成员', color: 'success' })
    newMemberUids.value = []
    newMemberUsers.value = []
    memberPage.value = 1
    await Promise.all([loadMembers(), refresh()])
  } catch (error) {
    membersError.value = error instanceof Error ? error.message : '添加委员会成员失败'
  } finally {
    addingMembers.value = false
  }
}

async function updateMemberRole(member: DirectoryCommitteeMember, role: CommitteeMemberRole) {
  if (!selectedCommittee.value || role === member.role) return
  memberUpdatingUid.value = member.uid
  membersError.value = ''
  try {
    await $fetch(
      `/api/v1/console/directory/committees/${encodeURIComponent(selectedCommittee.value.committeeCode)}/members/${encodeURIComponent(member.uid)}`,
      {
        method: 'PATCH',
        headers: {
          'idempotency-key': `directory:committee:member:update:${selectedCommittee.value.committeeCode}:${member.uid}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
        },
        body: { role }
      }
    )
    toast.add({ title: `已将${member.displayName}设为${roleLabel(role)}`, color: 'success' })
    await Promise.all([loadMembers(), refresh()])
  } catch (error) {
    membersError.value = error instanceof Error ? error.message : '更新成员角色失败'
  } finally {
    memberUpdatingUid.value = ''
  }
}

async function removeMember(member: DirectoryCommitteeMember) {
  if (!selectedCommittee.value) return
  if (!(await confirm({
    title: '移除委员会成员',
    message: `确认将「${member.displayName}」从委员会「${selectedCommittee.value.name}」移除？`,
    tone: 'warning'
  }))) return

  memberUpdatingUid.value = member.uid
  membersError.value = ''
  try {
    await $fetch(
      `/api/v1/console/directory/committees/${encodeURIComponent(selectedCommittee.value.committeeCode)}/members/${encodeURIComponent(member.uid)}`,
      {
        method: 'DELETE',
        headers: {
          'idempotency-key': `directory:committee:member:remove:${selectedCommittee.value.committeeCode}:${member.uid}:${globalThis.crypto?.randomUUID?.() || Date.now()}`
        }
      }
    )
    toast.add({ title: '已移除委员会成员', color: 'success' })
    if (members.value.length === 1 && memberPage.value > 1) {
      memberPage.value -= 1
    } else {
      await loadMembers()
    }
    await refresh()
  } catch (error) {
    membersError.value = error instanceof Error ? error.message : '移除委员会成员失败'
  } finally {
    memberUpdatingUid.value = ''
  }
}
</script>

<template>
  <UDashboardPanel id="directory-committees" :ui="dashboardPanelUi">
    <template #body>
      <UCard>
        <template #header>
          <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div class="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:max-w-2xl">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                placeholder="搜索委员会编码 / 名称"
                @keyup.enter="flushSearch"
              />
              <USelect
                v-model="status"
                :items="statusOptions"
              />
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-rotate-ccw"
                @click="resetFilters"
              >
                重置
              </UButton>
              <UButton
                v-if="canEdit"
                color="primary"
                icon="i-lucide-plus"
                @click="openCreateCommittee"
              >
                新建委员会
              </UButton>
            </div>
          </div>
        </template>

        <UAlert
          v-if="errorAlert"
          :color="errorAlert.color"
          variant="soft"
          :icon="errorAlert.icon"
          :title="errorAlert.title"
          :description="errorAlert.description"
          class="mb-3"
        />

        <div class="overflow-x-auto">
          <UTable
            sticky
            :data="committees"
            :columns="committeeColumns"
            :loading="pending"
            class="min-w-[920px] rounded-lg border border-default"
          >
            <template #empty>
              <CommonEmptyState
                icon="i-lucide-users-round"
                title="暂无委员会"
                description="调整筛选条件，或新建一个委员会并添加成员。"
              />
            </template>
          </UTable>
        </div>

        <div
          v-if="total > 0"
          class="mt-4 flex flex-col gap-3 border-t border-default pt-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <span class="text-sm text-muted">共 {{ total }} 条</span>
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="total"
          />
        </div>
      </UCard>

      <UModal
        v-model:open="committeeModalOpen"
        :title="committeeModalMode === 'create' ? '新建委员会' : '编辑委员会'"
        :description="committeeModalMode === 'create' ? '创建后可继续维护委员会成员与角色。' : form.committeeCode"
        :ui="{ content: 'max-w-2xl', footer: 'flex justify-end gap-2' }"
      >
        <template #body>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="委员会编码" required>
              <UInput
                v-model="form.committeeCode"
                class="w-full"
                :disabled="committeeModalMode === 'edit'"
                placeholder="例如：ARCH-COMMITTEE"
              />
            </UFormField>

            <UFormField label="委员会名称" required>
              <UInput
                v-model="form.name"
                class="w-full"
                placeholder="例如：架构委员会"
              />
            </UFormField>

            <UFormField label="归属部门">
              <USelect
                v-model="form.parentDeptCode"
                class="w-full"
                :items="parentDepartmentOptions"
              />
            </UFormField>

            <UFormField label="状态">
              <USelect
                v-model="form.status"
                class="w-full"
                :items="formStatusOptions"
              />
            </UFormField>

            <UFormField label="排序">
              <UInput
                v-model.number="form.sortOrder"
                class="w-full"
                type="number"
                min="0"
              />
            </UFormField>

            <UFormField
              label="说明"
              class="sm:col-span-2"
            >
              <UTextarea
                v-model="form.description"
                class="w-full"
                :rows="3"
                placeholder="委员会职责或适用范围"
              />
            </UFormField>
          </div>

          <UAlert
            v-if="formError"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            title="保存失败"
            :description="formError"
            class="mt-4"
          />
        </template>

        <template #footer>
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="savingCommittee"
            @click="committeeModalOpen = false"
          >
            取消
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-save"
            :loading="savingCommittee"
            @click="submitCommittee"
          >
            保存
          </UButton>
        </template>
      </UModal>

      <USlideover
        v-model:open="membersOpen"
        :title="`委员会成员：${selectedCommittee?.name || ''}`"
        :description="selectedCommittee?.committeeCode || ''"
        :ui="{ content: 'sm:max-w-4xl', body: 'space-y-4' }"
      >
        <template #body>
          <UCard v-if="canEdit" variant="subtle">
            <template #header>
              <div>
                <p class="font-medium text-highlighted">
                  添加成员
                </p>
                <p class="mt-1 text-sm text-muted">
                  主任、秘书和委员属于委员会授权主体；观察员仅用于名册展示。
                </p>
              </div>
            </template>

            <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
              <UFormField label="选择用户">
                <UserTreeSelector
                  v-model="newMemberUids"
                  v-model:users="newMemberUsers"
                  width-class="w-full"
                  hide-committees
                  placeholder="选择一个或多个用户"
                />
              </UFormField>
              <UFormField label="角色">
                <USelect
                  v-model="newMemberRole"
                  class="w-full"
                  :items="roleOptions"
                />
              </UFormField>
              <UButton
                color="primary"
                icon="i-lucide-user-plus"
                :loading="addingMembers"
                :disabled="newMemberUids.length === 0"
                @click="addMembers"
              >
                添加
              </UButton>
            </div>
          </UCard>

          <div class="grid gap-2 sm:grid-cols-2">
            <UInput
              v-model="memberSearch"
              icon="i-lucide-search"
              placeholder="搜索姓名 / UID / 邮箱"
              @keyup.enter="flushMemberSearch"
            />
            <USelect
              v-model="memberRoleFilter"
              :items="roleFilterOptions"
            />
          </div>

          <UAlert
            v-if="membersError"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            title="成员操作失败"
            :description="membersError"
          />

          <div class="overflow-x-auto">
            <UTable
              :data="members"
              :columns="memberColumns"
              :loading="membersPending"
              class="min-w-[720px] rounded-lg border border-default"
            >
              <template #uid-cell="{ row }">
                <div class="flex items-center gap-2">
                  <UAvatar
                    :src="row.original.avatar || undefined"
                    :alt="row.original.displayName"
                    size="sm"
                  />
                  <div>
                    <div class="flex items-center gap-2">
                      <p class="font-medium text-highlighted">
                        {{ row.original.displayName }}
                      </p>
                      <UBadge
                        v-if="row.original.userStatus !== 'active'"
                        color="warning"
                        variant="soft"
                        size="xs"
                      >
                        用户已停用
                      </UBadge>
                    </div>
                    <p class="text-xs text-muted">
                      {{ row.original.uid }}
                    </p>
                  </div>
                </div>
              </template>

              <template #role-cell="{ row }">
                <USelect
                  v-if="canEdit"
                  :model-value="row.original.role"
                  :items="roleOptions"
                  class="w-28"
                  :disabled="memberUpdatingUid === row.original.uid"
                  @update:model-value="updateMemberRole(row.original, $event as CommitteeMemberRole)"
                />
                <UBadge v-else color="neutral" variant="soft">
                  {{ roleLabel(row.original.role) }}
                </UBadge>
              </template>

              <template #deptName-cell="{ row }">
                {{ row.original.deptName || row.original.primaryDeptCode || '-' }}
              </template>

              <template #joinedAt-cell="{ row }">
                {{ formatDate(row.original.joinedAt) }}
              </template>

              <template #actions-cell="{ row }">
                <div class="flex justify-end">
                  <UButton
                    v-if="canEdit"
                    color="error"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-user-minus"
                    :loading="memberUpdatingUid === row.original.uid"
                    :aria-label="`移除${row.original.displayName}`"
                    @click="removeMember(row.original)"
                  >
                    移除
                  </UButton>
                </div>
              </template>

              <template #empty>
                <CommonEmptyState
                  icon="i-lucide-user-round-x"
                  title="暂无委员会成员"
                  description="调整筛选条件，或从上方选择用户加入委员会。"
                />
              </template>
            </UTable>
          </div>

          <div
            v-if="memberTotal > 0"
            class="flex flex-col gap-3 border-t border-default pt-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <span class="text-sm text-muted">共 {{ memberTotal }} 人</span>
            <UPagination
              v-model:page="memberPage"
              :items-per-page="memberPageSize"
              :total="memberTotal"
            />
          </div>
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>
