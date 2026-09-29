<script setup lang="ts">
import { projectSecurityLevelConfig, projectStatusConfig, getProjectCategoryLabel, projectCategoryOptions, selectableProjectCategoryOptions } from '../../config/project'
import type {
  AimsProject,
  ProjectPortfolio,
  ProjectCategory,
  LifecycleStatus,
  UpdatePortfolioRequest
} from '../../types/aims'
import { useProjectContext } from '../../composables/useProjectContext'
import { usePortfolioStore } from '../../stores/portfolio'
import { useProjectStore } from '../../stores/project'
import { readProjectListState, writeProjectListState } from '../../utils/project-list-state.mjs'
import { useTimeEntryReadPage } from '../../composables/useTimeEntryPage'
import { isProjectProjection, type ProjectOverviewPage, type ProjectGroupPage } from '../../utils/projectOverviewPagination'
import { useAimsModule } from '../../../layer/useAimsModule'

definePageMeta({
  hostContentInset: false,
  layoutHeader: true,
  layoutHeaderTitle: '项目总览',
  layoutHeaderProjectSwitcher: false
})

const projectStore = useProjectStore()
const portfolioStore = usePortfolioStore()
const toast = useToast()
const { enterProject } = useProjectContext()
const { hosted, moduleUrl } = useAimsModule()
const route = useRoute()
const router = useRouter()
const { user: authUser } = useAuth()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const canManagePortfolios = computed(() => hasPermission('portfolios', 'admin'))

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
const editPortfolioDomainCategory = ref<'2G' | '2B' | '2C'>('2G')

// 按分类过滤的领域子级选项
function getDomainOptionsByCategory(category: '2G' | '2B' | '2C') {
  return businessDomains.value
    .filter(d => d.category === category && d.parentCode !== null)
    .map(d => ({ label: d.domainName, value: d.domainCode }))
}

const editPortfolioDomainOptions = computed(() => getDomainOptionsByCategory(editPortfolioDomainCategory.value))

// 切换分类时清空已选的领域
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

