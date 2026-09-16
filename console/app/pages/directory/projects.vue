<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('项目注册表')

interface DirectoryProject {
  id: number
  projectCode: string
  parentId: string | null
  name: string
  deptCode: string | null
  ownerUid?: string | null
  leaderUid: string | null
  description: string | null
  status: number
  statusKey?: string
  repoUrl: string | null
  isGroup: number
  isTemplate: number
  subProjects: DirectoryProject[]
}

interface DirectoryProjectMember {
  id: number
  projectCode: string
  uid: string
  role: string
  status: string
  displayName: string
  realName: string | null
  email: string | null
  mobileTail4: string | null
  primaryDeptCode: string | null
  deptName: string | null
  joinedAt: string
}

interface DirectoryProjectsResponse {
  items: DirectoryProject[]
  flat: DirectoryProject[]
  total: number
}

interface DirectoryProjectMembersResponse {
  items: DirectoryProjectMember[]
  total: number
}

interface ApiResponse<T> {
  code: number
  data: T
}

const { search, debounced: debouncedSearch, flush: flushSearch, reset: resetSearch } = useDebouncedSearch()
const deptCode = ref('')
const leaderUid = ref('')
const status = ref('active')
const typeFilter = ref('all')
const { page, pageSize, resetFilters: resetListFilters } = useListPage({
  pageSize: 20,
  filters: { search, deptCode, leaderUid, status, typeFilter },
  defaults: { search: '', deptCode: '', leaderUid: '', status: 'active', typeFilter: 'all' }
})
const selectedProject = ref<DirectoryProject | null>(null)
const members = ref<DirectoryProjectMember[]>([])
const membersPending = ref(false)
const membersError = ref('')
const membersSaving = ref(false)
const editableMembersText = ref('')
const isMembersModalOpen = ref(false)
const projectModalOpen = ref(false)
const projectModalMode = ref<'create' | 'edit'>('create')
const savingProject = ref(false)
const toast = useToast()
const { confirm } = useConfirm()

const projectForm = reactive({
  projectCode: '',
  name: '',
  parentProjectCode: '',
  projectType: 'project',
  deptCode: '',
  ownerUid: '',
  leaderUid: '',
  repoUrl: '',
  description: '',
  status: 'active'
})

const query = computed(() => ({
  page: page.value,
  pageSize,
  search: debouncedSearch.value || undefined,
  deptCode: deptCode.value || undefined,
  leaderUid: leaderUid.value || undefined,
  status: status.value,
  onlyGroup: typeFilter.value === 'group' ? '1' : undefined,
  includeTemplate: typeFilter.value === 'template' || typeFilter.value === 'all' ? '1' : '0'
}))

const { data, pending, error, refresh } = await useFetch<ApiResponse<DirectoryProjectsResponse>>('/api/v1/console/directory/projects', {
  query,
  default: () => ({ code: 0, data: { items: [], flat: [], total: 0 } })
})
const errorAlert = useApiErrorAlert(error, {
  appName: 'Console',
  fallbackTitle: '项目注册表加载失败'
})

const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => {
  setRefresh(refresh)
})
onBeforeUnmount(clearRefresh)

const { data: departmentData } = await useFetch<ApiResponse<{ flat: Array<{ deptCode: string, name: string, level: number, orgType: string }> }>>(
  '/api/v1/console/directory/departments',
  {
    default: () => ({ code: 0, data: { flat: [] } })
  }
)

const projects = computed(() => data.value?.data.flat || [])
const visibleProjects = computed(() => projects.value)
const total = computed(() => data.value?.data.total || 0)
const groupCount = computed(() => projects.value.filter(project => project.isGroup).length)
const templateCount = computed(() => projects.value.filter(project => project.isTemplate).length)
const rootCount = computed(() => projects.value.filter(project => !project.parentId).length)
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const ULink = resolveComponent('ULink')

const statusOptions = [
  { label: '正常', value: 'active' },
  { label: '归档', value: 'archived' },
  { label: '停用', value: 'inactive' },
  { label: '已删除', value: 'deleted' },
  { label: '全部', value: 'all' }
]
const formStatusOptions = statusOptions.filter(item => item.value !== 'all')

