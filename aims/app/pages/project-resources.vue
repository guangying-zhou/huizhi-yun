<script setup lang="ts">
import { projectStatusOptions } from '~/config/project'
import type { AimsProject, LifecycleStatus, ProjectMember } from '~/types/aims'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目资源',
  layoutHeaderProjectSwitcher: false
})

type ResourceNodeType = 'dept' | 'user' | 'project'
type MemberScope = 'leaders' | 'all'

interface ResourceAssignment {
  deptCode: string
  deptName: string
  uid: string
  userName: string
  role: string
  projectId: number
  projectName: string
  projectCode: string
}

interface SankeyNode {
  name: string
  label: string
  type: ResourceNodeType
  code: string
  itemStyle: {
    color: string
  }
}

interface SankeyLink {
  source: string
  target: string
  value: number
  relation: string
}

const projectStore = useProjectStore()
const portfolioStore = usePortfolioStore()
const { users: accountUsers, loading: usersLoading, refresh: refreshUsers } = useAccountUsers({ pageSize: 1000 })
const { departments, loading: departmentsLoading, refresh: refreshDepartments } = useAccountDepartments()

const chartEl = ref<HTMLElement | null>(null)
const loading = ref(false)
const selectedNodeId = ref<string | null>(null)
const statusFilter = ref<'all' | LifecycleStatus>('active')
const portfolioFilter = ref<'all' | number | 0>('all')
const memberScope = ref<MemberScope>('leaders')
const search = ref('')
const projects = ref<AimsProject[]>([])
const membersByProject = ref<Record<number, ProjectMember[]>>({})

let echartsApi: typeof import('echarts') | null = null
let chart: ReturnType<typeof import('echarts').init> | null = null

const statusItems = computed(() => [
  { label: '全部阶段', value: 'all' },
  ...projectStatusOptions
])

const portfolioItems = computed(() => [
  { label: '全部项目集', value: 'all' },
  { label: '未分组项目', value: 0 },
  ...portfolioStore.portfolios.map(portfolio => ({
    label: portfolio.name,
    value: portfolio.id
  }))
])

const memberScopeItems = [
  { label: '负责人', value: 'leaders' },
  { label: '全部成员', value: 'all' }
]

const userMap = computed(() => {
  const map = new Map<string, typeof accountUsers.value[number]>()
  for (const user of accountUsers.value) {
    if (user.uid && !map.has(user.uid)) map.set(user.uid, user)
  }
  return map
})

const departmentNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const dept of departments.value?.flat || []) {
    if (dept.deptCode) map.set(dept.deptCode, dept.name)
  }
  return map
})

const filteredProjects = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return projects.value
    .filter(project => project.canAccess !== false)
    .filter((project) => {
      if (!keyword) return true
      return [
        project.name,
        project.shortName,
        project.projectCode,
        project.leaderUid || ''
      ].some(value => String(value || '').toLowerCase().includes(keyword))
    })
})

const assignments = computed<ResourceAssignment[]>(() => {
  const rows: ResourceAssignment[] = []
  const seen = new Set<string>()

  for (const project of filteredProjects.value) {
    const members = (membersByProject.value[project.id] || []).filter(member => member.status === 'active')
    const projectLeader = project.leaderUid
      ? {
        id: -project.id,
        projectId: project.id,
        uid: project.leaderUid,
        role: 'manager',
        status: 'active',
        joinedAt: '',
        realName: undefined,
        avatar: null
      } satisfies ProjectMember
      : null
    const projectMembers = memberScope.value === 'leaders'
      ? (projectLeader ? [projectLeader] : members.filter(member => member.role === 'manager'))
      : [...members]

    if (memberScope.value === 'all' && projectLeader && !projectMembers.some(member => member.uid === projectLeader.uid)) {
      projectMembers.push(projectLeader)
    }

    for (const member of projectMembers) {
      if (!member.uid) continue
      const key = `${member.uid}:${project.id}`
      if (seen.has(key)) continue
      seen.add(key)

      const directoryUser = userMap.value.get(member.uid)
      const deptCode = directoryUser?.deptCode
        || directoryUser?.department?.code
        || project.deptCode
        || 'unassigned'
      const deptName = directoryUser?.deptName
        || (deptCode !== 'unassigned' ? departmentNameMap.value.get(deptCode) : '')
        || (deptCode === 'unassigned' ? '未归属部门' : deptCode)

      rows.push({
        deptCode,
        deptName,
        uid: member.uid,
        userName: directoryUser?.realName?.trim() || member.realName || member.uid,
        role: member.role,
        projectId: project.id,
        projectName: project.shortName || project.name,
        projectCode: project.projectCode
      })
    }
  }

  return rows
})