function normalizeDisplayOrder(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
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
const { search: searchText, debounced: debouncedSearchText } = useDebouncedSearch()

// 弹窗
const showEditPortfolioModal = ref(false)
const { confirm } = useConfirm()
const showAssignPortfolioModal = ref(false)
const showUnauthorizedProjectModal = ref(false)
const updatingPortfolio = ref(false)
const editingPortfolio = ref<ProjectPortfolio | null>(null)
const assigningProject = ref<AimsProject | null>(null)
const unauthorizedProject = ref<AimsProject | null>(null)
const assignPortfolioId = ref<number | null>(null)

const statusLabel = Object.fromEntries(
  Object.entries(projectStatusConfig).map(([k, v]) => [k, v.label])
)

const statusColor = Object.fromEntries(
  Object.entries(projectStatusConfig).map(([k, v]) => [k, v.color])
)

const categoryOptions = projectCategoryOptions

const projectOverviewPageSize = hosted ? 20 : 500
const rootPage = ref(/^[1-9]\d*$/.test(String(route.query.groupPage || '')) && Number(route.query.groupPage) <= 1_000_000 ? Number(route.query.groupPage) : 1)
const rootRead = useTimeEntryReadPage<ProjectOverviewPage>(isProjectProjection)
const groupPages = ref<Record<string, number>>({})
const groupData = shallowRef<Record<string, ProjectGroupPage>>({})
const groupErrors = ref<Record<string, boolean>>({})
const groupTotals = ref<Record<string, number>>({})
const assignmentRead = useTimeEntryReadPage<ProjectOverviewPage>(isProjectProjection)
const assignmentPage = ref(1)
const { search: assignmentSearch, debounced: assignmentSearchDebounced } = useDebouncedSearch()
async function readAssignmentRoots(page = 1) {
  assignmentPage.value = page
  await assignmentRead.read(moduleUrl('/api/v1/projects'), { projection: 'portfolios', rootSearch: assignmentSearchDebounced.value || undefined, page, pageSize: 20 })
  if ([401, 403].includes(assignmentRead.errorStatus.value || 0)) {
    const deniedStatus = assignmentRead.errorStatus.value
    rootRead.clear()
    clearOverview()
    rootRead.error.value = true
    rootRead.errorStatus.value = deniedStatus
  }
}
watch(assignmentSearchDebounced, () => {
  if (hosted && showAssignPortfolioModal.value) void readAssignmentRoots()
})
const groupReadPool = Array.from({ length: 21 }, () => useTimeEntryReadPage<ProjectGroupPage>(isProjectProjection))
const groupReads = new Map<number, ReturnType<typeof useTimeEntryReadPage<ProjectGroupPage>>>()
let overviewGeneration = 0
function clearOverview() {
  overviewGeneration++
  assignmentRead.clear()
  for (const read of groupReadPool) read.clear()
  groupReads.clear()
  groupData.value = {}
  groupErrors.value = {}
  groupTotals.value = {}
  groupPages.value = {}
  portfolioStore.portfolios = []
  projectStore.projects = []
  showEditPortfolioModal.value = false
  editingPortfolio.value = null
  showAssignPortfolioModal.value = false
  assigningProject.value = null
  showUnauthorizedProjectModal.value = false
  unauthorizedProject.value = null
}
watch(rootRead.fingerprint, clearOverview, { flush: 'sync' })
onScopeDispose(clearOverview)
function overviewQuery(searchValue = debouncedSearchText.value) {
  const source = buildProjectListQuery(searchValue)
  return { category: source.category, lifecycle_status: source.lifecycleStatus, portfolio_id: source.portfolioId,
    search: source.search, participating_only: source.participatingOnly ? '1' : undefined }
}
async function readGroup(id: number, page = 1) {
  const epoch = overviewGeneration
  if (filterPortfolio.value !== 'all' && Number(filterPortfolio.value) !== id) return
  let read = groupReads.get(id)
  if (!read) {
    read = groupReadPool[groupReads.size]!
    groupReads.set(id, read)
  }
  groupPages.value[id] = page
  groupData.value = Object.fromEntries(Object.entries(groupData.value).filter(([key]) => key !== String(id)))
  groupErrors.value[id] = false
  const result = await read.read(moduleUrl('/api/v1/projects'), { ...overviewQuery(), projection: 'projects', portfolio_id: id, page, pageSize: 20 })
  if (epoch !== overviewGeneration) return
  if (result) {
    groupData.value = { ...groupData.value, [id]: { ...result, items: result.items.map(projectStore.normalizeProject) } }
    groupTotals.value[id] = result.total
  } else if (read.error.value) {
    groupErrors.value[id] = true
    if ([401, 403].includes(read.errorStatus.value || 0)) {
      const deniedStatus = read.errorStatus.value
      rootRead.clear()
      clearOverview()
      rootRead.error.value = true
      rootRead.errorStatus.value = deniedStatus
    }
  }
}
async function loadOverview(searchValue?: string) {
  clearOverview()
  const epoch = overviewGeneration
  const result = await rootRead.read(moduleUrl('/api/v1/projects'), { ...overviewQuery(searchValue), projection: 'portfolios', page: rootPage.value, pageSize: 20 })
  if (!result || epoch !== overviewGeneration) return
  portfolioStore.portfolios = result.items.map(item => portfolioStore.normalizePortfolio({ ...item.portfolio, canDelete: item.canDelete }))
  groupTotals.value = { ...result.summary.portfolioCounts }
  await Promise.all([...result.items.filter(item => Number(item.portfolio.projectCount || 0) > 0).map(item => Number(item.portfolio.id)), ...(result.summary.portfolioCounts['0'] ? [0] : [])].map(id => readGroup(id)))
}
function rootPageChanged(page: number) {
  rootPage.value = page
  void router.replace({ query: { ...route.query, groupPage: String(page) } })
  void loadOverview()
}
watch(rootRead.fingerprint, () => {
  if (hosted && rootRead.fingerprint.value) void loadOverview()
})
const restoredSearch = ref<string | undefined>(undefined)

if (hosted) {
  const initial = readProjectListState(route.query)
  filterCategory.value = initial.category
  filterStatus.value = initial.status
  filterPortfolio.value = initial.portfolio
  filterMyProjects.value = initial.participatingOnly
  viewMode.value = initial.view
  searchText.value = initial.search
  restoredSearch.value = initial.search || undefined
}

const editPortfolioForm = ref<UpdatePortfolioRequest>({
  name: '',
  description: '',
  domainCode: '',
  ownerUid: '',
  deptCode: '',
  gitGroup: '',
  defaultCategory: undefined as ProjectCategory | undefined,
  displayOrder: 0
})

const currentEditingPortfolio = computed(() => {
  if (!editingPortfolio.value) return null
  return portfolioStore.portfolios.find(pf => pf.id === editingPortfolio.value?.id) || editingPortfolio.value
})

const canDeleteEditingPortfolio = computed(() => hosted ? currentEditingPortfolio.value?.canDelete === true : Number(currentEditingPortfolio.value?.projectCount ?? 0) === 0)

function buildProjectListQuery(searchValue = debouncedSearchText.value) {
  return {
    category: (filterCategory.value !== 'all' ? filterCategory.value : undefined) as ProjectCategory | undefined,
    lifecycleStatus: (filterStatus.value !== 'all' ? filterStatus.value : undefined) as LifecycleStatus | undefined,
    portfolioId: filterPortfolio.value !== 'all' ? Number(filterPortfolio.value) : undefined,
    search: searchValue || undefined,
    participatingOnly: filterMyProjects.value,
    pageSize: projectOverviewPageSize
  }
}

// 加载数据
async function loadData(searchValue?: string) {
  if (hosted) return loadOverview(searchValue)
  await Promise.all([
    projectStore.fetchProjects(buildProjectListQuery(searchValue)),
    portfolioStore.fetchPortfolios()
  ])
}

onMounted(async () => {
  if (!permissionsLoaded.value) {
    await loadPermissions()
  }
  loadData(restoredSearch.value)
})

let restoringFromUrl = false
function syncProjectListUrl() {
  if (!hosted || restoringFromUrl) return
  const next = writeProjectListState({
    category: filterCategory.value,
    status: filterStatus.value,
    portfolio: filterPortfolio.value,
    search: searchText.value,
    participatingOnly: filterMyProjects.value,
    view: viewMode.value
  })
  const query = Object.fromEntries(Object.entries(route.query).filter(([key]) => !['category', 'status', 'portfolio', 'search', 'participatingOnly', 'view'].includes(key)))
  Object.assign(query, next, hosted ? { groupPage: String(rootPage.value) } : {})
  void router.replace({ query })
}

watch([filterCategory, filterStatus, filterPortfolio, filterMyProjects, debouncedSearchText], () => {
  if (hosted) {
    rootPage.value = 1
    void loadOverview()
  } else projectStore.fetchProjects(buildProjectListQuery())
  syncProjectListUrl()
})
watch(viewMode, syncProjectListUrl)
watch(() => route.query, (query) => {
  if (!hosted || restoringFromUrl) return
  const next = readProjectListState(query)
  restoringFromUrl = true
  filterCategory.value = next.category
  filterStatus.value = next.status
  filterPortfolio.value = next.portfolio
  filterMyProjects.value = next.participatingOnly
  viewMode.value = next.view
  searchText.value = next.search
  nextTick(() => {
    restoringFromUrl = false
  })
}, { deep: true })

// ---- 计算属性：按项目集分组 ----

interface PortfolioGroup {
  portfolio: ProjectPortfolio | null
  projects: AimsProject[]
}

const visibleProjects = computed(() => {
  if (hosted) return Object.values(groupData.value).flatMap(group => group.items)
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
  const routineGroups: PortfolioGroup[] = []

  // 有匹配项目的项目集优先展示；当前筛选下为空的项目集放到列表末尾。
  for (const pf of portfolioStore.portfolios) {
    const projects = hosted ? (groupData.value[pf.id]?.items || []) : (portfolioMap.get(pf.id) || [])
    const group = { portfolio: pf, projects }
    if (pf.defaultCategory === 'routine') {
      routineGroups.push(group)
    } else if (hosted ? (pf.projectCount || 0) > 0 : projects.length > 0) {
      groups.push(group)
    } else {
      emptyGroups.push(group)
    }
  }

  // 独立项目
  if (hosted ? !!rootRead.data.value?.summary.portfolioCounts['0'] : ungrouped.length > 0) {
    groups.push({ portfolio: null, projects: ungrouped })
  }

  return [...groups, ...emptyGroups, ...routineGroups]
})

interface ProjectYearGroup {
  key: string
  label: string
  historical: boolean
  projects: AimsProject[]
}

function projectYearGroups(projects: AimsProject[]): ProjectYearGroup[] {
  const latestByLine = new Map<string, number>(hosted ? Object.entries({ ...rootRead.data.value?.summary.latestByLine, ...Object.assign({}, ...Object.values(groupData.value).map(group => group.summary.latestByLine)) }) : [])
  const lineKey = (project: AimsProject) => hosted ? `${project.portfolioId || 0}:${project.serviceLineCode}` : project.serviceLineCode!
  for (const project of projects) {
    if (!project.serviceLineCode || !project.servicePeriodSeq) continue
    latestByLine.set(lineKey(project), Math.max(latestByLine.get(lineKey(project)) || 0, project.servicePeriodSeq))
  }

  const current: AimsProject[] = []
  const historical = new Map<string, AimsProject[]>()
  for (const project of projects) {
    const isHistorical = Boolean(
      project.category === 'maintenance'
      && project.serviceLineCode
      && project.servicePeriodSeq
      && project.servicePeriodSeq < (latestByLine.get(lineKey(project)) || 0)
    )
    if (!isHistorical) {
      current.push(project)
      continue
    }
    const label = project.servicePeriodLabel || project.servicePeriodStart?.slice(0, 4) || '历史年度'
    const list = historical.get(label) || []
    list.push(project)
    historical.set(label, list)
  }

  const groups: ProjectYearGroup[] = [{ key: 'current', label: '', historical: false, projects: current }]
  for (const [label, items] of [...historical.entries()].sort(([a], [b]) => b.localeCompare(a, 'zh-CN'))) {
    groups.push({ key: `history-${label}`, label, historical: true, projects: items })
  }
  return groups.filter(group => group.projects.length > 0)
}

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
        projectCount: getPortfolioProjectCount(group.portfolio, group.projects),
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
const expandedHistoricalYears = ref<Set<string>>(new Set())

function historicalYearKey(portfolioId: number | null | undefined, yearKey: string) {
  return `${portfolioId ?? 'ungrouped'}:${yearKey}`
}

function toggleHistoricalYear(portfolioId: number | null | undefined, yearKey: string) {
  const key = historicalYearKey(portfolioId, yearKey)
  const next = new Set(expandedHistoricalYears.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedHistoricalYears.value = next
}

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

    if (hosted ? !group.portfolio.projectCount : group.projects.length === 0) {
      nextExpanded.delete(portfolioId)
      nextAutoCollapsed.add(portfolioId)
      continue
    }

    const shouldAutoExpand = group.portfolio.defaultCategory !== 'routine'
      && (!nextInitialized.has(portfolioId) || (nextAutoCollapsed.has(portfolioId) && !nextManualCollapsed.has(portfolioId)))
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
    defaultCategory: latestPortfolio.defaultCategory ?? undefined,
    displayOrder: normalizeDisplayOrder(latestPortfolio.displayOrder)
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
    editPortfolioForm.value.displayOrder = normalizeDisplayOrder(editPortfolioForm.value.displayOrder)
    await portfolioStore.updatePortfolio(editingPortfolio.value.id, editPortfolioForm.value)
    showEditPortfolioModal.value = false
    editingPortfolio.value = null
    await loadData()
  } finally {
    updatingPortfolio.value = false
  }
}

