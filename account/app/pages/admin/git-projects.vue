<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'

interface Project {
  id: number
  projectCode: string
  parentId?: string | null
  name: string
  deptCode: string
  leaderUid: string | null
  description: string | null
  startDate: string | null
  endDate: string | null
  repoUrl: string | null
  isGroup: number
  isTemplate: number
  status: number
  docsSyncedAt: string | null
  docsCommittedAt: string | null
  createdAt: string
  updatedAt: string
  children?: Project[]
  memberCount?: number
}

interface Department {
  id: number
  name: string
  code: string
  dept_code?: string
}

interface User {
  id: number
  uid: string
  realName: string | null
  email: string | null
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

usePageTitle('Git项目')

const toast = useToast()
const projects = ref<Project[]>([])
const departments = ref<Department[]>([])
const loading = ref(false)
const saving = ref(false)

// Filters
const filters = reactive({
  search: '',
  deptCode: '',
  status: 'all' as 'all' | '1' | '0'
})

const formState = reactive({
  projectCode: '',
  parentId: null as string | null,
  name: '',
  deptCode: undefined as string | undefined,
  leaderUid: '',
  description: '',
  startDate: '',
  endDate: '',
  repoUrl: '',
  status: 1
})
const expandedProjectCodes = ref<Set<string>>(new Set())

const toggleExpand = (project: Project) => {
  if (expandedProjectCodes.value.has(project.projectCode)) {
    expandedProjectCodes.value.delete(project.projectCode)
  } else {
    expandedProjectCodes.value.add(project.projectCode)
  }
}

// Flatten projects for tree view
const flattenedProjects = computed(() => {
  const flat: (Project & { depth: number })[] = []

  const flatten = (items: Project[], depth = 0) => {
    for (const item of items) {
      flat.push({ ...item, depth })
      if (item.children && item.children.length > 0 && expandedProjectCodes.value.has(item.projectCode)) {
        flatten(item.children, depth + 1)
      }
    }
  }

  flatten(projects.value)
  return flat
})

// Modal state
const isModalOpen = ref(false)
const modalMode = ref<'create' | 'edit'>('create')
const editingProject = ref<Project | null>(null)

const statusLabels: Record<number, { label: string, color: 'success' | 'neutral' }> = {
  0: { label: '禁用', color: 'neutral' },
  1: { label: '启用', color: 'success' }
}

const statusOptions = [
  { label: '全部', value: 'all' },
  { label: '启用', value: '1' },
  { label: '禁用', value: '0' }
]

const departmentOptions = computed(() => [
  { label: '全部部门', value: '' },
  ...departments.value.map(d => ({
    label: d.name,
    value: d.dept_code || d.code || String(d.id)
  }))
])

const formDeptOptions = computed(() =>
  departments.value.map(d => ({
    label: d.name,
    value: d.dept_code || d.code || String(d.id)
  }))
)

const leaders = ref<User[]>([])

function getCandidateName(candidate: Pick<User, 'uid' | 'realName'>) {
  return candidate.realName?.trim() || candidate.uid
}

const uniqueLeaders = computed(() => {
  const seen = new Set<string>()
  return leaders.value.filter((user) => {
    if (seen.has(user.uid)) return false
    seen.add(user.uid)
    return true
  })
})

const userNamesByUid = computed(() => new Map(
  uniqueLeaders.value.map(candidate => [candidate.uid, getCandidateName(candidate)])
))

function getUserName(uid: string | null | undefined) {
  if (!uid) return ''
  return userNamesByUid.value.get(uid) || uid
}

const leaderOptions = computed(() => {
  return uniqueLeaders.value
    .map(u => ({
      label: getCandidateName(u),
      uid: getCandidateName(u) !== u.uid ? u.uid : undefined,
      value: u.uid
    }))
})

// Load departments
async function loadDepartments() {
  try {
    const result = await $fetch<ApiResponse<Department[]>>('/api/departments')
    departments.value = result.data || []
  } catch (err: unknown) {
    console.error('Failed to load departments:', err)
    toast.add({ title: '加载部门失败', color: 'error' })
  }
}

// Load leaders
async function loadLeaders() {
  try {
    const result = await $fetch<ApiResponse<User[]> | User[]>('/api/system-users')
    const data = Array.isArray(result) ? result : (result as ApiResponse<User[]>).data || []
    leaders.value = data
  } catch (err: unknown) {
    console.error('Failed to load leaders:', err)
  }
}

// Load projects
async function loadProjects() {
  loading.value = true
  try {
    const params: Record<string, string> = {}
    if (filters.search) params.search = filters.search
    if (filters.deptCode) params.dept_code = filters.deptCode
    if (filters.status !== 'all') params.status = filters.status

    const result = await $fetch<ApiResponse<Project[]>>('/api/git-projects', { params })

    // Build tree structure
    const rawProjects = result.data || []

    const projectMap = new Map<string, Project>()
    // Initialize map and children array
    rawProjects.forEach((p) => {
      projectMap.set(p.projectCode, p)
    })

    const rootProjects: Project[] = []

    rawProjects.forEach((p) => {
      if (p.parentId && projectMap.has(p.parentId)) {
        const parent = projectMap.get(p.parentId)!
        if (!parent.children) parent.children = []
        parent.children.push(p)
      } else {
        rootProjects.push(p)
      }
    })

    projects.value = rootProjects

    // 加载所有项目的成员数量
    await loadMemberCounts()
  } catch (err: unknown) {
    const error = err as { message: string }
    toast.add({
      title: '加载失败',
      description: error.message || '无法加载项目列表',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

// 加载所有项目的成员数量
async function loadMemberCounts() {
  const allProjects = flattenAllProjects(projects.value)
  for (const project of allProjects) {
    try {
      const result = await $fetch<ApiResponse<User[]>>('/api/git-projects/members', {
        params: { projectCode: project.projectCode }
      })
      project.memberCount = result.data?.length || 0
    } catch {
      project.memberCount = 0
    }
  }
}

// 递归获取所有项目（包括子项目）
function flattenAllProjects(items: Project[]): Project[] {
  const result: Project[] = []
  for (const item of items) {
    result.push(item)
    if (item.children && item.children.length > 0) {
      result.push(...flattenAllProjects(item.children))
    }
  }
  return result
}

// Open edit modal
function openEditModal(project: Project) {
  modalMode.value = 'edit'
  editingProject.value = project
  Object.assign(formState, {
    projectCode: project.projectCode,
    name: project.name,
    deptCode: project.deptCode,
    leaderUid: project.leaderUid || '',
    description: project.description || '',
    startDate: project.startDate?.split('T')[0] || '',
    endDate: project.endDate?.split('T')[0] || '',
    repoUrl: project.repoUrl || '',
    status: project.status
  })
  isModalOpen.value = true
}

// Save project
async function saveProject() {
  if (!formState.description) {
    toast.add({ title: '请输入项目名称', color: 'warning' })
    return
  }
  if (!formState.deptCode) {
    toast.add({ title: '请选择所属部门', color: 'warning' })
    return
  }

  saving.value = true
  try {
    if (modalMode.value === 'create') {
      if (!formState.projectCode) {
        toast.add({ title: '请输入项目ID', color: 'warning' })
        saving.value = false
        return
      }
      await $fetch('/api/git-projects', {
        method: 'POST',
        body: formState
      })
      toast.add({ title: '创建成功', color: 'success' })
    } else {
      if (!editingProject.value) return
      await $fetch(`/api/git-projects/${editingProject.value.id}`, {
        method: 'PATCH',
        body: {
          name: formState.name,
          leaderUid: formState.leaderUid || null,
          description: formState.description || null,
          startDate: formState.startDate || null,
          endDate: formState.endDate || null,
          repoUrl: formState.repoUrl || null,
          status: formState.status
        }
      })
      toast.add({ title: '更新成功', color: 'success' })
    }
    isModalOpen.value = false
    await loadProjects()
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

// Delete project
async function deleteProject(project: Project) {
  if (!confirm(`确定要删除项目 "${project.name}" 吗？此操作不可逆。`)) return

  try {
    await $fetch(`/api/git-projects/${project.id}`, {
      method: 'DELETE'
    })
    toast.add({ title: '删除成功', color: 'success' })
    await loadProjects()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '删除失败',
      description: error.data?.message || error.message || '无法删除',
      color: 'error'
    })
  }
}

// Get department name
function getDeptName(deptCode: string) {
  const dept = departments.value.find(d => (d.dept_code || d.code || String(d.id)) === deptCode)
  return dept?.name || deptCode
}

// Get leader name
function getLeaderName(uid: string | null) {
  if (!uid) return '-'
  const user = leaders.value.find(u => u.uid === uid)
  return user ? (user.realName || user.uid) : uid
}

// ============================================================
// Project Members Management
// ============================================================
const isMembersModalOpen = ref(false)
const membersModalProject = ref<Project | null>(null)
const selectedMemberUids = ref<string[]>([])
const membersLoading = ref(false)

// 获取成员预览文本
function getMembersPreview(project: Project) {
  return project.memberCount?.toString() || '0'
}

async function openMembersModal(project: Project) {
  membersModalProject.value = project
  isMembersModalOpen.value = true
  membersLoading.value = true
  try {
    const result = await $fetch<ApiResponse<User[]>>('/api/git-projects/members', {
      params: { projectCode: project.projectCode }
    })
    selectedMemberUids.value = (result.data || []).map(m => m.uid)
  } catch {
    selectedMemberUids.value = []
  } finally {
    membersLoading.value = false
  }
}

// Sync from GitLab
const syncing = ref(false)
const showSyncConfirm = ref(false)

async function syncFromGitLab() {
  showSyncConfirm.value = false
  syncing.value = true
  try {
    const result = await $fetch<ApiResponse<string>>('/api/git-projects/sync-gitlab', {
      method: 'POST'
    })
    toast.add({
      title: '同步成功',
      description: result.message,
      color: 'success'
    })
    await loadProjects()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '同步失败',
      description: error.data?.message || error.message || 'GitLab 同步失败',
      color: 'error'
    })
  } finally {
    syncing.value = false
  }
}

// 全部展开/折叠
function expandAll() {
  const allProjects = flattenAllProjects(projects.value)
  allProjects.forEach((p) => {
    if (p.children && p.children.length > 0) {
      expandedProjectCodes.value.add(p.projectCode)
    }
  })
}

function collapseAll() {
  expandedProjectCodes.value.clear()
}

// Format date
function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('zh-CN')
}

const columns = [
  { accessorKey: 'projectCode', header: '项目标识' },
  { accessorKey: 'name', header: '项目名称' },
  { accessorKey: 'deptCode', header: '所属部门' },
  { accessorKey: 'leaderUid', header: '负责人' },
  { accessorKey: 'members', header: '成员' },
  { accessorKey: 'createdAt', header: '创建时间' },
  { accessorKey: 'status', header: '状态' },
  { id: 'actions', header: '操作' }
]

// Toggle template flag
async function toggleTemplate(project: Project) {
  const newStatus = project.isTemplate ? 0 : 1
  try {
    await $fetch(`/api/git-projects/${project.id}`, {
      method: 'PATCH',
      body: { isTemplate: newStatus }
    })
    toast.add({ title: newStatus ? '已设为模板' : '已取消模板', color: 'success' })
    await loadProjects()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: error.data?.message || '操作失败', color: 'error' })
  }
}

