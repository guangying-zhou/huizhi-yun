<script setup lang="ts">
import {
  methodologyOptions,
  projectCategoryConfig,
  projectCategoryOptions,
  projectSecurityLevelConfig,
  projectSecurityLevelOptions,
  projectStatusConfig,
  projectStatusOptions
} from '~/config/project'
import type { LifecycleStatus, Methodology, ProjectCategory, ProjectSecurityLevel } from '~/types/aims'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目管理',
  layoutHeaderProjectSwitcher: false
})

type ProjectCounts = {
  members: number
  repos: number
  milestones: number
  workItems: number
  requirements: number
  documents: number
  deliverables: number
  approvals: number
}

interface AdminProject {
  id: number
  projectCode: string
  name: string
  shortName: string
  internalCode: string | null
  description: string | null
  category: ProjectCategory
  methodology: Methodology
  lifecycleStatus: LifecycleStatus
  portfolioId: number | null
  portfolioName: string | null
  domainCode: string | null
  deptCode: string | null
  leaderUid: string | null
  securityLevel: ProjectSecurityLevel
  accessWhitelist: string[]
  startDate: string | null
  endDate: string | null
  customerName: string | null
  contractCode: string | null
  templateSetName: string | null
  templateVersionLabel: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  counts: ProjectCounts
}

type RawAdminProject = Partial<AdminProject> & {
  project_code?: string
  short_name?: string | null
  internal_code?: string | null
  lifecycle_status?: LifecycleStatus
  portfolio_id?: number | null
  portfolio_name?: string | null
  domain_code?: string | null
  dept_code?: string | null
  leader_uid?: string | null
  security_level?: ProjectSecurityLevel
  access_whitelist?: string[] | string | null
  start_date?: string | null
  end_date?: string | null
  customer_name?: string | null
  contract_code?: string | null
  template_set_name?: string | null
  template_version_label?: string | null
  created_by?: string
  created_at?: string
  updated_at?: string
  member_count?: number
  repo_count?: number
  milestone_count?: number
  work_item_count?: number
  requirement_count?: number
  document_count?: number
  deliverable_count?: number
  approval_count?: number
}

interface AdminProjectsResponse {
  code: number
  data: {
    items: RawAdminProject[]
    total: number
    page: number
    pageSize: number
  }
}

type EditProjectForm = {
  projectCode: string
  name: string
  shortName: string
  internalCode: string
  description: string
  category: ProjectCategory
  methodology: Methodology
  lifecycleStatus: LifecycleStatus
  portfolioId: number | null
  domainCode: string
  deptCode: string
  leaderUid: string | null
  securityLevel: ProjectSecurityLevel
  accessWhitelist: string[]
  startDate: string
  endDate: string
  customerName: string
  contractCode: string
}

const toast = useToast()
const portfolioStore = usePortfolioStore()
const { users: accountUsers } = useAccountUsers()
const { domains: businessDomains } = useBusinessDomains()