const typeOptions = [
  { label: '全部', value: 'all' },
  { label: '项目组', value: 'group' },
  { label: '不含模板', value: 'project' },
  { label: '含模板', value: 'template' }
]
const projectTypeOptions = [
  { label: '项目', value: 'project' },
  { label: '项目组', value: 'group' },
  { label: '模板', value: 'template' }
]
const parentProjectOptions = computed(() => [
  { label: '无父级', value: '' },
  ...projects.value
    .filter(project => projectModalMode.value === 'create' || project.projectCode !== projectForm.projectCode)
    .map(project => ({
      label: project.name,
      value: project.projectCode
    }))
])
const departmentOptions = computed(() => [
  { label: '未关联部门', value: '' },
  ...(departmentData.value?.data.flat || [])
    .filter(dept => dept.orgType === 'department')
    .map(dept => ({
      label: `${'  '.repeat(Math.max(0, dept.level - 1))}${dept.name}`,
      value: dept.deptCode
    }))
])

function resetFilters() {
  resetSearch()
  resetListFilters()
}

function statusMeta(statusValue: number, statusKey?: string) {
  if (statusValue === 1) return { label: '正常', color: 'success' as const }
  if (statusValue === -1) return { label: '已删除', color: 'error' as const }
  if (statusKey === 'archived') return { label: '归档', color: 'neutral' as const }
  return { label: '停用', color: 'neutral' as const }
}

function projectType(project: DirectoryProject) {
  if (project.isTemplate) return '模板'
  if (project.isGroup) return '项目组'
  return '项目'
}

const projectColumns: TableColumn<DirectoryProject>[] = [
  {
    accessorKey: 'name',
    header: '项目',
    cell: ({ row }) => h('div', { class: 'flex items-center gap-2' }, [
      h(resolveComponent('UIcon'), {
        name: row.original.isGroup ? 'i-lucide-folder-tree' : 'i-lucide-folder-kanban',
        class: 'size-4 shrink-0 text-muted'
      }),
      h('div', [
        h('div', { class: 'flex items-center gap-1.5' }, [
          h('p', { class: 'font-medium text-highlighted' }, row.original.name),
          row.original.isTemplate
            ? h(UBadge, { color: 'primary', variant: 'subtle', size: 'xs' }, () => '模板')
            : null
        ]),
        h('p', { class: 'text-xs text-muted' }, row.original.projectCode)
      ])
    ])
  },
  {
    accessorKey: 'type',
    header: '类型',
    cell: ({ row }) => h(UBadge, { color: 'neutral', variant: 'soft' }, () => projectType(row.original))
  },
  { accessorKey: 'parentId', header: '父级', cell: ({ row }) => row.original.parentId || '-' },
  { accessorKey: 'deptCode', header: '部门', cell: ({ row }) => row.original.deptCode || '-' },
  { accessorKey: 'leaderUid', header: '负责人', cell: ({ row }) => row.original.leaderUid || row.original.ownerUid || '-' },
  {
    accessorKey: 'repoUrl',
    header: '仓库',
    cell: ({ row }) => row.original.repoUrl
      ? h(ULink, { to: row.original.repoUrl, target: '_blank', class: 'text-primary hover:underline' }, () => '打开')
      : '-'
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => {
      const meta = statusMeta(row.original.status, row.original.statusKey)
      return h(UBadge, { color: meta.color, variant: 'soft' }, () => meta.label)
    }
  },
  {
    id: 'members',
    header: '成员',
    cell: ({ row }) => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      size: 'xs',
      icon: 'i-lucide-users',
      onClick: () => loadMembers(row.original)
    }, () => '查看')
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => h('div', { class: 'flex justify-end gap-1' }, [
      h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        size: 'xs',
        icon: 'i-lucide-pencil',
        onClick: () => openEditProject(row.original)
      }, () => '编辑'),
      h(UButton, {
        color: 'error',
        variant: 'ghost',
        size: 'xs',
        icon: 'i-lucide-trash-2',
        onClick: () => deleteProject(row.original)
      }, () => '删除')
    ])
  }
]