// Batch set template for all sub-projects under a group
async function batchSetTemplate(group: Project, isTemplate: boolean) {
  const children = group.children || []
  const subProjects = children.filter(c => c.isGroup === 0)
  if (subProjects.length === 0) {
    toast.add({ title: '该群组下没有子项目', color: 'warning' })
    return
  }

  try {
    await $fetch('/api/git-projects/batch-template', {
      method: 'POST',
      body: {
        projectCodes: subProjects.map(p => p.projectCode),
        isTemplate
      }
    })
    toast.add({
      title: `已${isTemplate ? '设为' : '取消'}模板：${subProjects.length} 个项目`,
      color: 'success'
    })
    await loadProjects()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({ title: error.data?.message || '批量操作失败', color: 'error' })
  }
}

// ============================================================
// Fork Create Project
// ============================================================
const isForkModalOpen = ref(false)
const forkSaving = ref(false)
const forkForm = reactive({
  targetNamespace: '',
  projectPath: '',
  projectName: '',
  leaderUid: '',
  deptCode: undefined as string | undefined,
  templateProjectCode: ''
})

// 群组选项（is_group=1 的项目）
const groupOptions = computed(() => {
  const allProjects = flattenAllProjects(projects.value)
  return allProjects
    .filter(p => p.isGroup === 1)
    .map(p => ({
      label: p.description || p.name,
      value: p.projectCode
    }))
})