const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const projects = ref<AdminProject[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const categoryFilter = ref<'all' | ProjectCategory>('all')
const statusFilter = ref<'all' | LifecycleStatus>('active')
const portfolioFilter = ref<'all' | number | 0>('all')

const editModalOpen = ref(false)
const deleteModalOpen = ref(false)
const editingProject = ref<AdminProject | null>(null)
const deletingProject = ref<AdminProject | null>(null)
const deleteConfirmText = ref('')

const editForm = ref<EditProjectForm>({
  projectCode: '',
  name: '',
  shortName: '',
  internalCode: '',
  description: '',
  category: 'product_dev',
  methodology: 'PIVR',
  lifecycleStatus: 'draft',
  portfolioId: null,
  domainCode: '',
  deptCode: '',
  leaderUid: null,
  securityLevel: 'company',
  accessWhitelist: [],
  startDate: '',
  endDate: '',
  customerName: '',
  contractCode: ''
})

const statusSummary = computed(() => {
  const summary: Record<string, number> = {}
  for (const item of projects.value) {
    summary[item.lifecycleStatus] = (summary[item.lifecycleStatus] || 0) + 1
  }
  return summary
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const portfolioOptions = computed(() => [
  { label: '全部项目集', value: 'all' },
  { label: '未分组项目', value: 0 },
  ...portfolioStore.portfolios.map(item => ({
    label: item.name,
    value: item.id
  }))
])

const editPortfolioOptions = computed(() => [
  { label: '未分组项目', value: 0 },
  ...portfolioStore.portfolios.map(item => ({
    label: item.name,
    value: item.id
  }))
])

const userOptions = computed(() => {
  const seen = new Set<string>()
  return accountUsers.value
    .filter((user) => {
      if (seen.has(user.uid)) return false
      seen.add(user.uid)
      return true
    })
    .map(user => ({
      label: user.realName?.trim() || user.uid,
      uid: user.realName?.trim() && user.realName !== user.uid ? user.uid : undefined,
      value: user.uid
    }))
})

const userMap = computed(() => {
  const map = new Map<string, typeof accountUsers.value[number]>()
  for (const user of accountUsers.value) {
    if (!map.has(user.uid)) map.set(user.uid, user)
  }
  return map
})

const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const user of accountUsers.value) {
    map.set(user.uid, user.realName?.trim() || user.uid)
  }
  return map
})

const domainOptions = computed(() => businessDomains.value.map(domain => ({
  label: domain.domainName,
  value: domain.domainCode
})))

const editablePortfolioValue = computed({
  get: () => editForm.value.portfolioId ?? 0,
  set: (value: number | string) => {
    const id = Number(value)
    editForm.value.portfolioId = id > 0 ? id : null
  }
})
const editAccessWhitelist = computed({
  get: () => editForm.value.accessWhitelist || [],
  set: (value: string[]) => {
    editForm.value.accessWhitelist = value
  }
})

const canConfirmDelete = computed(() => {
  const project = deletingProject.value
  if (!project) return false
  const text = deleteConfirmText.value.trim()
  return text === project.projectCode || text === project.name
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '-'
  return userNameMap.value.get(uid) || uid
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return value.slice(0, 10)
}

function formatProjectRange(project: AdminProject) {
  return `${formatDate(project.startDate)} ~ ${formatDate(project.endDate)}`
}

function getProjectCategoryLabel(category: ProjectCategory) {
  return projectCategoryConfig[category]?.label || category
}

function getProjectSecurityConfig(level: ProjectSecurityLevel | null | undefined) {
  return projectSecurityLevelConfig[level || 'company']
}

function countTotal(counts: ProjectCounts) {
  return Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0)
}

function parseStringArray(value: unknown) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean)
  }
}

