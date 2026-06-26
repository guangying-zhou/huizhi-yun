<script setup lang="ts">
import { pinyin } from 'pinyin-pro'
import { projectSecurityLevelConfig, projectStatusConfig } from '~/config/project'
import type {
  AimsProject,
  CreatePortfolioRequest,
  ProjectPortfolio,
  ProjectCategory,
  LifecycleStatus,
  UpdatePortfolioRequest
} from '~/types/aims'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目总览',
  layoutHeaderProjectSwitcher: false
})

const projectStore = useProjectStore()
const portfolioStore = usePortfolioStore()
const toast = useToast()
const { enterProject } = useProjectContext()
const { user: authUser } = useAuth()
const { loaded: permissionsLoaded, loadPermissions, hasRole, hasPermission } = usePermissions()
const canManagePortfolios = computed(() => hasRole('aims:admin'))
const canCreateProjects = computed(() => hasPermission('projects', 'admin'))

// Account 用户列表（用于负责人选择）
const { users: accountUsers } = useAccountUsers()
const { tree: gitGroupTree } = useAccountGitGroups()

// 业务领域字典
const { domains: businessDomains } = useBusinessDomains()

// 业务领域分类单选
const domainCategoryItems = [
  { label: '政务', value: '2G' },
  { label: '企业', value: '2B' },
  { label: '个人', value: '2C' }
]

// 项目集弹窗的领域分类
const portfolioDomainCategory = ref<'2G' | '2B' | '2C'>('2G')
const editPortfolioDomainCategory = ref<'2G' | '2B' | '2C'>('2G')

// 按分类过滤的领域子级选项
function getDomainOptionsByCategory(category: '2G' | '2B' | '2C') {
  return businessDomains.value
    .filter(d => d.category === category && d.parentCode !== null)
    .map(d => ({ label: d.domainName, value: d.domainCode }))
}

const portfolioDomainOptions = computed(() => getDomainOptionsByCategory(portfolioDomainCategory.value))
const editPortfolioDomainOptions = computed(() => getDomainOptionsByCategory(editPortfolioDomainCategory.value))

// 切换分类时清空已选的领域
watch(portfolioDomainCategory, () => {
  portfolioForm.value.domainCode = ''
})
watch(editPortfolioDomainCategory, () => {
  editPortfolioForm.value.domainCode = ''
})

// 用户选项（可搜索下拉）
const userOptions = computed(() => {
  const seen = new Set<string>()
  return accountUsers.value
    .filter((u) => {
      if (seen.has(u.uid)) return false
      seen.add(u.uid)
      return true
    })
    .map(u => ({
      label: u.realName?.trim() || u.uid,
      uid: u.realName?.trim() && u.realName !== u.uid ? u.uid : undefined,
      value: u.uid
    }))
})

// uid → 用户名映射
const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const u of accountUsers.value) {
    map.set(u.uid, u.realName?.trim() || u.uid)
  }
  return map
})