async function handleDeletePortfolio() {
  if (!editingPortfolio.value || updatingPortfolio.value) return
  if (!canManagePortfolios.value) {
    toast.add({ title: '仅 AIMS 管理员可以删除项目集', color: 'warning' })
    return
  }
  const target = editingPortfolio.value
  if (!await confirm({ title: '删除项目集', message: `确认删除项目集「${target.name}」？只能删除没有项目的项目集，删除后不可恢复。`, tone: 'danger', confirmLabel: '删除项目集' })) return
  if (editingPortfolio.value?.id !== target.id || updatingPortfolio.value) return
  updatingPortfolio.value = true
  try {
    await portfolioStore.deletePortfolio(editingPortfolio.value.id)
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
  if (hosted) {
    assignmentSearch.value = ''
    void readAssignmentRoots()
  }
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
  if (hosted) return groupTotals.value[portfolio?.id || 0] ?? (portfolio?.projectCount || 0)
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
    opts.push({
      label: pf.defaultCategory ? `${pf.name} · ${getProjectCategoryLabel(pf.defaultCategory)}` : pf.name,
      value: String(pf.id)
    })
  }
  opts.push({ label: '未分组', value: '0' })
  return opts
})

// 项目集选择选项（用于分配弹窗）
const portfolioAssignOptions = computed(() => {
  const opts: { label: string, value: number | null }[] = [
    { label: '不归属任何项目集', value: null }
  ]
  for (const pf of hosted ? (assignmentRead.data.value?.items || []).map(item => item.portfolio) : portfolioStore.portfolios) {
    opts.push({
      label: pf.defaultCategory ? `${pf.name} · ${getProjectCategoryLabel(pf.defaultCategory)}` : pf.name,
      value: pf.id
    })
  }
  if (hosted && assignPortfolioId.value && !opts.some(item => item.value === assignPortfolioId.value)) {
    opts.push({ label: `项目集 #${assignPortfolioId.value}`, value: assignPortfolioId.value })
  }
  return opts
})
</script>