function normalizeAdminProject(raw: RawAdminProject): AdminProject {
  const counts = raw.counts || {
    members: Number(raw.member_count || 0),
    repos: Number(raw.repo_count || 0),
    milestones: Number(raw.milestone_count || 0),
    workItems: Number(raw.work_item_count || 0),
    requirements: Number(raw.requirement_count || 0),
    documents: Number(raw.document_count || 0),
    deliverables: Number(raw.deliverable_count || 0),
    approvals: Number(raw.approval_count || 0)
  }

  return {
    id: Number(raw.id || 0),
    projectCode: raw.projectCode ?? raw.project_code ?? '',
    name: raw.name ?? '',
    shortName: raw.shortName ?? raw.short_name ?? raw.name ?? '',
    internalCode: raw.internalCode ?? raw.internal_code ?? null,
    description: raw.description ?? null,
    category: raw.category ?? 'custom_dev',
    methodology: raw.methodology ?? 'PIVR',
    lifecycleStatus: raw.lifecycleStatus ?? raw.lifecycle_status ?? 'draft',
    portfolioId: raw.portfolioId ?? raw.portfolio_id ?? null,
    portfolioName: raw.portfolioName ?? raw.portfolio_name ?? null,
    domainCode: raw.domainCode ?? raw.domain_code ?? null,
    deptCode: raw.deptCode ?? raw.dept_code ?? null,
    leaderUid: raw.leaderUid ?? raw.leader_uid ?? null,
    securityLevel: raw.securityLevel ?? raw.security_level ?? 'company',
    accessWhitelist: parseStringArray(raw.accessWhitelist ?? raw.access_whitelist),
    startDate: raw.startDate ?? raw.start_date ?? null,
    endDate: raw.endDate ?? raw.end_date ?? null,
    customerName: raw.customerName ?? raw.customer_name ?? null,
    contractCode: raw.contractCode ?? raw.contract_code ?? null,
    templateSetName: raw.templateSetName ?? raw.template_set_name ?? null,
    templateVersionLabel: raw.templateVersionLabel ?? raw.template_version_label ?? null,
    createdBy: raw.createdBy ?? raw.created_by ?? '',
    createdAt: raw.createdAt ?? raw.created_at ?? '',
    updatedAt: raw.updatedAt ?? raw.updated_at ?? '',
    counts
  }
}

async function loadProjects() {
  loading.value = true
  try {
    const params: Record<string, string | number | undefined> = {
      page: page.value,
      pageSize: pageSize.value,
      search: search.value || undefined
    }
    if (categoryFilter.value !== 'all') params.category = categoryFilter.value
    if (statusFilter.value !== 'all') params.lifecycleStatus = statusFilter.value
    if (portfolioFilter.value !== 'all') params.portfolioId = portfolioFilter.value

    const res = await $fetch<AdminProjectsResponse>('/api/v1/admin/projects', {
      params
    })
    if (res.code === 0) {
      projects.value = (Array.isArray(res.data.items) ? res.data.items : []).map(normalizeAdminProject)
      total.value = res.data.total
      page.value = res.data.page
      pageSize.value = res.data.pageSize
    }
  } finally {
    loading.value = false
  }
}

function resetAndLoad() {
  page.value = 1
  loadProjects()
}

function normalizeProjectCode(value: unknown) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function onProjectCodeInput(value: string | number | null | undefined) {
  editForm.value.projectCode = normalizeProjectCode(value)
}

function openEdit(project: AdminProject) {
  editingProject.value = project
  editForm.value = {
    projectCode: normalizeProjectCode(project.projectCode),
    name: project.name,
    shortName: project.shortName,
    internalCode: project.internalCode || '',
    description: project.description || '',
    category: project.category,
    methodology: project.methodology,
    lifecycleStatus: project.lifecycleStatus,
    portfolioId: project.portfolioId,
    domainCode: project.domainCode || '',
    deptCode: project.deptCode || '',
    leaderUid: project.leaderUid,
    securityLevel: project.securityLevel || 'company',
    accessWhitelist: project.accessWhitelist || [],
    startDate: formatDate(project.startDate) === '-' ? '' : formatDate(project.startDate),
    endDate: formatDate(project.endDate) === '-' ? '' : formatDate(project.endDate),
    customerName: project.customerName || '',
    contractCode: project.contractCode || ''
  }
  editModalOpen.value = true
}

function onLeaderChange(uid: string | null) {
  editForm.value.leaderUid = uid
  if (!uid) return
  const user = userMap.value.get(uid)
  if (user?.deptCode) {
    editForm.value.deptCode = user.deptCode
  }
}