const memberColumns: TableColumn<DirectoryProjectMember>[] = [
  {
    accessorKey: 'uid',
    header: '成员',
    cell: ({ row }) => h('div', [
      h('p', { class: 'font-medium text-highlighted' }, row.original.displayName),
      h('p', { class: 'text-xs text-muted' }, row.original.uid)
    ])
  },
  {
    accessorKey: 'role',
    header: '角色',
    cell: ({ row }) => h(UBadge, { color: 'neutral', variant: 'soft' }, () => row.original.role)
  },
  { accessorKey: 'deptName', header: '主部门', cell: ({ row }) => row.original.deptName || row.original.primaryDeptCode || '-' },
  { accessorKey: 'email', header: '邮箱', cell: ({ row }) => row.original.email || '-' },
  { accessorKey: 'joinedAt', header: '加入时间', cell: ({ row }) => row.original.joinedAt || '-' }
]

async function loadMembers(project: DirectoryProject) {
  selectedProject.value = project
  isMembersModalOpen.value = true
  members.value = []
  membersError.value = ''
  membersPending.value = true
  try {
    const response = await $fetch<ApiResponse<DirectoryProjectMembersResponse>>('/api/v1/console/directory/projects/members', {
      query: {
        projectCode: project.projectCode,
        status: 'active'
      }
    })
    members.value = response.data.items
    editableMembersText.value = members.value
      .map(member => `${member.uid}:${member.role || 'member'}`)
      .join('\n')
  } catch (error) {
    membersError.value = error instanceof Error ? error.message : '加载项目成员失败'
  } finally {
    membersPending.value = false
  }
}

function resetProjectForm() {
  projectForm.projectCode = ''
  projectForm.name = ''
  projectForm.parentProjectCode = ''
  projectForm.projectType = 'project'
  projectForm.deptCode = ''
  projectForm.ownerUid = ''
  projectForm.leaderUid = ''
  projectForm.repoUrl = ''
  projectForm.description = ''
  projectForm.status = 'active'
}

function getProjectType(project: DirectoryProject) {
  if (project.isTemplate) return 'template'
  if (project.isGroup) return 'group'
  return 'project'
}

function getProjectStatus(project: DirectoryProject) {
  if (project.statusKey) return project.statusKey
  if (project.status === 1) return 'active'
  if (project.status === -1) return 'deleted'
  return 'inactive'
}

function openCreateProject() {
  resetProjectForm()
  projectModalMode.value = 'create'
  projectModalOpen.value = true
}

function openEditProject(project: DirectoryProject) {
  resetProjectForm()
  projectModalMode.value = 'edit'
  projectForm.projectCode = project.projectCode
  projectForm.name = project.name
  projectForm.parentProjectCode = project.parentId || ''
  projectForm.projectType = getProjectType(project)
  projectForm.deptCode = project.deptCode || ''
  projectForm.ownerUid = project.ownerUid || ''
  projectForm.leaderUid = project.leaderUid || ''
  projectForm.repoUrl = project.repoUrl || ''
  projectForm.description = project.description || ''
  projectForm.status = getProjectStatus(project)
  projectModalOpen.value = true
}

function projectPayload() {
  return {
    projectCode: projectForm.projectCode.trim(),
    name: projectForm.name.trim(),
    parentProjectCode: projectForm.parentProjectCode || null,
    projectType: projectForm.projectType,
    deptCode: projectForm.deptCode || null,
    ownerUid: projectForm.ownerUid.trim() || null,
    leaderUid: projectForm.leaderUid.trim() || null,
    repoUrl: projectForm.repoUrl.trim() || null,
    description: projectForm.description.trim() || null,
    status: projectForm.status
  }
}

async function submitProject() {
  if (!projectForm.projectCode.trim() || !projectForm.name.trim()) {
    toast.add({ title: '项目编码和名称不能为空', color: 'warning' })
    return
  }

  savingProject.value = true
  try {
    const payload = projectPayload()
    if (projectModalMode.value === 'create') {
      await $fetch('/api/v1/console/directory/projects', {
        method: 'POST',
        headers: { 'idempotency-key': `directory:project:create:${globalThis.crypto?.randomUUID?.() || Date.now()}` },
        body: payload
      })
    } else {
      await $fetch(`/api/v1/console/directory/projects/${encodeURIComponent(projectForm.projectCode)}` as string, {
        method: 'PATCH',
        headers: { 'idempotency-key': `directory:project:update:${projectForm.projectCode}:${globalThis.crypto?.randomUUID?.() || Date.now()}` },
        body: payload
      })
    }
    toast.add({ title: projectModalMode.value === 'create' ? '项目已创建' : '项目已保存', color: 'success' })
    projectModalOpen.value = false
    await refresh()
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存失败'
    toast.add({ title: '保存失败', description: message, color: 'error' })
  } finally {
    savingProject.value = false
  }
}

