<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'

usePageTitle('部门管理')

type DeptCategory = 1 | 2 | 3 | 4

interface Department {
  id: number
  name: string
  code: string
  parentId: number | null
  isActive: boolean
  isExternal: boolean
  orgType: 'department' | 'committee'
  deptCategory: DeptCategory | null
  managerId: string | null
  manager: string | null
  leaderId: string | null
  leader: string | null
  memberNames: string[]
  totalMembers?: number
  children?: Department[]
  expanded?: boolean
  level?: number
}

interface ManagerCandidate {
  id: number
  uid: string
  realName: string | null
  email: string
}

interface CommitteeMember {
  uid: string
  realName: string | null
  email: string | null
  position: string | null
  isPrimary: boolean
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

const toast = useToast()

const filters = reactive({
  search: '',
  isExternal: 'all',
  orgType: 'all'
})

const loading = ref(false)
const flatDepartments = ref<Department[]>([])
const managers = ref<ManagerCandidate[]>([])
const expandedIds = ref<Set<number>>(new Set())

// Build tree structure from flat list
function buildTree(items: Department[]): Department[] {
  const map = new Map<number, Department>()
  const roots: Department[] = []

  // Create map with all items
  items.forEach((item) => {
    map.set(item.id, { ...item, children: [], level: 0 })
  })

  // Build tree
  map.forEach((item) => {
    if (item.parentId && map.has(item.parentId)) {
      const parent = map.get(item.parentId)!
      item.level = (parent.level || 0) + 1
      parent.children!.push(item)
    } else {
      roots.push(item)
    }
  })

  return roots
}

// Flatten tree for display (respecting expanded state)
function flattenTree(nodes: Department[], result: Department[] = []): Department[] {
  for (const node of nodes) {
    result.push(node)
    if (node.children?.length && expandedIds.value.has(node.id)) {
      flattenTree(node.children, result)
    }
  }
  return result
}

const treeData = computed(() => buildTree(flatDepartments.value))
const displayData = computed(() => flattenTree(treeData.value))

function toggleExpand(dept: Department) {
  if (expandedIds.value.has(dept.id)) {
    expandedIds.value.delete(dept.id)
  } else {
    expandedIds.value.add(dept.id)
  }
  // Trigger reactivity
  expandedIds.value = new Set(expandedIds.value)
}

function hasChildren(dept: Department): boolean {
  return flatDepartments.value.some(d => d.parentId === dept.id)
}

const parentDepartmentOptions = computed(() => [
  { label: '无父部门 (根级)', value: null },
  ...flatDepartments.value.map(d => ({
    label: '─'.repeat(d.level || 0) + ' ' + d.name,
    value: d.id
  }))
])

function getCandidateName(candidate: Pick<ManagerCandidate, 'uid' | 'realName'>) {
  return candidate.realName?.trim() || candidate.uid
}

const userNamesByUid = computed(() => new Map(
  managers.value.map(candidate => [candidate.uid, getCandidateName(candidate)])
))

function getUserName(uid: string | null | undefined) {
  if (!uid) return ''
  return userNamesByUid.value.get(uid) || uid
}

const managerOptions = computed(() => [
  { label: '未设置', uid: undefined, value: null },
  ...managers.value.map(p => ({
    label: getCandidateName(p),
    uid: getCandidateName(p) !== p.uid ? p.uid : undefined,
    value: p.uid
  }))
])

async function getDepartments() {
  loading.value = true
  try {
    const params: Record<string, string | number> = {}
    if (filters.search) params.search = filters.search
    if (filters.isExternal !== 'all') params.isExternal = filters.isExternal
    if (filters.orgType !== 'all') params.orgType = filters.orgType

    const result = await $fetch<ApiResponse<Department[]>>('/api/departments', { params })
    if (result && Array.isArray(result.data)) {
      flatDepartments.value = result.data
      // Expand all by default
      flatDepartments.value.forEach((d) => {
        if (hasChildren(d)) expandedIds.value.add(d.id)
      })
    } else {
      flatDepartments.value = []
    }
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({
      title: '加载失败',
      description: error.message || '无法加载部门列表',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function getManagers() {
  try {
    const result = await $fetch<ApiResponse<ManagerCandidate[]> | ManagerCandidate[]>('/api/system-users')
    const data = Array.isArray(result) ? result : (result as ApiResponse<ManagerCandidate[]>).data || []
    managers.value = data
  } catch (err: unknown) {
    console.error('Failed to load managers', err)
  }
}

// Modal State
const isModalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingId = ref<number | null>(null)
const formState = reactive({
  name: '',
  code: '',
  parentId: null as number | null,
  managerId: null as string | null,
  leaderId: null as string | null,
  isActive: true,
  isExternal: false,
  orgType: 'department' as 'department' | 'committee',
  deptCategory: null as DeptCategory | null
})
const saving = ref(false)

function openCreateModal(parentDept?: Department) {
  modalMode.value = 'create'
  editingId.value = null
  formState.name = ''
  formState.code = ''
  formState.parentId = parentDept?.id || null
  formState.managerId = null
  formState.leaderId = null
  formState.isActive = true
  formState.isExternal = false
  formState.orgType = 'department'
  formState.deptCategory = null
  isModalOpen.value = true
}

function openEditModal(dept: Department) {
  modalMode.value = 'edit'
  editingId.value = dept.id
  formState.name = dept.name
  formState.code = dept.code || ''
  formState.parentId = dept.parentId
  formState.managerId = dept.managerId
  formState.leaderId = dept.leaderId
  formState.isActive = dept.isActive
  formState.isExternal = dept.isExternal
  formState.orgType = dept.orgType || 'department'
  formState.deptCategory = dept.deptCategory ?? null
  isModalOpen.value = true
}

async function saveDepartment() {
  if (!formState.name) {
    toast.add({ title: '请输入部门名称', color: 'warning' })
    return
  }

  saving.value = true
  try {
    const payload = {
      ...formState,
      deptCategory: formState.orgType === 'committee' ? null : formState.deptCategory
    }

    if (modalMode.value === 'create') {
      await $fetch('/api/departments', {
        method: 'POST',
        body: payload
      })
      toast.add({ title: '创建成功', color: 'success' })
    } else {
      if (!editingId.value) return
      await $fetch(`/api/departments/${editingId.value}`, {
        method: 'PATCH',
        body: payload
      })
      toast.add({ title: '更新成功', color: 'success' })
    }
    isModalOpen.value = false
    await getDepartments()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '保存失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

async function deleteDepartment(dept: Department) {
  if (!confirm(`确定要删除${dept.orgType === 'committee' ? '委员会' : '部门'} "${dept.name}" 吗？`)) return

  try {
    await $fetch(`/api/departments/${dept.id}`, {
      method: 'DELETE'
    })
    toast.add({ title: '删除成功', color: 'success' })
    await getDepartments()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '删除失败',
      description: error.data?.message || error.message || '无法删除',
      color: 'error'
    })
  }
}

const expandedFlag = ref(false)
function expandAll() {
  expandedFlag.value = !expandedFlag.value
  flatDepartments.value.forEach((d) => {
    if (hasChildren(d)) expandedIds.value.add(d.id)
  })
  expandedIds.value = new Set(expandedIds.value)
}

function collapseAll() {
  expandedFlag.value = !expandedFlag.value
  expandedIds.value.clear()
  expandedIds.value = new Set(expandedIds.value)
}

// ============================================================
// Committee Members Management
// ============================================================
const isMembersModalOpen = ref(false)
const membersModalDept = ref<Department | null>(null)
const committeeMembers = ref<CommitteeMember[]>([])
const selectedMemberUids = ref<string[]>([])
const membersLoading = ref(false)
const membersSaving = ref(false)

async function openMembersModal(dept: Department) {
  membersModalDept.value = dept
  isMembersModalOpen.value = true
  membersLoading.value = true

  try {
    const result = await $fetch<ApiResponse<CommitteeMember[]>>('/api/departments/members', {
      params: { deptCode: dept.code }
    })
    committeeMembers.value = result.data || []
    selectedMemberUids.value = committeeMembers.value.map(m => m.uid)
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({ title: '加载成员失败', description: error.message, color: 'error' })
    committeeMembers.value = []
    selectedMemberUids.value = []
  } finally {
    membersLoading.value = false
  }
}

async function saveMembers() {
  if (!membersModalDept.value) return

  membersSaving.value = true
  try {
    await $fetch('/api/departments/members', {
      method: 'POST',
      body: {
        deptCode: membersModalDept.value.code,
        memberUids: selectedMemberUids.value
      }
    })
    toast.add({ title: '成员更新成功', color: 'success' })
    isMembersModalOpen.value = false
    await getDepartments()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '保存成员失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    membersSaving.value = false
  }
}

// All users as options for the member picker
const allUserOptions = computed(() =>
  managers.value.map(p => ({
    label: getCandidateName(p),
    uid: getCandidateName(p) !== p.uid ? p.uid : undefined,
    value: p.uid
  }))
)

onMounted(async () => {
  await Promise.all([
    getDepartments(),
    getManagers()
  ])
})

const isExternalOptions = [
  { label: '全部', value: 'all' },
  { label: '内部', value: '0' },
  { label: '外部', value: '1' }
]

const orgTypeOptions = [
  { label: '全部', value: 'all' },
  { label: '部门', value: 'department' },
  { label: '委员会', value: 'committee' }
]

const orgTypeFormOptions = [
  { label: '部门', value: 'department' },
  { label: '委员会', value: 'committee' }
]

const deptCategoryOptions = [
  { label: '未分类', value: null },
  { label: '行政', value: 1 },
  { label: '业务支撑', value: 2 },
  { label: '业务', value: 3 },
  { label: '核心管理', value: 4 }
]

const deptCategoryMeta: Record<DeptCategory, { label: string, color: 'neutral' | 'secondary' | 'info' | 'success' }> = {
  1: { label: '行政', color: 'neutral' },
  2: { label: '业务支撑', color: 'secondary' },
  3: { label: '业务', color: 'success' },
  4: { label: '核心管理', color: 'info' }
}

function getDeptCategoryMeta(category: DeptCategory | null | undefined) {
  if (!category) return null
  return deptCategoryMeta[category]
}

// Stats
const deptCount = computed(() => flatDepartments.value.filter(d => (d.orgType || 'department') === 'department').length)
const committeeCount = computed(() => flatDepartments.value.filter(d => d.orgType === 'committee').length)
</script>

<template>
  <div class="flex flex-col w-full min-w-0 flex-1">
    <UDashboardPanel id="departments-tree" :ui="{ body: 'gap-1 sm:p-4' }" grow>
      <template #header>
        <UDashboardToolbar>
          <template #left>
            <div class="flex items-center gap-4">
              <div class="flex items-center gap-2">
                <span class="text-sm text-gray-600 dark:text-gray-400">类型:</span>
                <URadioGroup
                  v-model="filters.orgType"
                  :items="orgTypeOptions"
                  orientation="horizontal"
                  size="sm"
                  @change="getDepartments"
                />
              </div>
              <div class="flex items-center gap-2">
                <span class="text-sm text-gray-600 dark:text-gray-400">内外:</span>
                <URadioGroup
                  v-model="filters.isExternal"
                  :items="isExternalOptions"
                  orientation="horizontal"
                  size="sm"
                  @change="getDepartments"
                />
              </div>
            </div>
          </template>

          <template #right>
            <div class="flex items-center gap-2">
              <UButton
                v-if="expandedFlag"
                size="xs"
                variant="ghost"
                icon="i-lucide-unfold-vertical"
                @click="expandAll"
              >
                展开全部
              </UButton>
              <UButton
                v-else
                size="xs"
                variant="ghost"
                icon="i-lucide-fold-vertical"
                @click="collapseAll"
              >
                收起全部
              </UButton>
              <UInput
                v-model="filters.search"
                icon="i-lucide-search"
                placeholder="搜索..."
                size="sm"
                class="w-52"
                @change="getDepartments"
              >
                <template v-if="filters.search?.length" #trailing>
                  <UButton
                    color="neutral"
                    variant="link"
                    size="sm"
                    icon="i-lucide-circle-x"
                    aria-label="Clear input"
                    @click="filters.search = ''; getDepartments()"
                  />
                </template>
              </UInput>
              <UButton
                color="primary"
                size="sm"
                variant="solid"
                icon="i-lucide-plus"
                @click="openCreateModal()"
              >
                新建
              </UButton>
              <UButton
                color="secondary"
                size="sm"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="loading"
                @click="getDepartments"
              >
                刷新
              </UButton>
            </div>
          </template>
        </UDashboardToolbar>
      </template>

      <template #body>
        <UCard :ui="{ body: 'p-4' }">
          <div class="divide-y divide-gray-100 dark:divide-gray-800 overflow-y-auto max-h-[calc(100vh-178px)]">
            <!-- Tree Items -->
            <div
              v-for="dept in displayData"
              :key="dept.id"
              class="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              :style="{ paddingLeft: `${(dept.level || 0) * 24 + 16}px` }"
            >
              <!-- Row 1: Icon + Name + Badges + Leader/DM + Actions -->
              <div class="flex items-center gap-2">
                <!-- Expand/Collapse Button -->
                <button
                  v-if="hasChildren(dept)"
                  class="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-200 dark:hover:bg-gray-700 shrink-0"
                  @click="toggleExpand(dept)"
                >
                  <UIcon
                    :name="expandedIds.has(dept.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                    class="w-4 h-4 text-gray-500"
                  />
                </button>
                <div v-else class="w-6 shrink-0" />

                <!-- Icon: department vs committee -->
                <UIcon
                  :name="dept.orgType === 'committee' ? 'i-lucide-users' : (hasChildren(dept) ? 'i-lucide-building-2' : 'i-lucide-building')"
                  :class="[dept.orgType === 'committee' ? 'text-indigo-500' : 'text-amber-500', 'w-5 h-5 shrink-0']"
                />

                <!-- Department Name -->
                <div class="font-medium truncate">
                  {{ dept.name }}
                  <span v-if="dept.code" class="text-xs text-gray-500 ml-1">{{ dept.code }}</span>
                </div>

                <!-- Type Badge -->
                <UBadge
                  v-if="dept.orgType === 'committee'"
                  color="info"
                  size="xs"
                  variant="subtle"
                  class="shrink-0"
                >
                  委员会
                </UBadge>

                <UBadge
                  v-else-if="getDeptCategoryMeta(dept.deptCategory)"
                  :color="getDeptCategoryMeta(dept.deptCategory)?.color"
                  size="xs"
                  variant="subtle"
                  class="shrink-0"
                >
                  {{ getDeptCategoryMeta(dept.deptCategory)?.label }}
                </UBadge>

                <!-- External Badge -->
                <UBadge
                  v-if="dept.isExternal"
                  color="warning"
                  size="xs"
                  variant="subtle"
                  class="shrink-0"
                >
                  外部
                </UBadge>

                <!-- Total members for Root nodes -->
                <div v-if="!dept.parentId" class="text-sm text-gray-500 dark:text-gray-400 shrink-0">
                  人数: {{ dept.totalMembers }}
                </div>

                <!-- Manager -->
                <div v-if="dept.manager" class="text-sm text-gray-500 dark:text-gray-400 shrink-0">
                  负责人: {{ dept.manager }}
                </div>

                <!-- Leader -->
                <div v-if="dept.leader" class="text-sm text-gray-500 dark:text-gray-400 shrink-0">
                  分管副总: {{ dept.leader }}
                </div>

                <!-- Spacer -->
                <div class="flex-1" />

                <!-- Actions -->
                <div class="flex items-center gap-1 shrink-0">
                  <UButton
                    v-if="!hasChildren(dept)"
                    size="xs"
                    color="info"
                    variant="ghost"
                    icon="i-lucide-user-plus"
                    title="管理成员"
                    @click="openMembersModal(dept)"
                  />
                  <UButton
                    size="xs"
                    color="primary"
                    variant="ghost"
                    icon="i-lucide-plus"
                    title="添加子部门"
                    @click="openCreateModal(dept)"
                  />
                  <UButton
                    size="xs"
                    color="primary"
                    variant="ghost"
                    icon="i-lucide-edit"
                    @click="openEditModal(dept)"
                  />
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    @click="deleteDepartment(dept)"
                  />
                </div>
              </div>

              <!-- Members (for all org types) -->
              <div
                v-if="dept.memberNames?.length"
                class="flex items-center gap-1.5 mt-1.5 text-sm text-gray-500 dark:text-gray-400"
                :style="{ paddingLeft: '56px' }"
              >
                <UIcon name="i-lucide-user-check" class="w-3.5 h-3.5 shrink-0" />
                <span>成员({{ dept.memberNames.length }})：{{ dept.memberNames.join('、') }}</span>
              </div>
            </div>

            <!-- Empty State -->
            <div v-if="!loading && displayData.length === 0" class="py-10 text-center text-sm text-gray-500">
              暂无数据
            </div>
          </div>

          <div
            v-if="!loading && flatDepartments.length > 0"
            class="p-2 text-center text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800"
          >
            共 {{ deptCount }} 个部门，{{ committeeCount }} 个委员会
          </div>
        </UCard>
      </template>
    </UDashboardPanel>

    <!-- Create/Edit Modal -->
    <UModal
      v-model:open="isModalOpen"
      :title="modalMode === 'create' ? (formState.orgType === 'committee' ? '新建委员会' : '新建部门') : (formState.orgType === 'committee' ? '编辑委员会' : '编辑部门')"
      :ui="{ content: 'sm:max-w-2xl', footer: 'justify-end' }"
    >
      <template #body>
        <div class="space-y-6 p-2">
          <!-- 机构类型 -->
          <UFormField
            label="机构类型"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <URadioGroup v-model="formState.orgType" :items="orgTypeFormOptions" orientation="horizontal" />
          </UFormField>

          <!-- 名称 -->
          <UFormField
            :label="formState.orgType === 'committee' ? '委员会名称' : '部门名称'"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UInput
              v-model="formState.name"
              :placeholder="formState.orgType === 'committee' ? '请输入委员会名称' : '请输入部门名称'"
              class="w-full"
            />
          </UFormField>

          <!-- 编码 -->
          <UFormField
            label="编码"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UInput v-model="formState.code" placeholder="例如：DEV001" class="w-full" />
          </UFormField>

          <!-- 父级 -->
          <UFormField
            label="上级"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USelectMenu
              v-model="formState.parentId"
              :items="parentDepartmentOptions"
              value-key="value"
              label-key="label"
              placeholder="选择上级"
              size="md"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-if="formState.orgType === 'department'"
            label="部门类别"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USelectMenu
              v-model="formState.deptCategory"
              :items="deptCategoryOptions"
              value-key="value"
              label-key="label"
              placeholder="选择部门类别"
              size="md"
              class="w-full"
            />
          </UFormField>

          <!-- 负责人  -->
          <UFormField
            label="负责人"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USelectMenu
              v-model="formState.managerId"
              :items="managerOptions"
              :filter-fields="['label', 'uid']"
              value-key="value"
              label-key="label"
              :placeholder="formState.orgType === 'committee' ? '选择常务委员' : '选择部门经理'"
              searchable
              size="md"
              class="w-full"
            >
              <template #item-label="{ item }">
                {{ item.label }}
                <span v-if="item.uid" class="text-muted">({{ item.uid }})</span>
              </template>
            </USelectMenu>
          </UFormField>

          <!-- 分管副总 -->
          <UFormField
            label="分管副总"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USelectMenu
              v-model="formState.leaderId"
              :items="managerOptions"
              :filter-fields="['label', 'uid']"
              value-key="value"
              label-key="label"
              placeholder="选择分管副总"
              searchable
              size="md"
              class="w-full"
            >
              <template #item-label="{ item }">
                {{ item.label }}
                <span v-if="item.uid" class="text-muted">({{ item.uid }})</span>
              </template>
            </USelectMenu>
          </UFormField>

          <UFormField
            label="是否外部"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USwitch v-model="formState.isExternal" />
          </UFormField>

          <UFormField
            label="是否启用"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USwitch v-model="formState.isActive" />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 pt-1">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="isModalOpen = false"
          />
          <UButton
            :label="modalMode === 'create' ? '创建' : '保存修改'"
            color="primary"
            :loading="saving"
            @click="saveDepartment"
          />
        </div>
      </template>
    </UModal>

    <!-- Committee Members Modal -->
    <UModal
      v-model:open="isMembersModalOpen"
      :title="`管理成员 - ${membersModalDept?.name || ''}`"
      :ui="{ content: 'sm:max-w-2xl min-h-[34rem]', body: 'min-h-96', footer: 'justify-end' }"
    >
      <template #body>
        <div class="p-2 space-y-4">
          <p class="text-sm text-gray-500">
            选择成员（可多选）：
          </p>

          <div v-if="membersLoading" class="py-8 text-center text-sm text-gray-500">
            加载中...
          </div>
          <div v-else>
            <USelectMenu
              v-model="selectedMemberUids"
              :items="allUserOptions"
              :filter-fields="['label', 'uid']"
              value-key="value"
              label-key="label"
              multiple
              searchable
              placeholder="搜索并选择成员..."
              size="md"
              class="w-full"
            >
              <template #item-label="{ item }">
                {{ item.label }}
                <span v-if="item.uid" class="text-muted">({{ item.uid }})</span>
              </template>
            </USelectMenu>

            <div v-if="selectedMemberUids.length > 0" class="mt-4">
              <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">
                已选 {{ selectedMemberUids.length }} 人：
              </p>
              <div class="flex flex-wrap gap-2">
                <UBadge
                  v-for="uid in selectedMemberUids"
                  :key="uid"
                  color="primary"
                  variant="subtle"
                  size="sm"
                >
                  {{ getUserName(uid) || uid }}
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="link"
                    icon="i-lucide-x"
                    class="ml-1"
                    @click="selectedMemberUids = selectedMemberUids.filter(u => u !== uid)"
                  />
                </UBadge>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 pt-1">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="isMembersModalOpen = false"
          />
          <UButton
            label="保存成员"
            color="primary"
            :loading="membersSaving"
            @click="saveMembers"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