// uid → 用户对象映射（用于自动获取部门）
const userMap = computed(() => {
  const map = new Map<string, typeof accountUsers.value[0]>()
  for (const u of accountUsers.value) {
    if (!map.has(u.uid)) map.set(u.uid, u)
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '-'
  return userNameMap.value.get(uid) || uid
}

function getDomainCategoryByCode(domainCode: string | null | undefined): '2G' | '2B' | '2C' {
  if (!domainCode) return '2G'
  return businessDomains.value.find(d => d.domainCode === domainCode)?.category || '2G'
}

// 选择项目集负责人时自动填充部门
function onPortfolioOwnerChange(uid: string | null) {
  portfolioForm.value.ownerUid = uid
  if (uid) {
    const user = userMap.value.get(uid)
    if (user?.deptCode) {
      portfolioForm.value.deptCode = user.deptCode
    }
  }
}

function onEditPortfolioOwnerChange(uid: string | null) {
  editPortfolioForm.value.ownerUid = uid
  if (uid) {
    const user = userMap.value.get(uid)
    if (user?.deptCode) {
      editPortfolioForm.value.deptCode = user.deptCode
    }
  }
}

// 视图切换
const viewMode = ref<'card' | 'list'>('card')

// 筛选
const filterCategory = ref<string>('all')
const filterStatus = ref<string>('all')
const filterPortfolio = ref<string>('all')
const filterMyProjects = ref(true)
const searchText = ref('')

// 弹窗
const showCreatePortfolioModal = ref(false)
const showEditPortfolioModal = ref(false)
const showDeletePortfolioConfirm = ref(false)
const showAssignPortfolioModal = ref(false)
const showUnauthorizedProjectModal = ref(false)
const creatingPortfolio = ref(false)
const updatingPortfolio = ref(false)
const editingPortfolio = ref<ProjectPortfolio | null>(null)
const assigningProject = ref<AimsProject | null>(null)
const unauthorizedProject = ref<AimsProject | null>(null)
const assignPortfolioId = ref<number | null>(null)

const categoryLabel: Record<string, string> = {
  product_dev: '产品研发',
  custom_dev: '定制开发',
  delivery: '交付实施',
  maintenance: '运维保障',
  sales: '销售',
  presales: '售前',
  improvement: '改进',
  compliance: '合规'
}

const statusLabel = Object.fromEntries(
  Object.entries(projectStatusConfig).map(([k, v]) => [k, v.label])
)

const statusColor = Object.fromEntries(
  Object.entries(projectStatusConfig).map(([k, v]) => [k, v.color])
)

const categoryOptions = [
  { label: '产品研发', value: 'product_dev' },
  { label: '定制开发', value: 'custom_dev' },
  { label: '交付实施', value: 'delivery' },
  { label: '运维保障', value: 'maintenance' },
  { label: '销售', value: 'sales' },
  { label: '售前', value: 'presales' },
  { label: '改进', value: 'improvement' },
  { label: '合规', value: 'compliance' }
]

function openCreateProjectInPortfolio(portfolio: ProjectPortfolio) {
  if (!canCreateProjects.value) {
    toast.add({ title: '需要 AIMS 项目管理权限才可以创建项目', color: 'warning' })
    return
  }
  navigateTo(`/projects/new?portfolioId=${portfolio.id}`)
}

// 新建项目集表单
const portfolioForm = ref<CreatePortfolioRequest>({
  code: '',
  name: '',
  description: '',
  domainCode: '',
  ownerUid: '',
  deptCode: '',
  gitGroup: '',
  isProductLine: false
})
const portfolioCodeManuallyEdited = ref(false)
const projectOverviewPageSize = 500

function generatePortfolioCode(name: string): string {
  const initials = pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' })
    .map(s => s.replace(/[^a-zA-Z]/g, '').toUpperCase())
    .filter(Boolean)
    .join('')
  return initials ? `C-${initials}` : ''
}

function onPortfolioNameInput(name: string) {
  portfolioForm.value.name = name
  if (!portfolioCodeManuallyEdited.value) {
    portfolioForm.value.code = generatePortfolioCode(name)
  }
}

function onPortfolioCodeInput(value: string) {
  portfolioCodeManuallyEdited.value = true
  const upper = value.toUpperCase()
  // 保护 "C-" 前缀不被删除
  portfolioForm.value.code = upper.startsWith('C-') ? upper : `C-${upper.replace(/^C-?/i, '')}`
}

const editPortfolioForm = ref<UpdatePortfolioRequest>({
  name: '',
  description: '',
  domainCode: '',
  ownerUid: '',
  deptCode: '',
  gitGroup: '',
  isProductLine: false
})

const currentEditingPortfolio = computed(() => {
  if (!editingPortfolio.value) return null
  return portfolioStore.portfolios.find(pf => pf.id === editingPortfolio.value?.id) || editingPortfolio.value
})

const canDeleteEditingPortfolio = computed(() => Number(currentEditingPortfolio.value?.projectCount ?? 0) === 0)

function buildProjectListQuery() {
  return {
    category: (filterCategory.value !== 'all' ? filterCategory.value : undefined) as ProjectCategory | undefined,
    lifecycleStatus: (filterStatus.value !== 'all' ? filterStatus.value : undefined) as LifecycleStatus | undefined,
    portfolioId: filterPortfolio.value !== 'all' ? Number(filterPortfolio.value) : undefined,
    search: searchText.value || undefined,
    pageSize: projectOverviewPageSize
  }
}

// 加载数据
async function loadData() {
  await Promise.all([
    projectStore.fetchProjects(buildProjectListQuery()),
    portfolioStore.fetchPortfolios()
  ])
}

onMounted(async () => {
  if (!permissionsLoaded.value) {
    await loadPermissions()
  }
  loadData()
})

watch([filterCategory, filterStatus, filterPortfolio, searchText], () => {
  projectStore.fetchProjects(buildProjectListQuery())
})

// ---- 计算属性：按项目集分组 ----

interface PortfolioGroup {
  portfolio: ProjectPortfolio | null
  projects: AimsProject[]
}

const visibleProjects = computed(() => {
  return projectStore.projects.filter((project) => {
    if (project.lifecycleStatus === 'archived') return false
    if (filterMyProjects.value && !project.currentUserRole) return false
    return true
  })
})

const groupedProjects = computed<PortfolioGroup[]>(() => {
  const portfolioMap = new Map<number, AimsProject[]>()
  const ungrouped: AimsProject[] = []

  for (const p of visibleProjects.value) {
    if (p.portfolioId) {
      const list = portfolioMap.get(p.portfolioId) || []
      list.push(p)
      portfolioMap.set(p.portfolioId, list)
    } else {
      ungrouped.push(p)
    }
  }

  const groups: PortfolioGroup[] = []
  const emptyGroups: PortfolioGroup[] = []

  // 有匹配项目的项目集优先展示；当前筛选下为空的项目集放到列表末尾。
  for (const pf of portfolioStore.portfolios) {
    const projects = portfolioMap.get(pf.id) || []
    const group = { portfolio: pf, projects }
    if (projects.length > 0) {
      groups.push(group)
    } else {
      emptyGroups.push(group)
    }
  }

  // 独立项目
  if (ungrouped.length > 0) {
    groups.push({ portfolio: null, projects: ungrouped })
  }

  return [...groups, ...emptyGroups]
})

// 列表树形数据
interface TreeRow {
  id: string
  name: string
  isPortfolio: boolean
  project?: AimsProject
  portfolio?: ProjectPortfolio
  category?: string
  lifecycleStatus?: string
  leaderUid?: string | null
  securityLevel?: string
  startDate?: string | null
  endDate?: string | null
  projectCount?: number
  children?: TreeRow[]
}

const treeData = computed<TreeRow[]>(() => {
  const rows: TreeRow[] = []

  for (const group of groupedProjects.value) {
    if (group.portfolio) {
      rows.push({
        id: `pf-${group.portfolio.id}`,
        name: group.portfolio.name,
        isPortfolio: true,
        portfolio: group.portfolio,
        projectCount: group.projects.length,
        children: group.projects.map(p => ({
          id: `p-${p.id}`,
          name: p.name,
          isPortfolio: false,
          project: p,
          category: p.category,
          lifecycleStatus: p.lifecycleStatus,
          leaderUid: p.leaderUid,
          securityLevel: p.securityLevel,
          startDate: p.startDate,
          endDate: p.endDate
        }))
      })
    } else {
      for (const p of group.projects) {
        rows.push({
          id: `p-${p.id}`,
          name: p.name,
          isPortfolio: false,
          project: p,
          category: p.category,
          lifecycleStatus: p.lifecycleStatus,
          leaderUid: p.leaderUid,
          securityLevel: p.securityLevel,
          startDate: p.startDate,
          endDate: p.endDate
        })
      }
    }
  }

  return rows
})

// 树形展开状态
const expandedPortfolios = ref<Set<number>>(new Set())
const autoCollapsedEmptyPortfolios = ref<Set<number>>(new Set())
const initializedPortfolioExpansions = ref<Set<number>>(new Set())
const manuallyCollapsedPortfolios = ref<Set<number>>(new Set())

function toggleExpand(portfolioId: number) {
  autoCollapsedEmptyPortfolios.value.delete(portfolioId)

  if (expandedPortfolios.value.has(portfolioId)) {
    expandedPortfolios.value.delete(portfolioId)
    manuallyCollapsedPortfolios.value.add(portfolioId)
  } else {
    expandedPortfolios.value.add(portfolioId)
    manuallyCollapsedPortfolios.value.delete(portfolioId)
  }
}

// 默认展开非空项目集；空项目集自动折叠
watch(groupedProjects, (groups) => {
  const nextExpanded = new Set(expandedPortfolios.value)
  const nextAutoCollapsed = new Set(autoCollapsedEmptyPortfolios.value)
  const nextInitialized = new Set(initializedPortfolioExpansions.value)
  const nextManualCollapsed = new Set(manuallyCollapsedPortfolios.value)
  const visiblePortfolioIds = new Set<number>()

  for (const group of groups) {
    if (!group.portfolio) continue

    const portfolioId = group.portfolio.id
    visiblePortfolioIds.add(portfolioId)

    if (group.projects.length === 0) {
      nextExpanded.delete(portfolioId)
      nextAutoCollapsed.add(portfolioId)
      continue
    }

    const shouldAutoExpand = !nextInitialized.has(portfolioId) || (nextAutoCollapsed.has(portfolioId) && !nextManualCollapsed.has(portfolioId))
    if (shouldAutoExpand) {
      nextExpanded.add(portfolioId)
    }

    nextAutoCollapsed.delete(portfolioId)
    nextInitialized.add(portfolioId)
  }

  for (const portfolioId of Array.from(nextExpanded)) {
    if (!visiblePortfolioIds.has(portfolioId)) {
      nextExpanded.delete(portfolioId)
    }
  }

  for (const portfolioId of Array.from(nextAutoCollapsed)) {
    if (!visiblePortfolioIds.has(portfolioId)) {
      nextAutoCollapsed.delete(portfolioId)
    }
  }

  for (const portfolioId of Array.from(nextInitialized)) {
    if (!visiblePortfolioIds.has(portfolioId)) {
      nextInitialized.delete(portfolioId)
    }
  }

  for (const portfolioId of Array.from(nextManualCollapsed)) {
    if (!visiblePortfolioIds.has(portfolioId)) {
      nextManualCollapsed.delete(portfolioId)
    }
  }

  expandedPortfolios.value = nextExpanded
  autoCollapsedEmptyPortfolios.value = nextAutoCollapsed
  initializedPortfolioExpansions.value = nextInitialized
  manuallyCollapsedPortfolios.value = nextManualCollapsed
}, { immediate: true })

// ---- 操作 ----

async function handleCreatePortfolio() {
  if (!canManagePortfolios.value) {
    toast.add({ title: '仅 AIMS 管理员可以创建项目集', color: 'warning' })
    return
  }
  creatingPortfolio.value = true
  try {
    await portfolioStore.createPortfolio(portfolioForm.value)
    showCreatePortfolioModal.value = false
    portfolioForm.value = { code: '', name: '', description: '', domainCode: '', ownerUid: '', deptCode: '', gitGroup: '', isProductLine: false }
    portfolioCodeManuallyEdited.value = false
    // 刷新项目列表以获取最新 portfolioId 映射
    await loadData()
  } finally {
    creatingPortfolio.value = false
  }
}

function openEditPortfolio(portfolio: ProjectPortfolio) {
  if (!canManagePortfolios.value) {
    toast.add({ title: '仅 AIMS 管理员可以修改项目集', color: 'warning' })
    return
  }
  const latestPortfolio = portfolioStore.portfolios.find(pf => pf.id === portfolio.id) || portfolio
  editingPortfolio.value = latestPortfolio
  editPortfolioDomainCategory.value = getDomainCategoryByCode(latestPortfolio.domainCode)
  editPortfolioForm.value = {
    name: latestPortfolio.name,
    description: latestPortfolio.description || '',
    domainCode: latestPortfolio.domainCode || '',
    ownerUid: latestPortfolio.ownerUid || '',
    deptCode: latestPortfolio.deptCode || '',
    gitGroup: latestPortfolio.gitGroup || '',
    isProductLine: latestPortfolio.isProductLine
  }
  showEditPortfolioModal.value = true
}

async function handleUpdatePortfolio() {
  if (!editingPortfolio.value) return
  if (!canManagePortfolios.value) {
    toast.add({ title: '仅 AIMS 管理员可以修改项目集', color: 'warning' })
    return
  }
  updatingPortfolio.value = true
  try {
    await portfolioStore.updatePortfolio(editingPortfolio.value.id, editPortfolioForm.value)
    showEditPortfolioModal.value = false
    editingPortfolio.value = null
    await loadData()
  } finally {
    updatingPortfolio.value = false
  }
}

async function handleDeletePortfolio() {
  if (!editingPortfolio.value) return
  if (!canManagePortfolios.value) {
    toast.add({ title: '仅 AIMS 管理员可以删除项目集', color: 'warning' })
    return
  }
  updatingPortfolio.value = true
  try {
    await portfolioStore.deletePortfolio(editingPortfolio.value.id)
    showDeletePortfolioConfirm.value = false
    showEditPortfolioModal.value = false
    editingPortfolio.value = null
    await loadData()
  } finally {
    updatingPortfolio.value = false
  }
}

function openAssignPortfolio(project: AimsProject) {
  assigningProject.value = project
  assignPortfolioId.value = project.portfolioId
  showAssignPortfolioModal.value = true
}

function isProjectAccessible(project: AimsProject | null | undefined) {
  return project?.canAccess !== false
}

function canManageProject(project: AimsProject | null | undefined) {
  return project?.currentUserRole === 'manager'
}

function isCurrentUserProjectLeader(project: AimsProject | null | undefined) {
  return Boolean(authUser.value && project?.leaderUid === authUser.value)
}

function getProjectManagerName(project: AimsProject | null | undefined) {
  const managerUid = project?.leaderUid || project?.createdBy
  return managerUid ? getUserName(managerUid) : '项目经理'
}

function getProjectSecurityConfig(project: AimsProject | null | undefined) {
  return projectSecurityLevelConfig[project?.securityLevel || 'company']
}

function handleOpenProject(project: AimsProject) {
  if (!isProjectAccessible(project)) {
    unauthorizedProject.value = project
    showUnauthorizedProjectModal.value = true
    return
  }

  enterProject(project.id)
}

async function handleAssignPortfolio() {
  if (!assigningProject.value) return
  await projectStore.updateProject(assigningProject.value.id, {
    portfolioId: assignPortfolioId.value
  })
  showAssignPortfolioModal.value = false
  assigningProject.value = null
  await loadData()
}

function formatDate(date: string | null) {
  if (!date) return '-'
  return date.slice(0, 10)
}

function getPortfolioProjectCount(portfolio: ProjectPortfolio | null | undefined, visibleProjects: AimsProject[] = []) {
  if (!portfolio) return visibleProjects.length
  return visibleProjects.length
}

// 状态筛选选项
const statusFilterOptions = computed(() => {
  const opts = [{ label: '全部状态', value: 'all' }]
  for (const [value, cfg] of Object.entries(projectStatusConfig)) {
    if (value === 'archived') continue
    opts.push({ label: cfg.label, value })
  }
  return opts
})

// 分类筛选选项
const categoryFilterOptions = computed(() => {
  const opts = [{ label: '全部分类', value: 'all' }]
  for (const opt of categoryOptions) {
    opts.push(opt)
  }
  return opts
})

// 项目集筛选选项
const portfolioFilterOptions = computed(() => {
  const opts = [{ label: '全部项目集', value: 'all' }]
  for (const pf of portfolioStore.portfolios) {
    opts.push({ label: pf.isProductLine ? `${pf.name} · 产品线` : pf.name, value: String(pf.id) })
  }
  opts.push({ label: '未分组', value: '0' })
  return opts
})

// 项目集选择选项（用于分配弹窗）
const portfolioAssignOptions = computed(() => {
  const opts: { label: string, value: number | null }[] = [
    { label: '不归属任何项目集', value: null }
  ]
  for (const pf of portfolioStore.portfolios) {
    opts.push({ label: pf.isProductLine ? `${pf.name} · 产品线` : pf.name, value: pf.id })
  }
  return opts
})
</script>

<template>
  <Teleport to="#aims-layout-header-actions">
    <UButton
      v-if="canManagePortfolios"
      icon="i-lucide-folder-plus"
      label="新建项目集"
      color="neutral"
      variant="outline"
      @click="showCreatePortfolioModal = true"
    />
    <UButton
      v-if="canCreateProjects"
      icon="i-lucide-plus"
      label="新建项目"
      color="primary"
      @click="navigateTo('/projects/new')"
    />
  </Teleport>
  <UDashboardPanel
    id="projects"
    :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }"
  >
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <div class="shrink-0 border-b border-default bg-default/95 px-6 pt-0 pb-4 backdrop-blur supports-backdrop-filter:bg-default/80">
          <div class="space-y-4">
            <!-- ========== 筛选栏 ========== -->
            <div class="flex flex-wrap items-center gap-3">
              <UInput
                v-model="searchText"
                icon="i-lucide-search"
                placeholder="搜索项目..."
                class="w-64"
              />
              <USelect
                v-model="filterPortfolio"
                :items="portfolioFilterOptions"
                value-key="value"
                class="w-40"
              />
              <USelect
                v-model="filterStatus"
                :items="statusFilterOptions"
                value-key="value"
                class="w-36"
              />
              <USelect
                v-model="filterCategory"
                :items="categoryFilterOptions"
                value-key="value"
                class="w-36"
              />
              <UCheckbox
                v-model="filterMyProjects"
                label="我的项目"
                class="text-sm"
              />

              <div class="ml-auto flex items-center gap-2">
                <span class="text-xs text-muted uppercase tracking-wider">视图</span>
                <UButton
                  icon="i-lucide-grip"
                  :color="viewMode === 'card' ? 'primary' : 'neutral'"
                  variant="ghost"
                  size="sm"
                  @click="viewMode = 'card'"
                />
                <UButton
                  icon="i-lucide-list"
                  :color="viewMode === 'list' ? 'primary' : 'neutral'"
                  variant="ghost"
                  size="sm"
                  @click="viewMode = 'list'"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-12">
          <!-- 加载中 -->
          <div
            v-if="projectStore.loading"
            class="flex justify-center py-16"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="w-8 h-8 animate-spin text-muted"
            />
          </div>

          <!-- 空状态 -->
          <div
            v-else-if="visibleProjects.length === 0 && portfolioStore.portfolios.length === 0"
            class="py-16 text-center"
          >
            <UIcon
              name="i-lucide-folder-open"
              class="mx-auto mb-4 h-14 w-14 text-muted"
            />
            <p class="mb-4 text-muted">
              暂无项目
            </p>
            <UButton
              v-if="canCreateProjects"
              label="创建第一个项目"
              color="primary"
              @click="navigateTo('/projects/new')"
            />
          </div>

          <!-- ========== 卡片视图：按项目集分组 ========== -->
          <template v-else-if="viewMode === 'card'">
            <div
              v-for="group in groupedProjects"
              :key="group.portfolio?.id ?? 'ungrouped'"
              class="space-y-4 pt-2 pb-1"
            >
              <!-- 项目集分组头 -->
              <div
                v-if="group.portfolio && (!filterMyProjects || (filterMyProjects && getPortfolioProjectCount(group.portfolio, group.projects) > 0))"
                class="flex cursor-pointer select-none items-center gap-3"
                @click="toggleExpand(group.portfolio!.id)"
              >
                <UButton
                  :icon="expandedPortfolios.has(group.portfolio!.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  :color="expandedPortfolios.has(group.portfolio!.id) ? 'primary' : 'neutral'"
                  :variant="expandedPortfolios.has(group.portfolio!.id) ? 'soft' : 'soft'"
                  size="xs"
                  square
                />
                <NuxtLink
                  :to="`/portfolios/${group.portfolio.id}`"
                  class="text-xl font-bold transition-colors hover:text-primary"
                >
                  {{ group.portfolio.name }}
                </NuxtLink>
                <span class="text-base text-muted">
                  ({{ getPortfolioProjectCount(group.portfolio, group.projects) }} 个项目)
                </span>
                <UBadge
                  v-if="group.portfolio.isProductLine"
                  color="primary"
                  variant="subtle"
                  size="xs"
                >
                  产品线
                </UBadge>
                <div
                  class="flex items-center gap-1"
                  @click.stop
                >
                  <UButton
                    v-if="canCreateProjects"
                    icon="i-lucide-circle-plus"
                    color="primary"
                    variant="ghost"
                    size="xs"
                    title="在此项目集下新建项目"
                    @click="openCreateProjectInPortfolio(group.portfolio!)"
                  />
                  <UButton
                    v-if="canManagePortfolios"
                    icon="i-lucide-settings"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    title="编辑项目集"
                    @click="openEditPortfolio(group.portfolio!)"
                  />
                </div>
                <USeparator class="flex-1" />
              </div>
              <div
                v-else-if="group.projects.length >0"
                class="flex items-center gap-3"
              >
                <UButton
                  icon="i-lucide-chevron-down"
                  color="neutral"
                  variant="soft"
                  size="xs"
                  square
                />
                <h2 class="text-xl font-bold text-muted">
                  未分组项目
                </h2>
                <span class="text-base text-muted">
                  ({{ group.projects.length }} 个项目)
                </span>
                <USeparator class="flex-1" />
              </div>

              <!-- 项目卡片网格 -->
              <div
                v-if="!group.portfolio || expandedPortfolios.has(group.portfolio.id)"
                class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              >
                <UPageCard
                  v-for="project in group.projects"
                  :key="project.id"
                  spotlight
                  variant="outline"
                  :class="[
                    isProjectAccessible(project) ? 'cursor-pointer' : 'cursor-not-allowed opacity-75',
                    isCurrentUserProjectLeader(project) ? 'border-primary/70 bg-primary/5 ring-1 ring-primary/35' : ''
                  ]"
                  @click="handleOpenProject(project)"
                >
                  <div class="space-y-1.5">
                    <!-- 卡片头部：状态 + 编码 -->
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2">
                        <UBadge color="info" variant="subtle" size="xs">
                          {{ categoryLabel[project.category] || project.category }}
                        </UBadge>
                        <UBadge
                          :color="(statusColor[project.lifecycleStatus] as any)"
                          variant="subtle"
                          size="xs"
                        >
                          {{ statusLabel[project.lifecycleStatus] || project.lifecycleStatus }}
                        </UBadge>
                        <UBadge
                          v-if="!isProjectAccessible(project)"
                          color="neutral"
                          variant="soft"
                          size="xs"
                          icon="i-lucide-lock"
                        >
                          未加入
                        </UBadge>
                        <UBadge
                          :color="(getProjectSecurityConfig(project).color as any)"
                          variant="subtle"
                          size="xs"
                          :icon="getProjectSecurityConfig(project).icon"
                        >
                          <!-- {{ getProjectSecurityConfig(project).label }} -->
                        </UBadge>
                        <span class="font-mono text-xs text-muted">
                          #{{ project.projectCode }}
                        </span>
                      </div>
                      <div class="flex shrink-0 items-center gap-1">
                        <UBadge
                          v-if="isCurrentUserProjectLeader(project)"
                          color="primary"
                          variant="solid"
                          size="xs"
                          icon="i-lucide-user-check"
                        >
                          我负责
                        </UBadge>
                        <UButton
                          v-if="canManageProject(project)"
                          icon="i-lucide-folder-input"
                          color="neutral"
                          variant="ghost"
                          size="xs"
                          title="设置项目集"
                          @click.stop="openAssignPortfolio(project)"
                        />
                      </div>
                    </div>

                    <!-- 项目名称（简称优先） -->
                    <div class="line-clamp-2 border-b border-default pb-2 text-base font-bold leading-snug">
                      {{ project.shortName || project.name }}
                    </div>

                    <!-- 信息区：分类 + 日期 -->
                    <div class="flex flex-row gap-x-4 gap-y-3">
                      <div class="basis-1/3">
                        <p class="mb-1 text-xs text-muted">
                          负责人
                        </p>
                        <p class="text-xs">
                          {{ getUserName(project.leaderUid) || '-' }}
                        </p>
                      </div>
                      <div class="basis-2/3">
                        <p class="mb-1 text-xs text-muted">
                          计划周期
                        </p>
                        <p class="text-xs">
                          {{ project.startDate ? formatDate(project.startDate) : '待定' }}
                          <template v-if="project.endDate">
                            ~ {{ formatDate(project.endDate) }}
                          </template>
                        </p>
                      </div>
                    </div>
                  </div>
                </UPageCard>
              </div>

              <!-- 项目集为空 -->
              <div
                v-if="group.portfolio && group.projects.length === 0 && expandedPortfolios.has(group.portfolio.id)"
                class="rounded-xl border border-dashed border-default px-6 py-10 text-center text-sm text-muted"
              >
                <template v-if="getPortfolioProjectCount(group.portfolio, group.projects) === 0">
                  该项目集下暂无项目，点击项目集名称进入管理页面创建。
                </template>
                <template v-else>
                  当前筛选条件下暂无可见项目。
                </template>
              </div>
            </div>
          </template>

          <!-- ========== 列表视图：树状展示 ========== -->
          <div
            v-else
            class="overflow-hidden rounded-lg border border-default"
          >
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-default bg-elevated">
                  <th class="px-4 py-2.5 text-left font-medium">
                    名称
                  </th>
                  <th class="w-24 px-4 py-2.5 text-left font-medium">
                    分类
                  </th>
                  <th class="w-24 px-4 py-2.5 text-left font-medium">
                    状态
                  </th>
                  <th class="w-24 px-4 py-2.5 text-left font-medium">
                    负责人
                  </th>
                  <th class="w-32 px-4 py-2.5 text-left font-medium">
                    可见范围
                  </th>
                  <th class="w-48 px-4 py-2.5 text-left font-medium">
                    起止日期
                  </th>
                  <th class="w-20 px-4 py-2.5 text-left font-medium">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                <template
                  v-for="row in treeData"
                  :key="row.id"
                >
                  <!-- 项目集行 -->
                  <tr
                    v-if="row.isPortfolio && row.portfolio"
                    class="cursor-pointer border-b border-default hover:bg-elevated"
                    @click="toggleExpand(row.portfolio.id)"
                  >
                    <td class="px-4 py-2.5">
                      <div class="flex items-center gap-2">
                        <UIcon
                          :name="expandedPortfolios.has(row.portfolio.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                          class="h-4 w-4 shrink-0 text-muted"
                        />
                        <UIcon
                          name="i-lucide-folder"
                          class="h-4 w-4 shrink-0 text-primary"
                        />
                        <span class="font-semibold">{{ row.name }}</span>
                        <UBadge
                          v-if="row.portfolio?.isProductLine"
                          color="primary"
                          variant="subtle"
                          size="xs"
                        >
                          产品线
                        </UBadge>
                        <UBadge
                          color="neutral"
                          variant="subtle"
                          size="xs"
                        >
                          {{ row.projectCount }} 个项目
                        </UBadge>
                      </div>
                    </td>
                    <td />
                    <td />
                    <td class="px-4 py-2.5 text-muted">
                      {{ getUserName(row.portfolio?.ownerUid) }}
                    </td>
                    <td />
                    <td />
                    <td class="px-4 py-2.5">
                      <UButton
                        v-if="canCreateProjects"
                        icon="i-lucide-plus"
                        color="primary"
                        variant="ghost"
                        size="xs"
                        title="在此项目集下新建项目"
                        @click.stop="openCreateProjectInPortfolio(row.portfolio)"
                      />
                      <UButton
                        v-if="canManagePortfolios"
                        icon="i-lucide-settings-2"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        title="编辑项目集"
                        @click.stop="openEditPortfolio(row.portfolio)"
                      />
                    </td>
                  </tr>

                  <!-- 项目集下的子项目 -->
                  <template v-if="row.isPortfolio && row.portfolio && row.children && expandedPortfolios.has(row.portfolio.id)">
                    <tr
                      v-for="child in row.children"
                      :key="child.id"
                      class="border-b border-default hover:bg-elevated"
                      :class="[
                        isProjectAccessible(child.project) ? 'cursor-pointer' : 'cursor-not-allowed opacity-75',
                        isCurrentUserProjectLeader(child.project) ? 'bg-primary/5' : ''
                      ]"
                      @click="handleOpenProject(child.project!)"
                    >
                      <td class="px-4 py-2.5">
                        <div class="flex items-center gap-2 pl-10">
                          <UIcon
                            v-if="!isProjectAccessible(child.project)"
                            name="i-lucide-lock"
                            class="h-3.5 w-3.5 shrink-0 text-muted"
                          />
                          <span class="font-medium">{{ child.name }}</span>
                        </div>
                      </td>
                      <td class="px-4 py-2.5">
                        <UBadge
                          color="info"
                          variant="subtle"
                          size="xs"
                        >
                          {{ categoryLabel[child.category!] || child.category }}
                        </UBadge>
                      </td>
                      <td class="px-4 py-2.5">
                        <UBadge
                          :color="(statusColor[child.lifecycleStatus!] as any)"
                          variant="subtle"
                          size="xs"
                        >
                          {{ statusLabel[child.lifecycleStatus!] || child.lifecycleStatus }}
                        </UBadge>
                      </td>
                      <td class="px-4 py-2.5 text-muted">
                        {{ getUserName(child.leaderUid) }}
                      </td>
                      <td class="px-4 py-2.5">
                        <UBadge
                          :color="(getProjectSecurityConfig(child.project).color as any)"
                          variant="subtle"
                          size="xs"
                          :icon="getProjectSecurityConfig(child.project).icon"
                        >
                          {{ getProjectSecurityConfig(child.project).label }}
                        </UBadge>
                      </td>
                      <td class="px-4 py-2.5 text-muted text-xs">
                        {{ formatDate(child.startDate ?? null) }} ~ {{ formatDate(child.endDate ?? null) }}
                      </td>
                      <td class="px-4 py-2.5">
                        <UButton
                          v-if="canManageProject(child.project)"
                          icon="i-lucide-folder-input"
                          color="neutral"
                          variant="ghost"
                          size="xs"
                          title="设置项目集"
                          @click.stop="openAssignPortfolio(child.project!)"
                        />
                      </td>
                    </tr>
                  </template>

                  <!-- 独立项目（不在项目集内） -->
                  <tr
                    v-if="!row.isPortfolio"
                    class="border-b border-default hover:bg-elevated"
                    :class="[
                      isProjectAccessible(row.project) ? 'cursor-pointer' : 'cursor-not-allowed opacity-75',
                      isCurrentUserProjectLeader(row.project) ? 'bg-primary/5' : ''
                    ]"
                    @click="handleOpenProject(row.project!)"
                  >
                    <td class="px-4 py-2.5">
                      <div class="flex items-center gap-2">
                        <UIcon
                          v-if="!isProjectAccessible(row.project)"
                          name="i-lucide-lock"
                          class="h-3.5 w-3.5 shrink-0 text-muted"
                        />
                        <span class="font-medium">{{ row.name }}</span>
                      </div>
                    </td>
                    <td class="px-4 py-2.5">
                      <UBadge
                        color="info"
                        variant="subtle"
                        size="xs"
                      >
                        {{ categoryLabel[row.category!] || row.category }}
                      </UBadge>
                    </td>
                    <td class="px-4 py-2.5">
                      <UBadge
                        :color="(statusColor[row.lifecycleStatus!] as any)"
                        variant="subtle"
                        size="xs"
                      >
                        {{ statusLabel[row.lifecycleStatus!] || row.lifecycleStatus }}
                      </UBadge>
                    </td>
                    <td class="px-4 py-2.5 text-muted">
                      {{ getUserName(row.leaderUid) }}
                    </td>
                    <td class="px-4 py-2.5">
                      <UBadge
                        :color="(getProjectSecurityConfig(row.project).color as any)"
                        variant="subtle"
                        size="xs"
                        :icon="getProjectSecurityConfig(row.project).icon"
                      >
                        {{ getProjectSecurityConfig(row.project).label }}
                      </UBadge>
                    </td>
                    <td class="px-4 py-2.5 text-xs text-muted">
                      {{ formatDate(row.startDate ?? null) }} ~ {{ formatDate(row.endDate ?? null) }}
                    </td>
                    <td class="px-4 py-2.5">
                      <UButton
                        v-if="canManageProject(row.project)"
                        icon="i-lucide-folder-input"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        title="设置项目集"
                        @click.stop="openAssignPortfolio(row.project!)"
                      />
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>

        <!-- ========== 项目访问受限弹窗 ========== -->
        <UModal v-model:open="showUnauthorizedProjectModal">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-lock" class="h-5 w-5 text-warning" />
              <h3 class="text-lg font-semibold">
                无法访问该项目
              </h3>
            </div>
          </template>
          <template #body>
            <div class="space-y-3 text-sm">
              <p class="text-highlighted">
                你当前没有访问
                <span class="font-semibold">“{{ unauthorizedProject?.shortName || unauthorizedProject?.name }}”</span>
                的权限。
              </p>
              <p class="text-muted">
                如需加入项目，请联系项目经理
                <span class="font-semibold text-highlighted">{{ getProjectManagerName(unauthorizedProject) }}</span>。
              </p>
            </div>
          </template>
          <template #footer>
            <div class="flex w-full justify-end">
              <UButton
                label="知道了"
                color="primary"
                @click="showUnauthorizedProjectModal = false"
              />
            </div>
          </template>
        </UModal>

        <!-- ========== 新建项目集弹窗 ========== -->
        <UModal v-model:open="showCreatePortfolioModal">
          <template #header>
            <h3 class="text-lg font-semibold">
              新建项目集
            </h3>
          </template>
          <template #body>
            <div class="space-y-4">
              <UFormField label="项目集名称" required>
                <UInput
                  :model-value="portfolioForm.name"
                  placeholder="如：智慧城市系列"
                  class="w-full"
                  @update:model-value="onPortfolioNameInput"
                />
              </UFormField>
              <UFormField label="项目集编码" required description="自动生成，可手动修改。以 C- 开头，全大写字母">
                <UInput
                  :model-value="portfolioForm.code"
                  placeholder="如：C-ZHCS"
                  class="w-full font-mono"
                  @update:model-value="onPortfolioCodeInput"
                />
              </UFormField>
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="负责人">
                  <USelectMenu
                    :model-value="portfolioForm.ownerUid ?? undefined"
                    :items="userOptions"
                    :filter-fields="['label', 'uid']"
                    value-key="value"
                    label-key="label"
                    placeholder="选择负责人"
                    class="w-full"
                    searchable
                    @update:model-value="onPortfolioOwnerChange"
                  >
                    <template #item-label="{ item }">
                      {{ item.label }}
                      <span
                        v-if="item.uid"
                        class="text-muted text-xs"
                      >({{ item.uid }})</span>
                    </template>
                  </USelectMenu>
                </UFormField>
                <UFormField label="所属部门">
                  <UInput
                    :model-value="(portfolioForm.deptCode as string)"
                    placeholder="根据负责人自动填充"
                    class="w-full"
                    disabled
                  />
                </UFormField>
              </div>
              <UFormField label="产品线">
                <div class="flex items-start justify-between gap-4 rounded-xl border border-default px-4 py-3">
                  <div class="space-y-1">
                    <div class="text-sm font-medium text-highlighted">
                      设为产品线
                    </div>
                    <p class="text-xs text-muted">
                      设为产品线后，归属该项目集的新项目会自动归类为"产品研发"。
                    </p>
                  </div>
                  <USwitch v-model="portfolioForm.isProductLine" />
                </div>
              </UFormField>
              <!-- 暂时不设置业务领域 -->
              <UFormField v-if="false" label="业务领域">
                <div class="space-y-2">
                  <URadioGroup
                    v-model="portfolioDomainCategory"
                    :items="domainCategoryItems"
                    orientation="horizontal"
                    size="sm"
                  />
                  <USelectMenu
                    v-model="(portfolioForm.domainCode as string)"
                    :items="portfolioDomainOptions"
                    value-key="value"
                    label-key="label"
                    placeholder="选择业务领域"
                    class="w-full"
                    searchable
                  />
                </div>
              </UFormField>
              <UFormField label="Git群组">
                <GitGroupTreeSelector
                  v-model="(portfolioForm.gitGroup as string)"
                  :tree="gitGroupTree"
                  placeholder="选择 GitLab 群组"
                />
              </UFormField>
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="showCreatePortfolioModal = false"
              />
              <UButton
                label="创建"
                color="primary"
                :loading="creatingPortfolio"
                @click="handleCreatePortfolio"
              />
            </div>
          </template>
        </UModal>

        <!-- ========== 编辑项目集弹窗 ========== -->
        <UModal v-model:open="showEditPortfolioModal">
          <template #header>
            <h3 class="text-lg font-semibold">
              编辑项目集{{ editingPortfolio ? ` · ${editingPortfolio.name}` : '' }}
            </h3>
          </template>
          <template #body>
            <div class="space-y-4">
              <UFormField label="项目集名称" required>
                <UInput
                  v-model="editPortfolioForm.name"
                  placeholder="如：智慧城市系列"
                  class="w-full"
                />
              </UFormField>
              <div class="grid grid-cols-2 gap-4">
                <UFormField label="负责人">
                  <USelectMenu
                    :model-value="editPortfolioForm.ownerUid ?? undefined"
                    :items="userOptions"
                    :filter-fields="['label', 'uid']"
                    value-key="value"
                    label-key="label"
                    placeholder="选择负责人"
                    class="w-full"
                    searchable
                    @update:model-value="onEditPortfolioOwnerChange"
                  >
                    <template #item-label="{ item }">
                      {{ item.label }}
                      <span
                        v-if="item.uid"
                        class="text-muted text-xs"
                      >({{ item.uid }})</span>
                    </template>
                  </USelectMenu>
                </UFormField>
                <UFormField label="所属部门">
                  <UInput
                    :model-value="(editPortfolioForm.deptCode as string)"
                    placeholder="根据负责人自动填充"
                    class="w-full"
                    disabled
                  />
                </UFormField>
              </div>
              <UFormField label="产品线">
                <div class="flex items-start justify-between gap-4 rounded-xl border border-default px-4 py-3">
                  <div class="space-y-1">
                    <div class="text-sm font-medium text-highlighted">
                      设为产品线
                    </div>
                    <p class="text-xs text-muted">
                      设为产品线后，归属该项目集的新项目会自动归类为"产品研发"。
                    </p>
                  </div>
                  <USwitch v-model="editPortfolioForm.isProductLine" />
                </div>
              </UFormField>
              <!-- 编辑时不允许修改业务领域分类，避免出现分类变更导致的业务混乱 -->
              <UFormField v-if="false" label="业务领域">
                <div class="space-y-2">
                  <URadioGroup
                    v-model="editPortfolioDomainCategory"
                    :items="domainCategoryItems"
                    orientation="horizontal"
                    size="sm"
                  />
                  <USelectMenu
                    v-model="(editPortfolioForm.domainCode as string)"
                    :items="editPortfolioDomainOptions"
                    value-key="value"
                    label-key="label"
                    placeholder="选择业务领域"
                    class="w-full"
                    searchable
                  />
                </div>
              </UFormField>
              <UFormField label="Git群组">
                <GitGroupTreeSelector
                  v-model="(editPortfolioForm.gitGroup as string)"
                  :tree="gitGroupTree"
                  placeholder="选择 GitLab 群组"
                />
              </UFormField>
              <UFormField label="描述">
                <UTextarea
                  v-model="(editPortfolioForm.description as string)"
                  placeholder="项目集描述"
                  class="w-full"
                />
              </UFormField>
            </div>
          </template>
          <template #footer>
            <div class="flex w-full items-center justify-end gap-2">
              <UButton
                v-if="canDeleteEditingPortfolio"
                label="删除项目集"
                color="error"
                variant="soft"
                @click="showDeletePortfolioConfirm = true"
              />
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="showEditPortfolioModal = false"
              />
              <UButton
                label="保存"
                color="primary"
                :loading="updatingPortfolio"
                @click="handleUpdatePortfolio"
              />
            </div>
          </template>
        </UModal>

        <UModal v-model:open="showDeletePortfolioConfirm">
          <template #header>
            <h3 class="text-lg font-semibold">
              确认删除项目集
            </h3>
          </template>
          <template #body>
            <div class="p-4 text-sm">
              确定要删除项目集 <strong>{{ editingPortfolio?.name }}</strong> 吗？此操作不可撤销。
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="showDeletePortfolioConfirm = false"
              />
              <UButton
                label="确认删除"
                color="error"
                :loading="updatingPortfolio"
                @click="handleDeletePortfolio"
              />
            </div>
          </template>
        </UModal>

        <!-- ========== 设置项目所属项目集弹窗 ========== -->
        <UModal v-model:open="showAssignPortfolioModal" :ui="{ content: 'w-lg' }">
          <template #header>
            <h3 class="text-lg font-semibold">
              设置项目集 — {{ assigningProject?.name }}
            </h3>
          </template>
          <template #body>
            <div class="space-y-4">
              <UFormField label="选择项目集">
                <USelect
                  v-model="assignPortfolioId"
                  :items="portfolioAssignOptions"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>
            </div>
          </template>
          <template #footer>
            <div class="flex w-full items-center justify-between gap-2">
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="showAssignPortfolioModal = false"
              />
              <UButton
                label="确定"
                color="primary"
                @click="handleAssignPortfolio"
              />
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