async function saveProject() {
  if (!editingProject.value) return

  const normalizedProjectCode = normalizeProjectCode(editForm.value.projectCode)
  if (!normalizedProjectCode) {
    toast.add({ title: '项目编号仅支持字母和数字', color: 'warning' })
    return
  }
  editForm.value.projectCode = normalizedProjectCode

  saving.value = true
  try {
    await $fetch(`/api/v1/admin/projects/${editingProject.value.id}`, {
      method: 'PATCH',
      body: {
        projectCode: normalizedProjectCode,
        name: editForm.value.name,
        shortName: editForm.value.shortName,
        internalCode: editForm.value.internalCode,
        description: editForm.value.description,
        category: editForm.value.category,
        methodology: editForm.value.methodology,
        lifecycleStatus: editForm.value.lifecycleStatus,
        portfolioId: editForm.value.portfolioId,
        domainCode: editForm.value.domainCode,
        deptCode: editForm.value.deptCode,
        leaderUid: editForm.value.leaderUid,
        securityLevel: editForm.value.securityLevel,
        accessWhitelist: editForm.value.accessWhitelist,
        startDate: editForm.value.startDate,
        endDate: editForm.value.endDate,
        customerName: editForm.value.customerName,
        contractCode: editForm.value.contractCode
      }
    })
    toast.add({ title: '项目已更新', color: 'success' })
    editModalOpen.value = false
    await loadProjects()
  } finally {
    saving.value = false
  }
}

function openDelete(project: AdminProject) {
  deletingProject.value = project
  deleteConfirmText.value = ''
  deleteModalOpen.value = true
}

async function deleteProject() {
  if (!deletingProject.value || !canConfirmDelete.value) return

  deleting.value = true
  try {
    await $fetch(`/api/v1/admin/projects/${deletingProject.value.id}`, {
      method: 'DELETE',
      body: { confirmText: deleteConfirmText.value.trim() }
    })
    toast.add({ title: '项目已彻底删除', color: 'success' })
    deleteModalOpen.value = false
    deletingProject.value = null
    await loadProjects()
  } finally {
    deleting.value = false
  }
}

watch([categoryFilter, statusFilter, portfolioFilter], resetAndLoad)

onMounted(async () => {
  portfolioStore.fetchPortfolios().catch(() => {})
  await loadProjects()
})
</script>