// 模板项目选项（is_template=1 且 is_group=0）
const templateOptions = computed(() => {
  const allProjects = flattenAllProjects(projects.value)
  return allProjects
    .filter(p => !!p.isTemplate && p.isGroup === 0)
    .map(p => ({
      label: `${p.description || p.name} (${p.projectCode.split('/').pop()})`,
      value: p.projectCode
    }))
})

function openForkModal() {
  Object.assign(forkForm, {
    targetNamespace: '',
    projectPath: '',
    projectName: '',
    leaderUid: '',
    deptCode: undefined,
    templateProjectCode: ''
  })
  isForkModalOpen.value = true
}

async function forkCreateProject() {
  if (!forkForm.targetNamespace) {
    toast.add({ title: '请选择目标群组', color: 'warning' })
    return
  }
  if (!forkForm.projectPath) {
    toast.add({ title: '请输入项目标识', color: 'warning' })
    return
  }
  if (!forkForm.projectName) {
    toast.add({ title: '请输入项目名称', color: 'warning' })
    return
  }
  if (!forkForm.deptCode) {
    toast.add({ title: '请选择所属部门', color: 'warning' })
    return
  }

  if (!forkForm.templateProjectCode) {
    toast.add({ title: '请选择项目模板', color: 'warning' })
    return
  }

  forkSaving.value = true
  try {
    const result = await $fetch<ApiResponse<{ repoUrl: string }>>('/api/git-projects/fork-create', {
      method: 'POST',
      body: {
        templateProjectCode: forkForm.templateProjectCode,
        targetNamespace: forkForm.targetNamespace,
        projectPath: forkForm.projectPath,
        projectName: forkForm.projectName,
        leaderUid: forkForm.leaderUid,
        deptCode: forkForm.deptCode
      }
    })
    toast.add({
      title: '项目创建成功',
      description: `仓库地址: ${result.data?.repoUrl || ''}`,
      color: 'success'
    })
    isForkModalOpen.value = false
    await loadProjects()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '创建失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    forkSaving.value = false
  }
}