const graph = computed(() => {
  const nodes = new Map<string, SankeyNode>()
  const links = new Map<string, SankeyLink>()

  function addNode(node: SankeyNode) {
    if (!nodes.has(node.name)) nodes.set(node.name, node)
  }

  function addLink(link: SankeyLink) {
    const key = `${link.source}->${link.target}`
    if (!links.has(key)) links.set(key, link)
  }

  for (const row of assignments.value) {
    const deptId = `dept:${row.deptCode}`
    const userId = `user:${row.uid}`
    const projectId = `project:${row.projectId}`

    addNode({
      name: deptId,
      label: row.deptName,
      type: 'dept',
      code: row.deptCode,
      itemStyle: { color: '#0891b2' }
    })
    addNode({
      name: userId,
      label: row.userName,
      type: 'user',
      code: row.uid,
      itemStyle: { color: '#7c3aed' }
    })
    addNode({
      name: projectId,
      label: row.projectName,
      type: 'project',
      code: row.projectCode,
      itemStyle: { color: '#f97316' }
    })

    addLink({
      source: deptId,
      target: userId,
      value: 1,
      relation: '部门成员'
    })
    addLink({
      source: userId,
      target: projectId,
      value: 1,
      relation: row.role === 'manager' ? '项目负责人' : '项目成员'
    })
  }

  return {
    nodes: [...nodes.values()],
    links: [...links.values()]
  }
})

const graphColumnCounts = computed(() => {
  return graph.value.nodes.reduce((counts, node) => {
    counts[node.type] += 1
    return counts
  }, { dept: 0, user: 0, project: 0 } as Record<ResourceNodeType, number>)
})

const chartCanvasStyle = computed(() => {
  const maxColumnNodes = Math.max(graphColumnCounts.value.dept, graphColumnCounts.value.user, graphColumnCounts.value.project)
  const height = Math.max(520, maxColumnNodes * 18 + 120)
  return {
    height: `${height}px`,
    minWidth: selectedNode.value ? '900px' : 'min(900px, 100%)'
  }
})

const selectedNode = computed(() => {
  if (!selectedNodeId.value) return null
  return graph.value.nodes.find(node => node.name === selectedNodeId.value) || null
})

const selectedAssignments = computed(() => {
  const node = selectedNode.value
  if (!node) return []
  let rows: ResourceAssignment[] = []
  if (node.type === 'dept') rows = assignments.value.filter(item => item.deptCode === node.code)
  else if (node.type === 'user') rows = assignments.value.filter(item => item.uid === node.code)
  else rows = assignments.value.filter(item => item.projectCode === node.code)

  return sortSelectedAssignments(rows, node.type)
})

const selectedContextItems = computed(() => {
  const node = selectedNode.value
  if (!node) return []

  const rows = selectedAssignments.value
  if (node.type === 'dept') {
    return [
      { label: '人员', value: `${new Set(rows.map(item => item.uid)).size} 人` },
      { label: '项目', value: `${new Set(rows.map(item => item.projectId)).size} 个` }
    ]
  }

  if (node.type === 'user') {
    const dept = getUserDept(node.code, rows[0]?.deptCode)
    const { managed, participated } = getUserProjectEntries(node.code)
    return [
      { label: '归属部门', value: dept.name },
      { label: '负责项目', value: `${managed.length} 个` },
      { label: '参与项目', value: `${participated.length} 个` }
    ]
  }

  const project = filteredProjects.value.find(item => item.projectCode === node.code)
  const members = project ? getProjectMembers(project) : []
  const managers = project
    ? uniqueSorted(members
        .filter(member => project.leaderUid === member.uid || member.role === 'manager')
        .map(member => getUserName(member.uid, member.realName)))
    : uniqueSorted(rows.filter(item => item.role === 'manager').map(item => item.userName))

  return [
    { label: '项目经理', value: managers.join('、') || '未设置' },
    { label: '所属部门', value: getDeptName(project?.deptCode || rows[0]?.deptCode) }
  ]
})