<template>
  <UDashboardPanel id="admin-projects" :ui="{ body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex min-h-0 flex-1 flex-col">
        <div class=" px-6 py-1">
          <!-- <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div class="text-xs font-semibold tracking-[0.28em] text-primary uppercase">
                Project Administration
              </div>
              <h1 class="mt-1 text-2xl font-bold text-highlighted">
                项目管理
              </h1>
              <p class="mt-1 text-sm text-muted">
                系统管理员维护项目基础信息、生命周期阶段，并在必要时彻底删除项目及关联数据。
              </p>
            </div>
            <UButton
              icon="i-lucide-refresh-cw"
              label="刷新"
              color="neutral"
              variant="ghost"
              :loading="loading"
              @click="loadProjects"
            />
          </div> -->

          <div class="mt-1 grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_180px_220px_auto]">
            <UInput
              v-model="search"
              icon="i-lucide-search"
              placeholder="搜索项目名称 / 编码 / 负责人"
              @keydown.enter="resetAndLoad"
            />
            <USelect
              v-model="categoryFilter"
              :items="[{ label: '全部分类', value: 'all' }, ...projectCategoryOptions]"
            />
            <USelect
              v-model="statusFilter"
              :items="[{ label: '全部阶段', value: 'all' }, ...projectStatusOptions]"
            />
            <USelect
              v-model="portfolioFilter"
              :items="portfolioOptions"
            />
            <UButton
              icon="i-lucide-search"
              label="查询"
              color="primary"
              @click="resetAndLoad"
            />
          </div>
        </div>

        <div class="grid gap-3 border-b border-default px-6 py-4 md:grid-cols-4">
          <div class="rounded-lg border border-default bg-muted/30 px-4 py-3">
            <div class="text-xs text-muted">
              项目总数
            </div>
            <div class="mt-1 text-xl font-semibold text-highlighted">
              {{ total }}
            </div>
          </div>
          <div class="rounded-lg border border-default bg-muted/30 px-4 py-3">
            <div class="text-xs text-muted">
              当前页进行中
            </div>
            <div class="mt-1 text-xl font-semibold text-highlighted">
              {{ statusSummary.active || 0 }}
            </div>
          </div>
          <div class="rounded-lg border border-default bg-muted/30 px-4 py-3">
            <div class="text-xs text-muted">
              当前页待立项
            </div>
            <div class="mt-1 text-xl font-semibold text-highlighted">
              {{ statusSummary.approval_pending || 0 }}
            </div>
          </div>
          <div class="rounded-lg border border-default bg-muted/30 px-4 py-3">
            <div class="text-xs text-muted">
              当前页已归档
            </div>
            <div class="mt-1 text-xl font-semibold text-highlighted">
              {{ statusSummary.archived || 0 }}
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-6 py-4">
          <div class="overflow-hidden rounded-lg border border-default">
            <table class="w-full table-fixed text-sm">
              <thead class="bg-muted/50 text-left text-xs text-muted">
                <tr>
                  <th class="w-[24%] px-4 py-3 font-medium">
                    项目
                  </th>
                  <th class="w-[10%] px-4 py-3 font-medium">
                    分类
                  </th>
                  <th class="w-[11%] px-4 py-3 font-medium">
                    生命周期
                  </th>
                  <th class="w-[12%] px-4 py-3 font-medium">
                    负责人
                  </th>
                  <th class="w-[12%] px-4 py-3 font-medium">
                    可见范围
                  </th>
                  <th class="w-[13%] px-4 py-3 font-medium">
                    周期
                  </th>
                  <th class="w-[13%] px-4 py-3 font-medium">
                    关联项
                  </th>
                  <th class="w-[12%] px-4 py-3 text-right font-medium">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-if="loading">
                  <td colspan="8" class="px-4 py-12 text-center text-muted">
                    正在加载项目...
                  </td>
                </tr>
                <tr v-else-if="projects.length === 0">
                  <td colspan="8" class="px-4 py-12 text-center text-muted">
                    当前筛选条件下没有项目。
                  </td>
                </tr>
                <template v-else>
                  <tr
                    v-for="project in projects"
                    :key="project.id"
                    class="hover:bg-muted/40"
                  >
                    <td class="px-4 py-3 align-top">
                      <div class="min-w-0">
                        <div class="truncate font-medium text-highlighted">
                          {{ project.name }}
                        </div>
                        <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <span class="font-mono">#{{ project.projectCode }}</span>
                          <span>{{ project.shortName }}</span>
                          <span v-if="project.portfolioName">/ {{ project.portfolioName }}</span>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-3 align-top">
                      <UBadge color="info" variant="subtle" size="xs">
                        {{ getProjectCategoryLabel(project.category) }}
                      </UBadge>
                    </td>
                    <td class="px-4 py-3 align-top">
                      <UBadge
                        :color="(projectStatusConfig[project.lifecycleStatus]?.color || 'neutral') as any"
                        variant="subtle"
                        size="xs"
                      >
                        {{ projectStatusConfig[project.lifecycleStatus]?.label || project.lifecycleStatus }}
                      </UBadge>
                    </td>
                    <td class="px-4 py-3 align-top text-muted">
                      <div class="truncate">
                        {{ getUserName(project.leaderUid) }}
                      </div>
                      <div class="mt-1 truncate text-xs">
                        {{ project.deptCode || '-' }}
                      </div>
                    </td>
                    <td class="px-4 py-3 align-top">
                      <UBadge
                        :color="(getProjectSecurityConfig(project.securityLevel).color as any)"
                        variant="subtle"
                        size="xs"
                        :icon="getProjectSecurityConfig(project.securityLevel).icon"
                      >
                        {{ getProjectSecurityConfig(project.securityLevel).label }}
                      </UBadge>
                    </td>
                    <td class="px-4 py-3 align-top text-xs text-muted">
                      {{ formatProjectRange(project) }}
                    </td>
                    <td class="px-4 py-3 align-top text-xs text-muted">
                      <div class="flex flex-wrap gap-x-3 gap-y-1">
                        <span>成员 {{ project.counts.members }}</span>
                        <span>里程碑 {{ project.counts.milestones }}</span>
                        <span>工作项 {{ project.counts.workItems }}</span>
                        <span>需求 {{ project.counts.requirements }}</span>
                      </div>
                    </td>
                    <td class="px-4 py-3 align-top">
                      <div class="flex justify-end gap-1">
                        <UButton
                          icon="i-lucide-external-link"
                          color="neutral"
                          variant="ghost"
                          size="xs"
                          :to="`/projects/${project.id}`"
                          title="进入项目"
                        />
                        <UButton
                          icon="i-lucide-pencil"
                          color="neutral"
                          variant="ghost"
                          size="xs"
                          title="编辑项目"
                          @click="openEdit(project)"
                        />
                        <UButton
                          icon="i-lucide-trash-2"
                          color="error"
                          variant="ghost"
                          size="xs"
                          title="彻底删除"
                          @click="openDelete(project)"
                        />
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div class="mt-4 flex items-center justify-between text-sm text-muted">
            <div>
              第 {{ page }} / {{ totalPages }} 页，共 {{ total }} 个项目
            </div>
            <div class="flex items-center gap-2">
              <UButton
                label="上一页"
                color="neutral"
                variant="soft"
                size="sm"
                :disabled="page <= 1 || loading"
                @click="page--; loadProjects()"
              />
              <UButton
                label="下一页"
                color="neutral"
                variant="soft"
                size="sm"
                :disabled="page >= totalPages || loading"
                @click="page++; loadProjects()"
              />
            </div>
          </div>
        </div>

        <UModal v-model:open="editModalOpen" :ui="{ content: 'sm:max-w-3xl' }">
          <template #header>
            <div>
              <h3 class="text-lg font-semibold text-highlighted">
                编辑项目
              </h3>
              <p class="mt-1 text-xs text-muted">
                {{ editingProject?.projectCode }} · 可在此修改项目编号。
              </p>
            </div>
          </template>
          <template #body>
            <div class="grid gap-4 md:grid-cols-2">
              <UFormField label="项目编号" required>
                <UInput
                  v-model="editForm.projectCode"
                  class="w-full"
                  placeholder="仅支持字母和数字"
                  @update:model-value="onProjectCodeInput"
                />
              </UFormField>
              <UFormField label="项目名称" required>
                <UInput v-model="editForm.name" class="w-full" />
              </UFormField>
              <UFormField label="项目简称" required>
                <UInput v-model="editForm.shortName" class="w-full" />
              </UFormField>
              <UFormField label="内部代号">
                <UInput v-model="editForm.internalCode" class="w-full" />
              </UFormField>
              <UFormField label="生命周期阶段">
                <USelect
                  v-model="editForm.lifecycleStatus"
                  :items="projectStatusOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="项目分类">
                <USelect
                  v-model="editForm.category"
                  :items="projectCategoryOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="管理方法">
                <USelect
                  v-model="editForm.methodology"
                  :items="methodologyOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="所属项目集">
                <USelect
                  v-model="editablePortfolioValue"
                  :items="editPortfolioOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="负责人">
                <USelectMenu
                  :model-value="editForm.leaderUid ?? undefined"
                  :items="userOptions"
                  :filter-fields="['label', 'uid']"
                  value-key="value"
                  label-key="label"
                  placeholder="选择负责人"
                  class="w-full"
                  searchable
                  @update:model-value="onLeaderChange"
                >
                  <template #item-label="{ item }">
                    {{ item.label }}
                    <span v-if="item.uid" class="text-xs text-muted">({{ item.uid }})</span>
                  </template>
                </USelectMenu>
              </UFormField>
              <UFormField label="所属部门">
                <UInput v-model="editForm.deptCode" class="w-full" />
              </UFormField>
              <UFormField label="可见范围">
                <USelect
                  v-model="editForm.securityLevel"
                  :items="projectSecurityLevelOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="业务领域">
                <USelectMenu
                  v-model="editForm.domainCode"
                  :items="domainOptions"
                  value-key="value"
                  label-key="label"
                  placeholder="选择业务领域"
                  class="w-full"
                  searchable
                />
              </UFormField>
              <UFormField
                v-if="editForm.securityLevel === 'whitelist'"
                label="白名单"
                class="md:col-span-2"
              >
                <UserTreeSelector
                  v-model="editAccessWhitelist"
                  placeholder="选择白名单用户"
                  width-class="w-full"
                />
              </UFormField>
              <UFormField label="计划开始">
                <UInput v-model="editForm.startDate" type="date" class="w-full" />
              </UFormField>
              <UFormField label="计划结束">
                <UInput v-model="editForm.endDate" type="date" class="w-full" />
              </UFormField>
              <UFormField label="客户名称">
                <UInput v-model="editForm.customerName" class="w-full" />
              </UFormField>
              <UFormField label="合同编号">
                <UInput v-model="editForm.contractCode" class="w-full" />
              </UFormField>
              <UFormField label="项目描述" class="md:col-span-2">
                <UTextarea v-model="editForm.description" class="w-full" :rows="4" />
              </UFormField>
            </div>
          </template>
          <template #footer>
            <div class="flex w-full justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="editModalOpen = false"
              />
              <UButton
                label="保存"
                color="primary"
                :loading="saving"
                @click="saveProject"
              />
            </div>
          </template>
        </UModal>

        <UModal v-model:open="deleteModalOpen" :ui="{ content: 'sm:max-w-xl' }">
          <template #header>
            <div>
              <h3 class="text-lg font-semibold text-error">
                彻底删除项目
              </h3>
              <p class="mt-1 text-xs text-muted">
                此操作会删除项目及其关联项，不能恢复。
              </p>
            </div>
          </template>
          <template #body>
            <div v-if="deletingProject" class="space-y-4">
              <div class="rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-sm">
                <div class="font-medium text-highlighted">
                  {{ deletingProject.name }}
                </div>
                <div class="mt-1 font-mono text-xs text-muted">
                  #{{ deletingProject.projectCode }}
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2 text-sm">
                <div class="rounded-md bg-muted/40 px-3 py-2">
                  成员 {{ deletingProject.counts.members }}
                </div>
                <div class="rounded-md bg-muted/40 px-3 py-2">
                  里程碑 {{ deletingProject.counts.milestones }}
                </div>
                <div class="rounded-md bg-muted/40 px-3 py-2">
                  工作项 {{ deletingProject.counts.workItems }}
                </div>
                <div class="rounded-md bg-muted/40 px-3 py-2">
                  需求 {{ deletingProject.counts.requirements }}
                </div>
                <div class="rounded-md bg-muted/40 px-3 py-2">
                  文档 {{ deletingProject.counts.documents }}
                </div>
                <div class="rounded-md bg-muted/40 px-3 py-2">
                  审核 {{ deletingProject.counts.approvals }}
                </div>
              </div>

              <UFormField
                :label="`输入项目编码 ${deletingProject.projectCode} 或项目名称确认`"
                required
              >
                <UInput
                  v-model="deleteConfirmText"
                  class="w-full"
                  placeholder="确认删除"
                />
              </UFormField>

              <p class="text-xs text-muted">
                当前列表统计到 {{ countTotal(deletingProject.counts) }} 条直接关联记录。后端会在事务中继续清理工作项评论、附件、工时、需求版本等子表。
              </p>
            </div>
          </template>
          <template #footer>
            <div class="flex w-full justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="deleteModalOpen = false"
              />
              <UButton
                label="彻底删除"
                color="error"
                :disabled="!canConfirmDelete"
                :loading="deleting"
                @click="deleteProject"
              />
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