<template>
  <UDashboardPanel
    id="projects"
    :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }"
  >
    <template #body>
      <div class="flex h-full min-h-0 flex-col projects-page-container" style="container-type: inline-size">
        <div v-if="hosted" class="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
          <ContentPageHeader
            :hosted="hosted"
            title="项目总览"
            description="浏览企业项目并按项目集、状态和类型筛选。"
            breadcrumb="交付与服务 / 项目管理"
          />
        </div>
        <div class="shrink-0 border-b border-default bg-default/95 px-4 py-3 sm:px-6 backdrop-blur supports-backdrop-filter:bg-default/80">
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

        <div class="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-8 sm:px-6">
          <!-- 加载中 -->
          <div
            v-if="hosted ? rootRead.loading.value : projectStore.loading"
            class="flex justify-center py-16"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="w-8 h-8 animate-spin text-muted"
            />
          </div>

          <UAlert
            v-if="hosted && rootRead.error.value"
            color="error"
            title="项目总览读取失败"
            class="mb-4"
          />
          <UButton v-if="hosted && rootRead.error.value" label="重试" @click="loadOverview()" />
          <div v-if="hosted && rootRead.data.value" class="mb-4 flex flex-wrap items-center gap-3">
            <span>共 {{ rootRead.data.value.total }} 个项目集 · {{ rootRead.data.value.summary.projectCount }} 个可见项目</span>
            <UPagination
              :sibling-count="0"
              size="xs"
              :page="rootPage"
              :items-per-page="20"
              :total="rootRead.data.value.total"
              @update:page="rootPageChanged"
            />
          </div>

          <!-- 空状态 -->
          <div
            v-if="visibleProjects.length === 0 && portfolioStore.portfolios.length === 0 && !(hosted && (rootRead.loading.value || rootRead.error.value)) && !(!hosted && projectStore.loading)"
            class="py-16 text-center"
          >
            <UIcon
              name="i-lucide-folder-open"
              class="mx-auto mb-4 h-14 w-14 text-muted"
            />
            <p class="mb-4 text-muted">
              暂无项目
            </p>
          </div>

          <!-- ========== 卡片视图：按项目集分组 ========== -->
          <template v-else-if="viewMode === 'card' && !(hosted ? (rootRead.loading.value || rootRead.error.value) : projectStore.loading)">
            <div
              v-for="group in groupedProjects"
              :key="group.portfolio?.id ?? 'ungrouped'"
              class="space-y-4 pt-2 pb-1"
            >
              <!-- 项目集分组头 -->
              <div
                v-if="group.portfolio && (hosted || !filterMyProjects || (filterMyProjects && getPortfolioProjectCount(group.portfolio, group.projects) > 0))"
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
                  v-if="!hosted"
                  :to="`/portfolios/${group.portfolio.id}`"
                  class="text-xl font-bold transition-colors hover:text-primary"
                >
                  {{ group.portfolio.name }}
                </NuxtLink>
                <span v-else class="text-xl font-bold">
                  {{ group.portfolio.name }}
                </span>
                <span class="text-base text-muted">
                  ({{ getPortfolioProjectCount(group.portfolio, group.projects) }} 个项目)
                </span>
                <UBadge
                  v-if="group.portfolio.defaultCategory"
                  color="primary"
                  variant="subtle"
                  size="xs"
                >
                  {{ getProjectCategoryLabel(group.portfolio.defaultCategory) }}
                </UBadge>
                <div
                  class="flex items-center gap-1"
                  @click.stop
                >
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
                class="space-y-3"
              >
                <template
                  v-for="yearGroup in projectYearGroups(group.projects)"
                  :key="yearGroup.key"
                >
                  <button
                    v-if="yearGroup.historical"
                    type="button"
                    class="flex w-full items-center gap-2 rounded-lg border border-default bg-elevated/30 px-3 py-2 text-left text-sm transition-colors hover:bg-elevated"
                    @click="toggleHistoricalYear(group.portfolio?.id, yearGroup.key)"
                  >
                    <UIcon
                      :name="expandedHistoricalYears.has(historicalYearKey(group.portfolio?.id, yearGroup.key)) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                      class="size-4 text-muted"
                    />
                    <span class="font-medium">历史服务年度 · {{ yearGroup.label }}</span>
                    <span class="text-muted">({{ hosted ? (groupData[group.portfolio?.id || 0]?.summary.historicalCounts || rootRead.data.value?.summary.historicalCounts)?.[`${group.portfolio?.id || 0}:${yearGroup.key}`] || 0 : yearGroup.projects.length }} 个项目)</span>
                  </button>
                  <div
                    v-if="!yearGroup.historical || expandedHistoricalYears.has(historicalYearKey(group.portfolio?.id, yearGroup.key))"
                    class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 projects-page-grid"
                    :class="hosted ? 'is-hosted' : ''"
                  >
                    <UPageCard
                      v-for="project in yearGroup.projects"
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
                              {{ getProjectCategoryLabel(project.category) }}
                            </UBadge>
                            <UBadge
                              v-if="project.oppId"
                              color="primary"
                              variant="outline"
                              size="xs"
                              icon="i-lucide-route"
                            >
                              Altoc 商机
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
                </template>
              </div>

              <div v-if="hosted && (!group.portfolio || expandedPortfolios.has(group.portfolio.id))" class="flex flex-wrap items-center gap-3">
                <span>共 {{ getPortfolioProjectCount(group.portfolio, group.projects) }} 条</span>
                <UPagination
                  :sibling-count="0"
                  size="xs"
                  :page="groupPages[group.portfolio?.id ?? 0] || 1"
                  :items-per-page="20"
                  :total="groupTotals[group.portfolio?.id ?? 0] || 0"
                  @update:page="readGroup(group.portfolio?.id ?? 0, $event)"
                />
                <UButton
                  v-if="groupErrors[group.portfolio?.id ?? 0]"
                  color="error"
                  label="读取失败，重试"
                  @click="readGroup(group.portfolio?.id ?? 0, groupPages[group.portfolio?.id ?? 0] || 1)"
                />
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
            v-else-if="!(hosted ? (rootRead.loading.value || rootRead.error.value) : projectStore.loading)"
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
                          v-if="row.portfolio?.defaultCategory"
                          color="primary"
                          variant="subtle"
                          size="xs"
                        >
                          {{ getProjectCategoryLabel(row.portfolio.defaultCategory) }}
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
                          <UBadge
                            v-if="child.project?.oppId"
                            color="primary"
                            variant="outline"
                            size="xs"
                          >
                            Altoc 商机
                          </UBadge>
                        </div>
                      </td>
                      <td class="px-4 py-2.5">
                        <UBadge
                          color="info"
                          variant="subtle"
                          size="xs"
                        >
                          {{ getProjectCategoryLabel(child.category) }}
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
                        <UBadge
                          v-if="row.project?.oppId"
                          color="primary"
                          variant="outline"
                          size="xs"
                        >
                          Altoc 商机
                        </UBadge>
                      </div>
                    </td>
                    <td class="px-4 py-2.5">
                      <UBadge
                        color="info"
                        variant="subtle"
                        size="xs"
                      >
                        {{ getProjectCategoryLabel(row.category) }}
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
          <div v-if="hosted && viewMode === 'list'" class="flex flex-wrap gap-4 px-4 py-3">
            <div v-for="group in groupedProjects" :key="group.portfolio?.id ?? 0" class="flex flex-wrap items-center gap-2">
              <span>{{ group.portfolio?.name || '独立项目' }} · 共 {{ getPortfolioProjectCount(group.portfolio, group.projects) }} 条</span>
              <UPagination
                :sibling-count="0"
                size="xs"
                :page="groupPages[group.portfolio?.id ?? 0] || 1"
                :items-per-page="20"
                :total="groupTotals[group.portfolio?.id ?? 0] || 0"
                @update:page="readGroup(group.portfolio?.id ?? 0, $event)"
              />
              <UButton v-if="groupErrors[group.portfolio?.id ?? 0]" label="重试" @click="readGroup(group.portfolio?.id ?? 0, groupPages[group.portfolio?.id ?? 0] || 1)" />
            </div>
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

        <!-- ========== 编辑项目集弹窗 ========== -->
        <USlideover v-model:open="showEditPortfolioModal" :ui="{ content: 'w-full sm:max-w-2xl' }">
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
              <UFormField label="显示顺序" description="数字越小越靠前">
                <UInput
                  :model-value="String(editPortfolioForm.displayOrder ?? 0)"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  class="w-full"
                  @update:model-value="value => editPortfolioForm.displayOrder = normalizeDisplayOrder(value)"
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
              <UFormField
                label="默认项目分类"
                help="归属该项目集的新项目会预设为此分类，创建时仍可调整。留空表示不预设。"
              >
                <USelectMenu
                  v-model="editPortfolioForm.defaultCategory"
                  :items="selectableProjectCategoryOptions"
                  value-key="value"
                  placeholder="不预设"
                  class="w-full"
                  :disabled="currentEditingPortfolio?.isSystem === true"
                />
                <p
                  v-if="currentEditingPortfolio?.isSystem"
                  class="mt-1 text-xs text-muted"
                >
                  系统预置项目集，默认分类不可修改。
                </p>
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
                @click="handleDeletePortfolio"
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
        </USlideover>

        <!-- ========== 设置项目所属项目集弹窗 ========== -->
        <UModal v-model:open="showAssignPortfolioModal" :ui="{ content: 'w-lg' }">
          <template #header>
            <h3 class="text-lg font-semibold">
              设置项目集 — {{ assigningProject?.name }}
            </h3>
          </template>
          <template #body>
            <div class="space-y-4">
              <div v-if="hosted" class="space-y-2">
                <UInput v-model="assignmentSearch" placeholder="搜索项目集名称" class="w-full" />
                <span class="text-xs text-muted">共 {{ assignmentRead.data.value?.total || 0 }} 条</span>
                <UPagination
                  :sibling-count="0"
                  size="xs"
                  :page="assignmentPage"
                  :items-per-page="20"
                  :total="assignmentRead.data.value?.total || 0"
                  @update:page="readAssignmentRoots"
                />
                <UButton v-if="assignmentRead.error.value" label="读取失败，重试" @click="readAssignmentRoots(assignmentPage)" />
              </div>
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
                :disabled="hosted && (assignmentRead.loading.value || assignmentRead.error.value)"
                @click="handleAssignPortfolio"
              />
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
@container (min-width: 56rem) {
  .projects-page-grid.is-hosted {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