// 计算is_group为0的项目数量
const projectCount = computed(() => {
  const allProjects = flattenAllProjects(projects.value)
  return allProjects.filter(p => p.isGroup === 0).length
})

onMounted(() => {
  loadProjects()
  loadDepartments()
  loadLeaders()
})
</script>

<template>
  <div class="flex flex-col flex-1 w-full min-w-0">
    <UDashboardPanel grow>
      <div class="flex justify-end gap-2 px-4 py-2 border-b border-default">
        <UInput
          v-model="filters.search"
          placeholder="搜索项目标识或名称..."
          icon="i-lucide-search"
          size="sm"
          class="w-52"
          @keydown.enter="loadProjects"
        />

        <USelectMenu
          v-if="false"
          v-model="filters.deptCode"
          :items="departmentOptions"
          value-key="value"
          label-key="label"
          placeholder="部门"
          size="sm"
          class="w-32"
          @update:model-value="loadProjects"
        />

        <USelectMenu
          v-model="filters.status"
          :items="statusOptions"
          value-key="value"
          label-key="label"
          placeholder="状态"
          size="sm"
          class="w-24"
          @update:model-value="loadProjects"
        />

        <UButton
          v-if="false"
          color="primary"
          size="sm"
          icon="i-lucide-plus"
          @click="openForkModal"
        >
          创建项目
        </UButton>

        <UButton
          color="success"
          size="sm"
          icon="i-lucide-git-branch"
          :loading="syncing"
          @click="showSyncConfirm = true"
        >
          从 GitLab 同步
        </UButton>

        <UButton
          color="neutral"
          size="sm"
          variant="ghost"
          icon="i-lucide-unfold-vertical"
          @click="expandAll"
        >
          全部展开
        </UButton>

        <UButton
          color="neutral"
          size="sm"
          variant="ghost"
          icon="i-lucide-fold-vertical"
          @click="collapseAll"
        >
          全部折叠
        </UButton>

        <UButton
          color="neutral"
          size="sm"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="loadProjects"
        >
          刷新
        </UButton>
      </div>

      <div class="p-4">
        <UCard :ui="{ body: 'p-0' }">
          <UTable
            :data="flattenedProjects"
            :columns="columns"
            :loading="loading"
            empty-state-title="暂无项目"
            sticky
            class="w-full max-h-[calc(100vh-200px)]"
          >
            <template #projectCode-cell="{ row }">
              <div class="flex items-center gap-1">
                <!-- Indentation for tree structure -->
                <div :style="{ width: `${row.original.depth * 1.5}rem` }" />

                <!-- Expander button -->
                <UButton
                  v-if="row.original.children && row.original.children.length > 0"
                  :icon="expandedProjectCodes.has(row.original.projectCode) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  class="-ml-1 rounded-full"
                  @click="toggleExpand(row.original)"
                />
                <div v-else class="w-5 h-5" /> <!-- Placeholder for alignment -->

                <span class="font-mono text-sm" :class="row.original.isGroup === 0 ? 'text-primary-600 dark:text-primary-400' : 'text-blue-600 dark:text-blue-400'">{{
                  row.original.projectCode.split('/').pop()
                }}</span>
              </div>
            </template>

            <template #name-cell="{ row }">
              <div>
                <div class="flex items-center gap-1.5 font-medium">
                  <span>{{ row.original.description || row.original.name }}</span>
                  <UBadge
                    v-if="row.original.isTemplate"
                    color="primary"
                    variant="subtle"
                    size="xs"
                  >
                    模板
                  </UBadge>
                </div>
                <div v-if="row.original.description" class="text-xs text-gray-500 truncate max-w-48">
                  {{ row.original.name }}
                </div>
              </div>
            </template>

            <template #deptCode-cell="{ row }">
              <span>{{ getDeptName(row.original.deptCode) }}</span>
            </template>

            <template #leaderUid-cell="{ row }">
              <span>{{ getLeaderName(row.original.leaderUid) }}</span>
            </template>

            <template #members-cell="{ row }">
              <UButton variant="link" size="sm" @click="openMembersModal(row.original)">
                {{ getMembersPreview(row.original) }}人
              </UButton>
            </template>

            <template #createdAt-cell="{ row }">
              <span class="text-sm">{{ formatDate(row.original.createdAt) }}</span>
            </template>

            <template #status-cell="{ row }">
              <UBadge :color="statusLabels[row.original.status]?.color || 'neutral'" variant="subtle" size="sm">
                {{ statusLabels[row.original.status]?.label || '未知' }}
              </UBadge>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex items-center gap-1">
                <UButton
                  size="xs"
                  color="primary"
                  variant="ghost"
                  icon="i-lucide-edit"
                  @click="openEditModal(row.original)"
                >
                  编辑
                </UButton>
                <UDropdownMenu
                  :id="`actions-${row.original.projectCode.replace(/\//g, '-')}`"
                  :items="[
                    ...(row.original.isGroup === 0 ? [[{
                      label: row.original.isTemplate ? '取消模板' : '设为模板',
                      icon: row.original.isTemplate ? 'i-lucide-bookmark-minus' : 'i-lucide-bookmark-plus',
                      onSelect: () => toggleTemplate(row.original)
                    }]] : []),
                    ...(row.original.isGroup === 1 && row.original.children?.some((c: Project) => c.isGroup === 0) ? [[{
                      label: '批量设为模板',
                      icon: 'i-lucide-bookmark-plus',
                      onSelect: () => batchSetTemplate(row.original, true)
                    }, {
                      label: '批量取消模板',
                      icon: 'i-lucide-bookmark-minus',
                      onSelect: () => batchSetTemplate(row.original, false)
                    }]] : []),
                    [{
                      label: '删除',
                      icon: 'i-lucide-trash-2',
                      color: 'error' as const,
                      onSelect: () => deleteProject(row.original)
                    }]
                  ]"
                >
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-ellipsis"
                  />
                </UDropdownMenu>
              </div>
            </template>
          </UTable>

          <div
            v-if="!loading && projects.length > 0"
            class="px-4 py-2 text-center text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800"
          >
            共 {{ projectCount }} 个项目
          </div>
        </UCard>
      </div>
    </UDashboardPanel>

    <!-- Create/Edit Modal -->
    <UModal
      v-model:open="isModalOpen"
      :title="modalMode === 'create' ? '新建项目' : '编辑项目'"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #body>
        <div class="space-y-2 p-2">
          <!-- 项目ID (only for create) -->
          <UFormField
            v-if="modalMode === 'create'"
            label="项目标识"
            required
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <div v-if="formState.parentId" class="mb-2 text-sm text-gray-500">
              父项目: <UBadge color="neutral" variant="soft">
                {{ formState.parentId }}
              </UBadge>
            </div>
            <UInput
              v-model="formState.projectCode"
              placeholder="小写字母、数字 and 连字符 (如: proj-abc)"
              class="w-full"
            />
          </UFormField>

          <!-- 项目名称 -->
          <UFormField
            label="项目名称"
            required
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UInput
              v-model="formState.description"
              placeholder="请输入项目名称"
              class="w-full"
            />
          </UFormField>

          <!-- 所属部门 -->
          <UFormField
            label="所属部门"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USelectMenu
              v-model="formState.deptCode"
              :items="formDeptOptions"
              value-key="value"
              label-key="label"
              placeholder="选择部门"
              size="md"
              class="w-full"
              searchable
            />
          </UFormField>

          <!-- 项目负责人 -->
          <UFormField
            label="项目负责人"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USelectMenu
              v-model="formState.leaderUid"
              :items="leaderOptions"
              :filter-fields="['label', 'uid']"
              value-key="value"
              label-key="label"
              placeholder="选择负责人"
              size="md"
              class="w-full"
              searchable
            >
              <template #item-label="{ item }">
                {{ item.label }}
                <span v-if="item.uid" class="text-muted">({{ item.uid }})</span>
              </template>
            </USelectMenu>
          </UFormField>

          <!-- 项目周期 -->

          <UFormField
            label="开始时间"
            class="flex-1"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UInput v-model="formState.startDate" type="date" class="w-full" />
          </UFormField>
          <UFormField
            label="结束时间"
            class="flex-1"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UInput v-model="formState.endDate" type="date" class="w-full" />
          </UFormField>

          <!-- 仓库地址 -->
          <UFormField
            label="仓库地址"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UInput v-model="formState.repoUrl" placeholder="Git 仓库 URL" class="w-full" />
          </UFormField>

          <!-- 项目描述 (Alternative for name if name is read-only) -->
          <UFormField
            label="项目详细描述"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UTextarea
              v-model="formState.description"
              placeholder="项目描述"
              class="w-full"
              :rows="3"
            />
          </UFormField>

          <!-- 状态 (only for edit) -->
          <UFormField
            v-if="modalMode === 'edit'"
            label="状态"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <div class="flex items-center gap-2">
              <USwitch
                :model-value="formState.status === 1"
                @update:model-value="formState.status = $event ? 1 : 0"
              />
              <span class="text-sm">{{ formState.status === 1 ? '启用' : '禁用' }}</span>
            </div>
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
            :label="modalMode === 'create' ? '创建项目' : '保存修改'"
            color="primary"
            :loading="saving"
            @click="saveProject"
          />
        </div>
      </template>
    </UModal>

    <!-- Members Modal (Read-only) -->
    <UModal
      v-model:open="isMembersModalOpen"
      :title="`项目成员 - ${membersModalProject?.name || ''}`"
      :ui="{ content: 'sm:max-w-2xl' }"
    >
      <template #body>
        <div class="p-2 space-y-4">
          <div v-if="membersLoading" class="py-8 text-center text-sm text-gray-500">
            加载中...
          </div>
          <div v-else-if="selectedMemberUids.length === 0" class="py-8 text-center text-sm text-gray-500">
            暂无成员
          </div>
          <div v-else>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
              共 {{ selectedMemberUids.length }} 人：
            </p>
            <div class="grid grid-cols-2 gap-2">
              <div
                v-for="uid in selectedMemberUids"
                :key="uid"
                class="flex items-center gap-2 p-2 rounded bg-gray-50 dark:bg-gray-800"
              >
                <UIcon name="i-lucide-user" class="text-gray-400" />
                <span class="text-sm">{{ getUserName(uid) || uid }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end pt-1">
          <UButton label="关闭" color="neutral" @click="isMembersModalOpen = false" />
        </div>
      </template>
    </UModal>

    <!-- Fork Create Project Modal -->
    <UModal
      v-model:open="isForkModalOpen"
      title="创建项目"
      :ui="{ content: 'sm:max-w-xl' }"
    >
      <template #body>
        <div class="space-y-2 p-2">
          <UFormField
            label="目标群组"
            required
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USelectMenu
              v-model="forkForm.targetNamespace"
              :items="groupOptions"
              value-key="value"
              label-key="label"
              placeholder="选择目标群组"
              size="md"
              class="w-full"
              searchable
            />
          </UFormField>

          <UFormField
            label="项目标识"
            required
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UInput
              v-model="forkForm.projectPath"
              placeholder="小写字母、数字 and 连字符 (如: my-project)"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="项目名称"
            required
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <UInput
              v-model="forkForm.projectName"
              placeholder="请输入项目显示名称"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="项目经理"
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USelectMenu
              v-model="forkForm.leaderUid"
              :items="leaderOptions"
              :filter-fields="['label', 'uid']"
              value-key="value"
              label-key="label"
              placeholder="选择项目经理"
              size="md"
              class="w-full"
              searchable
            >
              <template #item-label="{ item }">
                {{ item.label }}
                <span v-if="item.uid" class="text-muted">({{ item.uid }})</span>
              </template>
            </USelectMenu>
          </UFormField>

          <UFormField
            label="所属部门"
            required
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USelectMenu
              v-model="forkForm.deptCode"
              :items="formDeptOptions"
              value-key="value"
              label-key="label"
              placeholder="选择部门"
              size="md"
              class="w-full"
              searchable
            />
          </UFormField>

          <UFormField
            label="项目模板"
            required
            :ui="{
              root: 'flex items-center justify-between',
              wrapper: 'flex-1',
              container: 'flex-1 mt-0'
            }"
          >
            <USelectMenu
              v-model="forkForm.templateProjectCode"
              :items="templateOptions"
              value-key="value"
              label-key="label"
              placeholder="选择模板项目"
              size="md"
              class="w-full"
              searchable
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 pt-1">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="isForkModalOpen = false"
          />
          <UButton
            label="创建项目"
            color="primary"
            icon="i-lucide-git-fork"
            :loading="forkSaving"
            @click="forkCreateProject"
          />
        </div>
      </template>
    </UModal>

    <!-- Sync Confirm Modal -->
    <UModal v-model:open="showSyncConfirm" title="确认同步">
      <template #body>
        <div class="p-2">
          <p class="text-sm text-gray-700 dark:text-gray-300">
            确定要从 GitLab 同步项目吗？
          </p>
          <p class="text-sm text-gray-500 mt-2">
            这将创建新项目并更新现有项目信息（包括群组、项目、成员等）。
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-3 pt-1">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="showSyncConfirm = false"
          />
          <UButton
            label="确认同步"
            color="success"
            :loading="syncing"
            @click="syncFromGitLab"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