const summary = computed(() => {
  return {
    departments: new Set(assignments.value.map(item => item.deptCode)).size,
    people: new Set(assignments.value.map(item => item.uid)).size,
    projects: new Set(assignments.value.map(item => item.projectId)).size,
    links: assignments.value.length
  }
})

const loadingAny = computed(() => loading.value || usersLoading.value || departmentsLoading.value)

function nodeTypeLabel(type: ResourceNodeType) {
  if (type === 'dept') return '部门'
  if (type === 'user') return '人员'
  return '项目'
}

function roleLabel(role: string) {
  if (role === 'manager') return '负责人'
  if (role === 'member') return '成员'
  if (role === 'viewer') return '查看'
  return role
}

function roleRank(role: string) {
  if (role === 'manager') return 0
  if (role === 'member') return 1
  if (role === 'viewer') return 2
  return 3
}

function sortSelectedAssignments(rows: ResourceAssignment[], nodeType: ResourceNodeType) {
  return [...rows].sort((left, right) => {
    const roleOrder = roleRank(left.role) - roleRank(right.role)
    if (nodeType === 'project' && roleOrder !== 0) return roleOrder

    if (nodeType === 'dept') {
      return left.userName.localeCompare(right.userName, 'zh-CN')
        || left.projectName.localeCompare(right.projectName, 'zh-CN')
        || roleOrder
    }

    return left.projectName.localeCompare(right.projectName, 'zh-CN')
      || left.userName.localeCompare(right.userName, 'zh-CN')
      || roleOrder
  })
}

function getDeptName(deptCode: string | null | undefined) {
  if (!deptCode || deptCode === 'unassigned') return '未归属部门'
  return departmentNameMap.value.get(deptCode) || deptCode
}

function getUserName(uid: string, fallback?: string | null) {
  const directoryUser = userMap.value.get(uid)
  return directoryUser?.realName?.trim() || fallback || uid
}

function getUserDept(uid: string, fallbackDeptCode?: string | null) {
  const directoryUser = userMap.value.get(uid)
  const deptCode = directoryUser?.deptCode
    || directoryUser?.department?.code
    || fallbackDeptCode
    || 'unassigned'

  return {
    code: deptCode,
    name: directoryUser?.deptName
      || directoryUser?.department?.name
      || getDeptName(deptCode)
  }
}

function getProjectMembers(project: AimsProject) {
  const members = new Map<string, ProjectMember>()
  for (const member of membersByProject.value[project.id] || []) {
    if (!member.uid || member.status !== 'active') continue
    const existing = members.get(member.uid)
    if (!existing || (existing.role !== 'manager' && member.role === 'manager')) {
      members.set(member.uid, member)
    }
  }

  if (project.leaderUid) {
    const existing = members.get(project.leaderUid)
    members.set(project.leaderUid, {
      id: existing?.id ?? -project.id,
      projectId: project.id,
      uid: project.leaderUid,
      role: 'manager',
      status: 'active',
      joinedAt: existing?.joinedAt ?? '',
      realName: existing?.realName,
      avatar: existing?.avatar ?? null
    })
  }

  return [...members.values()]
}