async function deleteProject(project: DirectoryProject) {
  if (!(await confirm({
    title: '删除项目',
    message: `确认删除项目「${project.name}」？删除后不可恢复。`,
    tone: 'danger'
  }))) return

  try {
    await $fetch(`/api/v1/console/directory/projects/${encodeURIComponent(project.projectCode)}` as string, {
      method: 'DELETE',
      headers: { 'idempotency-key': `directory:project:delete:${project.projectCode}:${globalThis.crypto?.randomUUID?.() || Date.now()}` }
    })
    toast.add({ title: '项目已删除', color: 'success' })
    await refresh()
  } catch (error) {
    const message = error instanceof Error ? error.message : '删除失败'
    toast.add({ title: '删除失败', description: message, color: 'error' })
  }
}

function parseEditableMembers() {
  return editableMembersText.value
    .split(/\r?\n|,/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [uid, role] = line.split(':').map(part => part?.trim())
      return {
        uid,
        role: role || 'member'
      }
    })
}

async function saveMembers() {
  if (!selectedProject.value) return

  membersSaving.value = true
  membersError.value = ''
  try {
    const response = await $fetch<ApiResponse<DirectoryProjectMembersResponse>>('/api/v1/console/directory/projects/members', {
      method: 'POST',
      headers: { 'idempotency-key': `directory:project:members:${selectedProject.value.projectCode}:${globalThis.crypto?.randomUUID?.() || Date.now()}` },
      body: {
        projectCode: selectedProject.value.projectCode,
        members: parseEditableMembers()
      }
    })
    members.value = response.data.items
    editableMembersText.value = members.value
      .map(member => `${member.uid}:${member.role || 'member'}`)
      .join('\n')
    toast.add({ title: '项目成员已保存', color: 'success' })
  } catch (error) {
    membersError.value = error instanceof Error ? error.message : '保存项目成员失败'
  } finally {
    membersSaving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="directory-projects" :ui="dashboardPanelUi">
    <!-- <template #header>
      <UDashboardNavbar title="项目注册表">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="pending"
            @click="refresh()"
          >
            刷新
          </UButton>
        </template>
      </UDashboardNavbar>
    </template> -->

    <template #body>
      <div class="grid gap-3 md:grid-cols-4">
        <UCard>
          <p class="text-xs text-muted">
            注册项目
          </p>
          <p class="mt-1 text-2xl font-semibold">
            {{ total }}
          </p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted">
            当前页项目组
          </p>
          <p class="mt-1 text-2xl font-semibold">
            {{ groupCount }}
          </p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted">
            当前页模板
          </p>
          <p class="mt-1 text-2xl font-semibold">
            {{ templateCount }}
          </p>
        </UCard>
        <UCard>
          <p class="text-xs text-muted">
            当前页根节点
          </p>
          <p class="mt-1 text-2xl font-semibold">
            {{ rootCount }}
          </p>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div class="flex flex-col gap-2">
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <UInput
                  v-model="search"
                  icon="i-lucide-search"
                  placeholder="搜索项目编码 / 名称"
                  @keyup.enter="flushSearch"
                />
                <UInput
                  v-model="deptCode"
                  placeholder="部门编码"
                />
                <UInput
                  v-model="leaderUid"
                  placeholder="负责人 UID"
                />
                <USelect
                  v-model="status"
                  :items="statusOptions"
                />
                <USelect
                  v-model="typeFilter"
                  :items="typeOptions"
                />
              </div>
              <div class="flex justify-end gap-2">
                <UButton
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-rotate-ccw"
                  @click="resetFilters"
                >
                  重置
                </UButton>
                <UButton
                  color="primary"
                  icon="i-lucide-plus"
                  @click="openCreateProject"
                >
                  新建项目
                </UButton>
              </div>
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

        <UTable
          sticky
          :data="visibleProjects"
          :columns="projectColumns"
          :loading="pending"
          empty="暂无项目"
          class="flex-1 max-h-[calc(100svh-24rem)] rounded-lg border border-default"
        >
          <template #empty>
            <CommonEmptyState
              icon="i-lucide-folder-kanban"
              title="暂无项目注册"
              description="调整筛选条件，或新建一个项目注册。"
            />
          </template>
        </UTable>

        <div
          v-if="total > 0"
          class="mt-4 flex items-center justify-between border-t border-default pt-4"
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
        v-model:open="projectModalOpen"
        :title="projectModalMode === 'create' ? '新建项目注册' : '编辑项目注册'"
        :ui="{ content: 'max-w-3xl', footer: 'flex justify-end gap-2' }"
      >
        <template #body>
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="项目编码" required>
              <UInput
                v-model="projectForm.projectCode"
                class="w-full"
                :disabled="projectModalMode === 'edit'"
                placeholder="例如：platform/workflow"
              />
            </UFormField>

            <UFormField label="项目名称" required>
              <UInput
                v-model="projectForm.name"
                class="w-full"
                placeholder="项目显示名称"
              />
            </UFormField>

            <UFormField label="父级项目">
              <USelect
                v-model="projectForm.parentProjectCode"
                class="w-full"
                :items="parentProjectOptions"
              />
            </UFormField>

            <UFormField label="项目类型">
              <USelect
                v-model="projectForm.projectType"
                class="w-full"
                :items="projectTypeOptions"
              />
            </UFormField>

            <UFormField label="关联部门">
              <USelect
                v-model="projectForm.deptCode"
                class="w-full"
                :items="departmentOptions"
              />
            </UFormField>

            <UFormField label="状态">
              <USelect
                v-model="projectForm.status"
                class="w-full"
                :items="formStatusOptions"
              />
            </UFormField>

            <UFormField label="Owner UID">
              <UInput
                v-model="projectForm.ownerUid"
                class="w-full"
                placeholder="留空表示未设置"
              />
            </UFormField>

            <UFormField label="负责人 UID">
              <UInput
                v-model="projectForm.leaderUid"
                class="w-full"
                placeholder="留空表示未设置"
              />
            </UFormField>

            <UFormField
              label="仓库地址"
              class="md:col-span-2"
            >
              <UInput
                v-model="projectForm.repoUrl"
                class="w-full"
                placeholder="https://gitlab.example.com/group/project"
              />
            </UFormField>

            <UFormField
              label="说明"
              class="md:col-span-2"
            >
              <UTextarea
                v-model="projectForm.description"
                class="w-full"
                :rows="3"
                placeholder="项目注册说明"
              />
            </UFormField>
          </div>
        </template>

        <template #footer>
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="savingProject"
            @click="projectModalOpen = false"
          >
            取消
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-save"
            :loading="savingProject"
            @click="submitProject"
          >
            保存
          </UButton>
        </template>
      </UModal>

      <UModal
        v-model:open="isMembersModalOpen"
        :title="`项目成员：${selectedProject?.name || ''}`"
        :ui="{ content: 'sm:max-w-4xl' }"
      >
        <template #body>
          <div class="space-y-3">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p class="text-sm text-muted">
                  {{ selectedProject?.projectCode }}，维护 `directory_project_members`。
                </p>
              </div>
              <UBadge color="neutral" variant="soft">
                {{ members.length }} 人
              </UBadge>
            </div>

            <UFormField label="成员">
              <UTextarea
                v-model="editableMembersText"
                class="w-full"
                :rows="5"
                placeholder="每行一个：uid 或 uid:role，role 可为 owner/admin/member/viewer"
              />
            </UFormField>

            <UAlert
              v-if="membersError"
              color="error"
              variant="soft"
              title="成员加载失败"
              :description="membersError"
            />

            <UTable
              sticky
              :data="members"
              :columns="memberColumns"
              :loading="membersPending"
              empty="暂无成员"
              class="flex-1 max-h-[calc(100svh-28rem)] rounded-lg border border-default"
            />
          </div>
        </template>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="关闭"
              color="neutral"
              variant="soft"
              :disabled="membersSaving"
              @click="isMembersModalOpen = false"
            />
            <UButton
              color="primary"
              icon="i-lucide-save"
              :loading="membersSaving"
              @click="saveMembers"
            >
              保存成员
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