function truncateLabel(value: string, maxLength: number) {
  const text = String(value || '').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function formatNodeLabel(node: Partial<SankeyNode> | undefined, fallback = '') {
  const label = node?.label || fallback
  if (node?.type === 'dept') return truncateLabel(label, 14)
  if (node?.type === 'project') return truncateLabel(label, 18)
  return truncateLabel(label, 6)
}

function escapeHtml(value: string | number | null | undefined) {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  }
  return String(value ?? '').replace(/[&<>"']/g, char => map[char] || char)
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

function tooltipList(values: string[], emptyText = '无') {
  const rows = uniqueSorted(values)
  if (rows.length === 0) {
    return `<div style="color:#71717a;line-height:1.7;">${escapeHtml(emptyText)}</div>`
  }

  const visible = rows.slice(0, 8)
  const hiddenCount = rows.length - visible.length
  return [
    '<div style="display:grid;gap:4px;line-height:1.45;">',
    ...visible.map(item => `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item)}</div>`),
    hiddenCount > 0 ? `<div style="color:#71717a;">另 ${hiddenCount} 项...</div>` : '',
    '</div>'
  ].join('')
}

function tooltipFrame(title: string, subtitle: string, body: string) {
  return [
    '<div style="min-width:260px;max-width:560px;color:#18181b;">',
    `<div style="font-weight:700;font-size:13px;line-height:1.4;">${escapeHtml(title)}</div>`,
    subtitle ? `<div style="margin-top:2px;color:#52525b;font-size:12px;">${escapeHtml(subtitle)}</div>` : '',
    `<div style="margin-top:10px;font-size:12px;">${body}</div>`,
    '</div>'
  ].join('')
}

function tooltipSection(title: string, values: string[]) {
  return [
    '<div style="min-width:0;">',
    `<div style="margin-bottom:6px;color:#27272a;font-weight:600;">${escapeHtml(title)}（${values.length}）</div>`,
    tooltipList(values),
    '</div>'
  ].join('')
}

function departmentTooltip(node: Partial<SankeyNode>) {
  const rows = assignments.value.filter(item => item.deptCode === node.code)
  const people = uniqueSorted(rows.map(item => item.userName))
  const projectsInDept = uniqueSorted(rows.map(item => item.projectName))
  const body = [
    '<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;">',
    tooltipSection('人员', people),
    tooltipSection('项目', projectsInDept),
    '</div>'
  ].join('')

  return tooltipFrame(node.label || '部门', getDeptName(node.code), body)
}

function getUserProjectEntries(uid: string) {
  const managed: string[] = []
  const participated: string[] = []

  for (const project of filteredProjects.value) {
    const member = getProjectMembers(project).find(item => item.uid === uid)
    if (!member) continue

    const projectName = `${project.shortName || project.name} (${project.projectCode})`
    if (project.leaderUid === uid || member.role === 'manager') {
      managed.push(projectName)
    } else {
      participated.push(projectName)
    }
  }

  return {
    managed: uniqueSorted(managed),
    participated: uniqueSorted(participated)
  }
}

function userTooltip(node: Partial<SankeyNode>) {
  const uid = node.code || ''
  const rows = assignments.value.filter(item => item.uid === uid)
  const fallbackDeptCode = rows[0]?.deptCode
  const dept = getUserDept(uid, fallbackDeptCode)
  const { managed, participated } = getUserProjectEntries(uid)
  const body = [
    '<div style="display:grid;gap:8px;">',
    `<div><span style="color:#52525b;">归属部门：</span>${escapeHtml(dept.name)}</div>`,
    `<div><span style="color:#52525b;">负责项目：</span>${managed.length} 个</div>`,
    tooltipList(managed),
    `<div style="margin-top:4px;"><span style="color:#52525b;">参与项目：</span>${participated.length} 个</div>`,
    tooltipList(participated),
    '</div>'
  ].join('')

  return tooltipFrame(node.label || getUserName(uid), uid, body)
}

function projectTooltip(node: Partial<SankeyNode>) {
  const project = filteredProjects.value.find(item => item.projectCode === node.code)
  if (!project) {
    return tooltipFrame(node.label || '项目', node.code || '', '')
  }

  const members = getProjectMembers(project)
  const managers = members
    .filter(member => project.leaderUid === member.uid || member.role === 'manager')
    .map(member => getUserName(member.uid, member.realName))
  const memberNames = members.map((member) => {
    const userName = getUserName(member.uid, member.realName)
    return `${userName} (${roleLabel(project.leaderUid === member.uid ? 'manager' : member.role)})`
  })

  const body = [
    '<div style="display:grid;gap:8px;">',
    `<div><span style="color:#52525b;">项目经理：</span>${escapeHtml(uniqueSorted(managers).join('、') || '未设置')}</div>`,
    `<div><span style="color:#52525b;">部门：</span>${escapeHtml(getDeptName(project.deptCode))}</div>`,
    `<div style="margin-top:4px;color:#27272a;font-weight:600;">项目成员（${memberNames.length}）</div>`,
    tooltipList(memberNames),
    '</div>'
  ].join('')

  return tooltipFrame(project.shortName || project.name, project.projectCode, body)
}

function tooltipPosition(
  point: number[],
  _params: unknown,
  _dom: HTMLElement,
  _rect: unknown,
  size: { viewSize: number[], contentSize: number[] }
) {
  const gap = 12
  const viewWidth = size.viewSize[0] ?? 0
  const viewHeight = size.viewSize[1] ?? 0
  const contentWidth = size.contentSize[0] ?? 0
  const contentHeight = size.contentSize[1] ?? 0
  const x = Math.min((point[0] ?? 0) + gap, Math.max(gap, viewWidth - contentWidth - gap))
  const y = Math.min((point[1] ?? 0) + gap, Math.max(gap, viewHeight - contentHeight - gap))
  return [Math.max(gap, x), Math.max(gap, y)]
}

function chartTooltip(params: { dataType?: string, data?: Partial<SankeyNode & SankeyLink>, name?: string }) {
  const data = params.data || {}
  if (params.dataType === 'edge') {
    return tooltipFrame(data.relation || '关系', '权重：1', '')
  }
  const node = data as Partial<SankeyNode>
  if (node.type === 'dept') return departmentTooltip(node)
  if (node.type === 'user') return userTooltip(node)
  if (node.type === 'project') return projectTooltip(node)
  return tooltipFrame(node.label || params.name || '', node.type ? nodeTypeLabel(node.type) : '', '')
}

async function ensureChart() {
  if (!import.meta.client || !chartEl.value) return null
  if (!echartsApi) {
    echartsApi = await import('echarts')
  }
  if (!chart) {
    chart = echartsApi.init(chartEl.value, undefined, { renderer: 'svg' })
    chart.on('click', (params) => {
      const event = params as { dataType?: string, data?: { name?: string } | null }
      if (event.dataType !== 'node' || !event.data?.name) return
      selectedNodeId.value = event.data.name
    })
  }
  return chart
}

async function renderChart() {
  const instance = await ensureChart()
  if (!instance) return

  instance.setOption({
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove',
      confine: true,
      enterable: true,
      backgroundColor: '#ffffff',
      borderColor: '#d4d4d8',
      borderWidth: 1,
      textStyle: {
        color: '#18181b'
      },
      extraCssText: 'max-width: 580px; max-height: 320px; overflow-y: auto; white-space: normal; border-radius: 8px; color: #18181b; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);',
      position: tooltipPosition,
      formatter: chartTooltip
    },
    series: [
      {
        type: 'sankey',
        data: graph.value.nodes,
        links: graph.value.links,
        nodeAlign: 'justify',
        left: 28,
        right: 96,
        top: 32,
        bottom: 32,
        nodeWidth: 14,
        nodeGap: 9,
        layoutIterations: 64,
        draggable: true,
        emphasis: {
          focus: 'adjacency'
        },
        labelLayout: {
          hideOverlap: true
        },
        label: {
          color: 'currentColor',
          fontSize: 11,
          overflow: 'truncate',
          width: 96,
          formatter: (params: { data?: Partial<SankeyNode>, name?: string }) => formatNodeLabel(params.data, params.name || '')
        },
        lineStyle: {
          color: 'gradient',
          opacity: 0.28,
          curveness: 0.5
        }
      }
    ]
  }, true)
}

async function loadResources() {
  loading.value = true
  try {
    await projectStore.fetchProjects({
      lifecycleStatus: statusFilter.value !== 'all' ? statusFilter.value : undefined,
      portfolioId: portfolioFilter.value !== 'all' ? Number(portfolioFilter.value) : undefined,
      pageSize: 500
    })
    projects.value = [...projectStore.projects]
      .sort((left, right) => (left.shortName || left.name).localeCompare(right.shortName || right.name, 'zh-CN'))

    const nextMembers: Record<number, ProjectMember[]> = {}
    const targets = projects.value.filter(project => project.canAccess !== false)
    for (let index = 0; index < targets.length; index += 8) {
      const chunk = targets.slice(index, index + 8)
      const results = await Promise.allSettled(chunk.map(project => projectStore.fetchMembers(project.id)))
      results.forEach((result, offset) => {
        if (result.status === 'fulfilled') {
          nextMembers[chunk[offset]!.id] = result.value
        }
      })
    }
    membersByProject.value = nextMembers
  } finally {
    loading.value = false
    await nextTick()
    await renderChart()
  }
}

function resetAndLoad() {
  selectedNodeId.value = null
  loadResources()
}

watch([statusFilter, portfolioFilter, memberScope], resetAndLoad)
watch([graph, selectedNodeId], () => {
  renderChart()
}, { deep: true })

useResizeObserver(chartEl, () => {
  chart?.resize()
})

onMounted(async () => {
  await Promise.all([
    refreshUsers(),
    refreshDepartments(),
    portfolioStore.fetchPortfolios().catch(() => {})
  ])
  await loadResources()
})

onBeforeUnmount(() => {
  chart?.dispose()
  chart = null
})
</script>

<template>
  <UDashboardPanel id="project-resources" :ui="{ root: 'relative flex min-w-0 shrink-0 flex-col h-full', body: 'flex min-h-0 flex-1 flex-col p-0 overflow-hidden' }">
    <template #body>
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="border-b border-default px-2 py-2">
          <!-- <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="text-xs font-semibold tracking-[0.28em] text-primary uppercase">
                Project Resources
              </div>
              <h1 class="mt-1 text-2xl font-bold text-highlighted">
                项目资源
              </h1>
              <p class="mt-1 text-sm text-muted">
                按部门、人员、项目展示资源关系；当前链路权重统一为 1。
              </p>
            </div>
            <UButton
              icon="i-lucide-refresh-cw"
              label="刷新"
              color="neutral"
              variant="ghost"
              :loading="loadingAny"
              @click="resetAndLoad"
            />
          </div> -->

          <div class="mt-5 grid gap-3 lg:grid-cols-[160px_200px_150px_minmax(240px,1fr)_auto]">
            <USelect
              v-model="statusFilter"
              :items="statusItems"
            />
            <USelect
              v-model="portfolioFilter"
              :items="portfolioItems"
            />
            <USelect
              v-model="memberScope"
              :items="memberScopeItems"
            />
            <UInput
              v-model="search"
              icon="i-lucide-search"
              placeholder="搜索项目名称 / 编码 / 负责人"
              @keydown.enter="renderChart"
            />
            <UButton
              icon="i-lucide-search"
              label="筛选"
              color="primary"
              @click="renderChart"
            />
          </div>
        </div>

        <div class="grid gap-3 px-2 py-4 md:grid-cols-4">
          <div class="rounded-lg border border-default bg-muted/30 px-4 py-3">
            <div class="text-xs text-muted">
              部门
            </div>
            <div class="mt-1 text-xl font-semibold text-highlighted">
              {{ summary.departments }}
            </div>
          </div>
          <div class="rounded-lg border border-default bg-muted/30 px-4 py-3">
            <div class="text-xs text-muted">
              人员
            </div>
            <div class="mt-1 text-xl font-semibold text-highlighted">
              {{ summary.people }}
            </div>
          </div>
          <div class="rounded-lg border border-default bg-muted/30 px-4 py-3">
            <div class="text-xs text-muted">
              项目
            </div>
            <div class="mt-1 text-xl font-semibold text-highlighted">
              {{ summary.projects }}
            </div>
          </div>
          <div class="rounded-lg border border-default bg-muted/30 px-4 py-3">
            <div class="text-xs text-muted">
              人员-项目关系
            </div>
            <div class="mt-1 text-xl font-semibold text-highlighted">
              {{ summary.links }}
            </div>
          </div>
        </div>

        <div
          class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden"
          :class="selectedNode ? 'lg:grid-cols-[minmax(0,1fr)_18rem]' : ''"
        >
          <main class="min-h-0 overflow-hidden p-2">
            <div class="relative h-full min-h-[34rem] overflow-auto rounded-lg border border-default bg-default">
              <div
                ref="chartEl"
                class="w-full"
                :style="chartCanvasStyle"
              />
              <div
                v-if="loadingAny"
                class="absolute inset-0 flex items-center justify-center bg-default/70"
              >
                <UIcon name="i-lucide-loader-2" class="size-7 animate-spin text-muted" />
              </div>
              <div
                v-else-if="graph.nodes.length === 0"
                class="absolute inset-0 flex items-center justify-center text-sm text-muted"
              >
                当前条件下没有可展示的资源关系。
              </div>
            </div>
          </main>

          <aside
            v-if="selectedNode"
            class="min-h-0 overflow-y-auto border-t border-default bg-muted/20 p-4 lg:border-t-0 lg:border-l"
          >
            <div class="space-y-4">
              <div>
                <!-- <UBadge color="primary" variant="subtle" size="xs">
                  {{ nodeTypeLabel(selectedNode.type) }}
                </UBadge> -->
                <h2 class="mt-2 text-lg font-semibold text-highlighted">
                  {{ selectedNode.label }}
                </h2>
                <p class="mt-1 text-xs text-muted">
                  {{ selectedNode.code }}
                </p>
              </div>

              <div v-if="selectedContextItems.length" class="grid gap-2">
                <div
                  v-for="context in selectedContextItems"
                  :key="context.label"
                  class="rounded-lg border border-default bg-default px-3 py-2"
                >
                  <div class="text-xs text-muted">
                    {{ context.label }}
                  </div>
                  <div class="mt-1 truncate text-sm font-medium text-highlighted">
                    {{ context.value }}
                  </div>
                </div>
              </div>

              <div class="rounded-lg border border-default bg-default px-3 py-2">
                <div class="text-xs text-muted">
                  明细数量
                </div>
                <div class="mt-1 text-lg font-semibold text-highlighted">
                  {{ selectedAssignments.length }}
                </div>
              </div>

              <div class="space-y-2">
                <div class="text-sm font-medium text-highlighted">
                  明细
                </div>
                <div
                  v-for="item in selectedAssignments"
                  :key="`${item.uid}-${item.projectId}`"
                  class="rounded-lg border border-default bg-default p-3"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div v-if="selectedNode.type === 'project'" class="min-w-0">
                      <div class="truncate text-sm font-medium text-highlighted">
                        {{ item.userName }}
                      </div>
                      <div class="mt-0.5 text-xs text-muted">
                        {{ item.deptName }}
                      </div>
                    </div>
                    <div v-else-if="selectedNode.type === 'user'" class="min-w-0">
                      <div class="truncate text-sm font-medium text-highlighted">
                        {{ item.projectName }}
                      </div>
                      <div class="mt-0.5 text-xs text-muted">
                        {{ item.projectCode }}
                      </div>
                    </div>
                    <div v-else class="min-w-0">
                      <div class="truncate text-sm font-medium text-highlighted">
                        {{ item.userName }}
                      </div>
                      <div class="mt-0.5 truncate text-xs text-muted">
                        {{ item.projectName }}
                      </div>
                    </div>
                    <UBadge
                      :color="item.role === 'manager' ? 'primary' : 'neutral'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ roleLabel(item.role) }}
                    </UBadge>
                  </div>
                  <div v-if="selectedNode.type === 'dept'" class="mt-2 text-xs text-muted">
                    {{ item.projectCode }}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
