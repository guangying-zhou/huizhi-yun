<script setup lang="ts">
usePageTitle('成员权限')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface MemberListItem {
  id: number
  uid: string
  subjectCode: string
  displayName: string
  status: string
  activeRoleCount: number
}

interface MemberListResponse {
  items: MemberListItem[]
  total: number
  page: number
  pageSize: number
}

interface MemberDetailRole {
  roleCode: string
  roleName: string
  roleType: string
  source: string
  category: string
  sourceTypes: string[]
  subjectTypes: string[]
  permissionCount: number
}

interface MemberDirectAssignment {
  id: number
  roleId: number
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  roleSource: string
  category: string
  sourceType: string
  sourceId: string | null
  assignmentKind: string
  reason: string | null
  grantedByUid: string | null
  grantedAt: string
  startsAt: string | null
  expiredAt: string | null
  status: string
  active: boolean
}

interface MemberDetailPermission {
  appCode: string
  resourceCode: string
  action: string
  sources: Array<{
    roleCode: string | null
    sourceType: string
    scopes: string[]
  }>
}

interface MemberDetailResponse {
  member: MemberListItem
  simulation: {
    authorizationMode: string
    activeRoleCode: string | null
    includeBaseline: boolean
    selectedRoleCodes: string[]
    availableRoleCodes: string[]
  }
  memberships: Array<{
    subjectType: string
    subjectCode: string
    displayName: string
    relationType: string
    primary: boolean
  }>
  roles: MemberDetailRole[]
  directAssignments: MemberDirectAssignment[]
  permissions: MemberDetailPermission[]
}

interface AssignableRoleItem {
  id: number
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  source: string
  sourceRoleCode: string | null
  status: string
  permissionCount: number
}

interface AssignableRoleResponse {
  items: AssignableRoleItem[]
  total: number
}

interface RoleConflictWarning {
  ruleCode: string
  message: string
}

interface SubjectRoleAssignmentResponse {
  id: number
  roleConflictWarnings?: RoleConflictWarning[]
}

interface AuthorizationExplainScope {
  dimension: string
  predicate: string
  value: string | null
  source: string
}

interface AuthorizationExplainGrant {
  grantId: string
  roleCode: string | null
  subjectType: string
  sourceType: string
  permission: {
    appCode: string
    resourceCode: string
    action: string
  }
  scopeMatched: boolean
  defaultScopes: AuthorizationExplainScope[]
  assignmentScopes: AuthorizationExplainScope[]
  relationScopes: AuthorizationExplainScope[]
}

interface AuthorizationExplainResponse {
  allowed: boolean
  reasonCode: string
  matchedAction: string | null
  matchedGrant: AuthorizationExplainGrant | null
  candidateGrants: AuthorizationExplainGrant[]
  selectedRoleCodes: string[]
}

interface PeopleLifecycleAuditItem {
  id: number
  uid: string
  operatorUid: string | null
  action: string
  source: string | null
  status: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  createdAt: string
}

interface PeopleLifecycleAuditResponse {
  items: PeopleLifecycleAuditItem[]
  total: number
  page: number
  pageSize: number
}

type AuthorizationSimulationMode = 'role_simulation' | 'user_simulation'

interface ConsoleAuthorizationSimulationSession {
  active: boolean
  sid: string | null
  mode: AuthorizationSimulationMode | null
  actorUid: string | null
  roleCode: string | null
  subjectCode: string | null
  includeBaseline: boolean
  reason: string | null
  issuedAt: string | null
  expiresAt: string | null
}

interface ConsoleAuthorizationSimulationResponse {
  code: number
  data?: Partial<ConsoleAuthorizationSimulationSession>
}

type BadgeColor = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

const ALL_EFFECTIVE_ROLES_VALUE = '__all_effective_roles__'
const ASSIGNMENT_KIND_ITEMS = [
  { label: '主岗位', value: 'position' },
  { label: '附加职责', value: 'duty' },
  { label: '临时授权', value: 'temporary' },
  { label: '高风险特权', value: 'privileged' }
]

function inactiveConsoleSimulation(): ConsoleAuthorizationSimulationSession {
  return {
    active: false,
    sid: null,
    mode: null,
    actorUid: null,
    roleCode: null,
    subjectCode: null,
    includeBaseline: true,
    reason: null,
    issuedAt: null,
    expiresAt: null
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizeConsoleSimulation(data: Partial<ConsoleAuthorizationSimulationSession> | null | undefined): ConsoleAuthorizationSimulationSession {
  if (!data?.active) return inactiveConsoleSimulation()
  const mode = data.mode === 'user_simulation' ? 'user_simulation' : 'role_simulation'
  return {
    active: true,
    sid: stringValue(data.sid) || null,
    mode,
    actorUid: stringValue(data.actorUid) || null,
    roleCode: stringValue(data.roleCode) || null,
    subjectCode: stringValue(data.subjectCode) || null,
    includeBaseline: data.includeBaseline !== false,
    reason: stringValue(data.reason) || null,
    issuedAt: stringValue(data.issuedAt) || null,
    expiresAt: stringValue(data.expiresAt) || null
  }
}

function statusCode(error: unknown) {
  const typedError = error as {
    status?: number
    statusCode?: number
    response?: { status?: number, statusCode?: number }
  } | null | undefined
  return Number(typedError?.statusCode || typedError?.status || typedError?.response?.statusCode || typedError?.response?.status || 0)
}

const { currentTenantCode } = useTenantContext()
const toast = useToast()
const tenantCode = computed(() => String(currentTenantCode.value || '').trim())

const members = ref<MemberListItem[]>([])
const assignableRoles = ref<AssignableRoleItem[]>([])
const memberTotal = ref(0)
const memberKeyword = ref('')
const selectedUid = ref('')
const detail = ref<MemberDetailResponse | null>(null)
const explainResult = ref<AuthorizationExplainResponse | null>(null)
const lifecycleAudits = ref<PeopleLifecycleAuditItem[]>([])
const lifecycleAuditTotal = ref(0)
const lifecycleAuditPage = ref(1)
const lifecycleAuditPageSize = 5
const consoleSimulation = ref<ConsoleAuthorizationSimulationSession>(inactiveConsoleSimulation())
const selectedRoleCode = ref(ALL_EFFECTIVE_ROLES_VALUE)
const localRoleSimulationIncludeBaseline = ref(true)
const selectedAssignableRoleId = ref('')
const pending = reactive({
  members: false,
  detail: false,
  explain: false,
  lifecycleAudits: false,
  consoleSimulation: false,
  assignableRoles: false,
  assignment: false
})
const assignmentForm = reactive({
  assignmentKind: 'duty',
  expiredAt: '',
  reason: ''
})
const explainForm = reactive({
  appCode: '',
  resourceCode: '',
  action: 'view',
  ownerUid: '',
  departmentCode: '',
  departmentTree: '',
  projectCode: '',
  projectMemberUids: '',
  customerOwnerUid: '',
  customerTeamUids: '',
  assignedUid: '',
  assignedUids: '',
  matchedRelations: '',
  environment: '',
  deploymentEnvironment: ''
})

const roleSimulationOptions = computed(() => [
  { label: '全部有效角色', value: ALL_EFFECTIVE_ROLES_VALUE },
  ...(detail.value?.simulation.availableRoleCodes || []).map(roleCode => ({
    label: roleCode,
    value: roleCode
  }))
])
const assignableRoleOptions = computed(() => assignableRoles.value.map(role => ({
  label: `${role.roleName} / ${role.roleCode}`,
  value: String(role.id)
})))
const activeSimulationRoleCode = computed(() =>
  selectedRoleCode.value && selectedRoleCode.value !== ALL_EFFECTIVE_ROLES_VALUE
    ? selectedRoleCode.value
    : ''
)
const globalSimulationRoleCode = computed(() =>
  consoleSimulation.value.active && consoleSimulation.value.mode === 'role_simulation'
    ? consoleSimulation.value.roleCode || ''
    : ''
)
const globalSimulationSubjectCode = computed(() =>
  consoleSimulation.value.active && consoleSimulation.value.mode === 'user_simulation'
    ? consoleSimulation.value.subjectCode || ''
    : ''
)
const effectiveSimulationRoleCode = computed(() => globalSimulationRoleCode.value || activeSimulationRoleCode.value)
const effectiveAuthorizationMode = computed(() => {
  if (consoleSimulation.value.active && consoleSimulation.value.mode === 'user_simulation') return 'user_simulation'
  if (effectiveSimulationRoleCode.value) return 'role_simulation'
  return 'merged'
})
const effectiveIncludeBaseline = computed(() => {
  if (consoleSimulation.value.active && consoleSimulation.value.mode === 'role_simulation') return consoleSimulation.value.includeBaseline
  if (activeSimulationRoleCode.value) return localRoleSimulationIncludeBaseline.value
  return true
})
const roleSelectDisabled = computed(() => !detail.value || Boolean(globalSimulationRoleCode.value))
const baselineToggleDisabled = computed(() => !detail.value || Boolean(globalSimulationRoleCode.value) || !activeSimulationRoleCode.value)
const consoleSimulationTitle = computed(() => {
  if (!consoleSimulation.value.active) return ''
  return consoleSimulation.value.mode === 'user_simulation'
    ? `Console 全局用户模拟：${consoleSimulation.value.subjectCode || '未指定用户'}`
    : `Console 全局角色模拟：${consoleSimulation.value.roleCode || '未指定角色'}`
})
const consoleSimulationDescription = computed(() => {
  if (!consoleSimulation.value.active) return ''
  const parts = [
    consoleSimulation.value.actorUid ? `创建人 ${consoleSimulation.value.actorUid}` : '',
    consoleSimulation.value.includeBaseline ? '包含 baseline' : '不包含 baseline',
    consoleSimulation.value.expiresAt ? `过期 ${consoleSimulation.value.expiresAt}` : '',
    consoleSimulation.value.reason ? `原因：${consoleSimulation.value.reason}` : ''
  ].filter(Boolean)
  return parts.join('；')
})
const permissionGroups = computed(() => {
  const groups = new Map<string, MemberDetailPermission[]>()
  for (const permission of detail.value?.permissions || []) {
    const items = groups.get(permission.appCode) || []
    items.push(permission)
    groups.set(permission.appCode, items)
  }
  return Array.from(groups.entries()).map(([appCode, permissions]) => ({ appCode, permissions }))
})
const selectedMember = computed(() => detail.value?.member || members.value.find(item => item.uid === selectedUid.value) || null)
const explainDecisionColor = computed<BadgeColor>(() => explainResult.value?.allowed ? 'success' : 'error')
const activeDirectAssignmentCount = computed(() => detail.value?.directAssignments.filter(item => item.active).length || 0)
const lifecycleAuditTotalPages = computed(() => Math.max(1, Math.ceil(lifecycleAuditTotal.value / lifecycleAuditPageSize)))
const lifecycleAuditVisibleRange = computed(() => {
  if (lifecycleAuditTotal.value <= 0 || lifecycleAudits.value.length === 0) return '0 / 0'
  const start = (lifecycleAuditPage.value - 1) * lifecycleAuditPageSize + 1
  const end = Math.min(lifecycleAuditPage.value * lifecycleAuditPageSize, lifecycleAuditTotal.value)
  return `${start}-${end} / ${lifecycleAuditTotal.value}`
})

function errorMessage(error: unknown, fallback: string) {
  const fetchError = error as { data?: { message?: string, statusMessage?: string }, message?: string }
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || fallback
}

function categoryLabel(category: string) {
  if (category === 'main_position') return '主岗位'
  if (category === 'management_duty') return '管理职责'
  if (category === 'approval_duty') return '审批职责'
  if (category === 'high_risk_privilege') return '高风险特权'
  if (category === 'custom_role') return '自定义角色'
  return '专业职责'
}

function categoryColor(category: string): BadgeColor {
  if (category === 'high_risk_privilege') return 'error'
  if (category === 'approval_duty') return 'warning'
  if (category === 'management_duty') return 'info'
  return 'neutral'
}

function assignmentKindLabel(kind: string) {
  if (kind === 'position') return '主岗位'
  if (kind === 'duty') return '附加职责'
  if (kind === 'temporary') return '临时授权'
  if (kind === 'privileged') return '高风险特权'
  if (kind === 'inherited') return '继承'
  return kind || '未分类'
}

function assignmentKindColor(kind: string): BadgeColor {
  if (kind === 'position') return 'success'
  if (kind === 'temporary') return 'warning'
  if (kind === 'privileged') return 'error'
  if (kind === 'inherited') return 'info'
  return 'neutral'
}

function membershipSubjectTypeLabel(type: string) {
  if (type === 'department') return '部门'
  if (type === 'position') return '岗位'
  if (type === 'project') return '项目'
  if (type === 'team') return '团队'
  return type || '主体'
}

function membershipRelationLabel(type: string) {
  if (type === 'member') return '成员'
  if (type === 'manager') return '负责人'
  if (type === 'leader') return '上级负责人'
  if (type === 'owner') return '所有者'
  return type || '关系'
}

function lifecycleAuditActionLabel(action: string) {
  if (action === 'authorization.user.position.sync.from_people') return 'People 主岗同步'
  if (action === 'authorization.user.offboard.from_people') return 'People 离职回收'
  return action || '生命周期审计'
}

function lifecycleAuditStatusLabel(status: string) {
  if (status === 'synced') return '已同步'
  if (status === 'no_matching_position_role') return '未匹配主岗角色'
  if (status === 'revoked') return '已回收'
  if (status === 'subject_missing') return '主体不存在'
  return status || '已记录'
}

function lifecycleAuditStatusColor(status: string): BadgeColor {
  if (status === 'synced' || status === 'revoked') return 'success'
  if (status === 'no_matching_position_role' || status === 'subject_missing') return 'warning'
  return 'neutral'
}

function lifecycleAuditSummary(item: PeopleLifecycleAuditItem) {
  const after = item.after || {}
  if (item.status === 'synced') {
    const role = after.role && typeof after.role === 'object' && !Array.isArray(after.role)
      ? after.role as Record<string, unknown>
      : {}
    return stringValue(role.roleCode || role.roleName || after.roleCode) || 'People 主岗位授权已同步'
  }
  if (item.status === 'no_matching_position_role') {
    return `候选角色 ${stringValue(after.candidateCount) || '0'} 个`
  }
  if (item.status === 'revoked') {
    return `回收授权 ${stringValue(after.revokedAssignments) || '0'} 个`
  }
  return stringValue(item.source) || '已记录生命周期授权事件'
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function reasonLabel(reasonCode: string) {
  if (reasonCode === 'allowed') return '允许'
  if (reasonCode === 'scope_not_matched') return '权限存在但对象范围不匹配'
  if (reasonCode === 'no_permission') return '没有匹配权限'
  return reasonCode || '未知'
}

function scopeText(scope: AuthorizationExplainScope) {
  const value = scope.value ? `:${scope.value}` : ''
  return `${scope.dimension}:${scope.predicate}${value}`
}

function grantScopeText(grant: AuthorizationExplainGrant) {
  const scopes = [
    ...grant.defaultScopes,
    ...grant.assignmentScopes,
    ...grant.relationScopes
  ]
  return scopes.length ? scopes.map(scope => `${scopeText(scope)} (${scope.source})`).join(' / ') : '无范围限制'
}

function grantSourceLabel(source: { roleCode: string | null, sourceType: string }) {
  if (source.sourceType === 'baseline') return 'baseline'
  return source.roleCode || source.sourceType || 'unknown'
}

function permissionSourceText(permission: MemberDetailPermission) {
  return permission.sources
    .slice(0, 3)
    .map(source => `${grantSourceLabel(source)} / ${source.sourceType}${source.scopes.length ? ` / ${source.scopes.join(', ')}` : ''}`)
    .join('；') || '无来源'
}

async function loadConsoleSimulationSession() {
  if (pending.consoleSimulation) return
  pending.consoleSimulation = true
  try {
    const response = await platformFetchJson<ConsoleAuthorizationSimulationResponse>('/api/v1/console/authorization/simulation-sessions/current')
    consoleSimulation.value = normalizeConsoleSimulation(response.data)
  } catch (error) {
    if (![401, 403, 404].includes(statusCode(error))) {
      console.warn('[MemberPermissions] Failed to load Console authorization simulation session:', error)
    }
    consoleSimulation.value = inactiveConsoleSimulation()
  } finally {
    pending.consoleSimulation = false
  }
}

async function loadAssignableRoles() {
  if (!tenantCode.value) {
    assignableRoles.value = []
    return
  }

  pending.assignableRoles = true
  try {
    const response = await platformFetchJson<ApiEnvelope<AssignableRoleResponse>>('/api/platform/tenant-admin/assignable-roles', {
      query: {
        tenantCode: tenantCode.value,
        page: 1,
        pageSize: 500
      }
    })
    assignableRoles.value = response.data.items
  } catch (error) {
    toast.add({ title: errorMessage(error, '可分配角色加载失败'), color: 'error' })
    assignableRoles.value = []
  } finally {
    pending.assignableRoles = false
  }
}

async function loadMembers() {
  if (!tenantCode.value) {
    members.value = []
    assignableRoles.value = []
    detail.value = null
    lifecycleAudits.value = []
    lifecycleAuditTotal.value = 0
    lifecycleAuditPage.value = 1
    selectedUid.value = ''
    return
  }

  pending.members = true
  try {
    await Promise.all([loadConsoleSimulationSession(), loadAssignableRoles()])
    const response = await platformFetchJson<ApiEnvelope<MemberListResponse>>('/api/platform/tenant-admin/member-permissions', {
      query: {
        tenantCode: tenantCode.value,
        keyword: memberKeyword.value.trim() || undefined,
        page: 1,
        pageSize: 100
      }
    })
    members.value = response.data.items
    memberTotal.value = response.data.total
    const previousUid = selectedUid.value
    const globalSubjectCode = globalSimulationSubjectCode.value
    const nextUid = globalSubjectCode || (selectedUid.value && members.value.some(member => member.uid === selectedUid.value)
      ? selectedUid.value
      : members.value[0]?.uid || '')
    selectedUid.value = nextUid
    if (selectedUid.value && selectedUid.value === previousUid) {
      await loadDetail()
    }
  } catch (error) {
    toast.add({ title: errorMessage(error, '成员权限列表加载失败'), color: 'error' })
    members.value = []
  } finally {
    pending.members = false
  }
}

async function assignRoleToSelectedMember() {
  const roleId = Number(selectedAssignableRoleId.value || 0)
  if (!tenantCode.value || !detail.value?.member.id || !Number.isInteger(roleId) || roleId <= 0) {
    toast.add({ title: '请先选择成员和角色。', color: 'warning' })
    return
  }

  pending.assignment = true
  try {
    const response = await platformFetchJson<ApiEnvelope<SubjectRoleAssignmentResponse>>('/api/platform/tenant-admin/subject-roles', {
      method: 'POST',
      body: {
        tenantCode: tenantCode.value,
        subjectType: 'user',
        subjectId: detail.value.member.id,
        roleId,
        sourceType: 'manual',
        assignmentKind: assignmentForm.assignmentKind,
        expiredAt: assignmentForm.expiredAt || null,
        reason: assignmentForm.reason.trim() || null
      }
    })
    selectedAssignableRoleId.value = ''
    assignmentForm.expiredAt = ''
    assignmentForm.reason = ''

    const warnings = response.data.roleConflictWarnings?.map(warning => warning.message).filter(Boolean) || []
    if (warnings.length > 0) {
      const suffix = warnings.length > 1 ? ` 等 ${warnings.length} 条提示` : ''
      toast.add({ title: `角色已授予；${warnings[0]}${suffix}`, color: 'warning' })
    } else {
      toast.add({ title: '角色已授予', color: 'success' })
    }
    await loadMembers()
  } catch (error) {
    toast.add({ title: errorMessage(error, '授予角色失败'), color: 'error' })
  } finally {
    pending.assignment = false
  }
}

async function revokeDirectAssignment(item: MemberDirectAssignment) {
  if (!item.active || item.sourceType !== 'manual') return

  pending.assignment = true
  try {
    await platformFetchJson<ApiEnvelope<{ id: number, revoked: boolean }>>(`/api/platform/tenant-admin/subject-roles/${item.id}`, {
      method: 'DELETE',
      query: {
        tenantCode: tenantCode.value
      }
    })
    toast.add({ title: `${item.roleName} 已撤销`, color: 'success' })
    await loadMembers()
  } catch (error) {
    toast.add({ title: errorMessage(error, '撤销角色失败'), color: 'error' })
  } finally {
    pending.assignment = false
  }
}

async function loadDetail() {
  if (!tenantCode.value || !selectedUid.value) {
    detail.value = null
    lifecycleAudits.value = []
    lifecycleAuditTotal.value = 0
    lifecycleAuditPage.value = 1
    return
  }

  pending.detail = true
  explainResult.value = null
  try {
    const simulatedRoleCode = effectiveSimulationRoleCode.value
    const response = await platformFetchJson<ApiEnvelope<MemberDetailResponse>>('/api/platform/tenant-admin/member-permissions', {
      query: {
        tenantCode: tenantCode.value,
        uid: selectedUid.value,
        authorizationMode: effectiveAuthorizationMode.value !== 'merged' ? effectiveAuthorizationMode.value : undefined,
        activeRoleCode: simulatedRoleCode || undefined,
        includeBaseline: effectiveIncludeBaseline.value ? undefined : 'false'
      }
    })
    detail.value = response.data
    const firstPermission = response.data.permissions[0]
    if (firstPermission && (!explainForm.appCode || !explainForm.resourceCode)) {
      explainForm.appCode = firstPermission.appCode
      explainForm.resourceCode = firstPermission.resourceCode
      explainForm.action = firstPermission.action
    }
    if (!explainForm.ownerUid || consoleSimulation.value.mode === 'user_simulation') {
      explainForm.ownerUid = selectedUid.value
    }
    await loadLifecycleAudits()
  } catch (error) {
    toast.add({ title: errorMessage(error, '成员权限详情加载失败'), color: 'error' })
    detail.value = null
    lifecycleAudits.value = []
    lifecycleAuditTotal.value = 0
  } finally {
    pending.detail = false
  }
}

async function loadLifecycleAudits() {
  if (!tenantCode.value || !selectedUid.value) {
    lifecycleAudits.value = []
    lifecycleAuditTotal.value = 0
    lifecycleAuditPage.value = 1
    return
  }

  pending.lifecycleAudits = true
  try {
    const requestedPage = Math.max(1, lifecycleAuditPage.value)
    const response = await platformFetchJson<ApiEnvelope<PeopleLifecycleAuditResponse>>('/api/platform/tenant-admin/lifecycle-audits', {
      query: {
        tenantCode: tenantCode.value,
        uid: selectedUid.value,
        page: requestedPage,
        pageSize: lifecycleAuditPageSize
      }
    })
    lifecycleAudits.value = response.data.items
    lifecycleAuditTotal.value = response.data.total
    lifecycleAuditPage.value = Math.max(1, response.data.page || requestedPage)
    if (lifecycleAuditTotal.value > 0 && lifecycleAudits.value.length === 0 && lifecycleAuditPage.value > 1) {
      lifecycleAuditPage.value = lifecycleAuditTotalPages.value
      await loadLifecycleAudits()
    }
  } catch (error) {
    toast.add({ title: errorMessage(error, '生命周期授权审计加载失败'), color: 'error' })
    lifecycleAudits.value = []
    lifecycleAuditTotal.value = 0
  } finally {
    pending.lifecycleAudits = false
  }
}

async function pageLifecycleAudits(delta: number) {
  if (pending.lifecycleAudits) return
  const nextPage = Math.min(Math.max(1, lifecycleAuditPage.value + delta), lifecycleAuditTotalPages.value)
  if (nextPage === lifecycleAuditPage.value) return
  lifecycleAuditPage.value = nextPage
  await loadLifecycleAudits()
}

function usePermissionForExplain(permission: MemberDetailPermission) {
  explainForm.appCode = permission.appCode
  explainForm.resourceCode = permission.resourceCode
  explainForm.action = permission.action
}

async function runExplain() {
  if (!tenantCode.value || !selectedUid.value) return
  if (!explainForm.appCode.trim() || !explainForm.resourceCode.trim() || !explainForm.action.trim()) {
    toast.add({ title: '请填写 app、resource 和 action。', color: 'warning' })
    return
  }

  pending.explain = true
  try {
    const simulatedRoleCode = effectiveSimulationRoleCode.value
    const response = await platformFetchJson<ApiEnvelope<AuthorizationExplainResponse>>('/api/platform/tenant-admin/authorization-explain', {
      query: {
        tenantCode: tenantCode.value,
        uid: selectedUid.value,
        appCode: explainForm.appCode.trim(),
        resourceCode: explainForm.resourceCode.trim(),
        action: explainForm.action.trim(),
        authorizationMode: effectiveAuthorizationMode.value !== 'merged' ? effectiveAuthorizationMode.value : undefined,
        activeRoleCode: simulatedRoleCode || undefined,
        includeBaseline: effectiveIncludeBaseline.value ? undefined : 'false',
        ownerUid: explainForm.ownerUid.trim() || undefined,
        departmentCode: explainForm.departmentCode.trim() || undefined,
        departmentTree: explainForm.departmentTree.trim() || undefined,
        projectCode: explainForm.projectCode.trim() || undefined,
        projectMemberUids: explainForm.projectMemberUids.trim() || undefined,
        customerOwnerUid: explainForm.customerOwnerUid.trim() || undefined,
        customerTeamUids: explainForm.customerTeamUids.trim() || undefined,
        assignedUid: explainForm.assignedUid.trim() || undefined,
        assignedUids: explainForm.assignedUids.trim() || undefined,
        matchedRelations: explainForm.matchedRelations.trim() || undefined,
        environment: explainForm.environment.trim() || undefined,
        deploymentEnvironment: explainForm.deploymentEnvironment.trim() || undefined
      }
    })
    explainResult.value = response.data
  } catch (error) {
    toast.add({ title: errorMessage(error, '权限解释失败'), color: 'error' })
    explainResult.value = null
  } finally {
    pending.explain = false
  }
}

watch(tenantCode, () => {
  loadMembers()
}, { immediate: true })

watch(selectedUid, () => {
  lifecycleAuditPage.value = 1
  if (!globalSimulationRoleCode.value && activeSimulationRoleCode.value) {
    selectedRoleCode.value = ALL_EFFECTIVE_ROLES_VALUE
    return
  }
  loadDetail()
})

watch(selectedRoleCode, () => {
  if (globalSimulationRoleCode.value) return
  loadDetail()
})

watch(localRoleSimulationIncludeBaseline, () => {
  if (baselineToggleDisabled.value) return
  loadDetail()
})
</script>

<template>
  <UDashboardPanel
    id="tenant-member-permissions"
    class="h-[calc(100dvh-var(--topbar-h,52px)-0.5rem)] min-h-0"
    :ui="{ body: 'console-page flex flex-col min-h-0 overflow-hidden' }"
  >
    <template #body>
      <UAlert
        v-if="!tenantCode"
        color="warning"
        variant="soft"
        icon="i-lucide-building-2"
        title="请先在企业工作台选择企业"
        description="未选择企业时无法加载成员权限。"
      />

      <section class="console-hero">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-highlighted">
              成员权限
            </h1>
            <p class="mt-1 text-sm text-muted">
              按成员查看有效角色、权限来源和对象范围，并在当前页进行内联模拟解释。
            </p>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="pending.members || pending.detail || pending.consoleSimulation"
            @click="loadMembers"
          >
            刷新
          </UButton>
        </div>
      </section>

      <div
        v-if="consoleSimulation.active"
        class="flex flex-col gap-2 sm:flex-row sm:items-start"
      >
        <UAlert
          class="flex-1"
          color="info"
          variant="soft"
          icon="i-lucide-radar"
          :title="consoleSimulationTitle"
          :description="consoleSimulationDescription"
        />
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="pending.members || pending.detail || pending.consoleSimulation"
          @click="loadMembers"
        >
          同步模拟
        </UButton>
      </div>

      <div class="grid flex-1 min-h-0 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <template #header>
            <div class="space-y-3">
              <div>
                <h2 class="text-base font-semibold text-highlighted">
                  成员
                </h2>
                <p class="mt-1 text-sm text-muted">
                  {{ memberTotal }} 个用户主体
                </p>
              </div>
              <UInput
                v-model="memberKeyword"
                icon="i-lucide-search"
                placeholder="搜索姓名 / uid"
                @keyup.enter="loadMembers"
              />
            </div>
          </template>

          <div class="max-h-[calc(100dvh-18rem)] overflow-y-auto p-2">
            <button
              v-for="member in members"
              :key="member.uid"
              type="button"
              class="w-full rounded-lg px-3 py-2 text-left transition hover:bg-muted"
              :class="selectedUid === member.uid ? 'bg-muted ring-1 ring-primary' : ''"
              @click="selectedUid = member.uid"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium text-highlighted">{{ member.displayName }}</span>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  {{ member.activeRoleCount }}
                </UBadge>
              </div>
              <p class="mt-1 truncate font-mono text-xs text-muted">
                {{ member.uid }}
              </p>
            </button>
            <div
              v-if="!pending.members && members.length === 0"
              class="px-3 py-8 text-center text-sm text-muted"
            >
              没有匹配成员。
            </div>
          </div>
        </UCard>

        <div class="min-h-0 overflow-y-auto space-y-4">
          <UCard>
            <template #header>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="text-base font-semibold text-highlighted">
                    {{ selectedMember?.displayName || '未选择成员' }}
                  </h2>
                  <p class="mt-1 font-mono text-xs text-muted">
                    {{ selectedMember?.uid || '选择左侧成员后查看权限' }}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-3">
                  <USelect
                    v-model="selectedRoleCode"
                    class="w-56"
                    :items="roleSimulationOptions"
                    :disabled="roleSelectDisabled"
                  />
                  <UCheckbox
                    v-model="localRoleSimulationIncludeBaseline"
                    label="包含 baseline"
                    :disabled="baselineToggleDisabled"
                  />
                </div>
              </div>
            </template>

            <div
              v-if="pending.detail"
              class="permission-state"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-4 animate-spin"
              />
              正在加载成员权限...
            </div>
            <div
              v-else-if="detail"
              class="grid gap-3 md:grid-cols-3"
            >
              <div class="rounded-lg border border-default bg-muted px-4 py-3">
                <p class="text-xs text-muted">
                  有效角色
                </p>
                <p class="mt-2 text-lg font-semibold text-highlighted">
                  {{ detail.roles.length }}
                </p>
              </div>
              <div class="rounded-lg border border-default bg-muted px-4 py-3">
                <p class="text-xs text-muted">
                  有效权限
                </p>
                <p class="mt-2 text-lg font-semibold text-highlighted">
                  {{ detail.permissions.length }}
                </p>
              </div>
              <div class="rounded-lg border border-default bg-muted px-4 py-3">
                <p class="text-xs text-muted">
                  授权模式
                </p>
                <p class="mt-2 text-sm font-semibold text-highlighted">
                  {{ detail.simulation.authorizationMode }}
                </p>
              </div>
            </div>
          </UCard>

          <UCard v-if="detail">
            <template #header>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="text-base font-semibold text-highlighted">
                    主体关系
                  </h2>
                  <p class="mt-1 text-sm text-muted">
                    {{ detail.memberships.length }} 个部门、岗位或项目关系
                  </p>
                </div>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  memberships
                </UBadge>
              </div>
            </template>

            <div
              v-if="detail.memberships.length > 0"
              class="grid gap-2 lg:grid-cols-2"
            >
              <div
                v-for="membership in detail.memberships"
                :key="`${membership.subjectType}:${membership.subjectCode}:${membership.relationType}`"
                class="rounded-lg border border-default bg-default px-4 py-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-highlighted">{{ membership.displayName }}</span>
                  <UBadge
                    color="neutral"
                    variant="soft"
                  >
                    {{ membershipSubjectTypeLabel(membership.subjectType) }}
                  </UBadge>
                  <UBadge
                    :color="membership.primary ? 'success' : 'info'"
                    variant="soft"
                  >
                    {{ membership.primary ? '主关系' : membershipRelationLabel(membership.relationType) }}
                  </UBadge>
                </div>
                <p class="mt-1 font-mono text-xs text-muted">
                  {{ membership.subjectCode }}
                </p>
                <p class="mt-2 text-xs text-muted">
                  {{ membership.relationType }}
                </p>
              </div>
            </div>
            <div
              v-else
              class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
            >
              当前成员没有有效主体关系。
            </div>
          </UCard>

          <UCard v-if="detail">
            <template #header>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="text-base font-semibold text-highlighted">
                    主岗位与附加职责
                  </h2>
                  <p class="mt-1 text-sm text-muted">
                    {{ activeDirectAssignmentCount }} 个直接授权生效中
                  </p>
                </div>
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  direct assignments
                </UBadge>
              </div>
            </template>

            <div class="space-y-4">
              <form
                class="grid gap-3 xl:grid-cols-[minmax(14rem,1fr)_10rem_13rem_minmax(12rem,1fr)_auto]"
                @submit.prevent="assignRoleToSelectedMember"
              >
                <UFormField
                  label="角色"
                  required
                >
                  <USelect
                    v-model="selectedAssignableRoleId"
                    class="w-full"
                    :items="assignableRoleOptions"
                    :loading="pending.assignableRoles"
                    placeholder="选择可分配角色"
                  />
                </UFormField>
                <UFormField label="类型">
                  <USelect
                    v-model="assignmentForm.assignmentKind"
                    class="w-full"
                    :items="ASSIGNMENT_KIND_ITEMS"
                  />
                </UFormField>
                <UFormField label="过期时间">
                  <UInput
                    v-model="assignmentForm.expiredAt"
                    class="w-full"
                    type="datetime-local"
                  />
                </UFormField>
                <UFormField label="原因">
                  <UInput
                    v-model="assignmentForm.reason"
                    class="w-full"
                    placeholder="可选"
                  />
                </UFormField>
                <div class="flex items-end">
                  <UButton
                    type="submit"
                    icon="i-lucide-user-plus"
                    :loading="pending.assignment"
                    :disabled="!selectedAssignableRoleId || pending.assignableRoles"
                  >
                    授权
                  </UButton>
                </div>
              </form>

              <div
                v-if="!pending.assignableRoles && assignableRoleOptions.length === 0"
                class="rounded-lg border border-dashed border-default bg-muted px-4 py-5 text-center text-sm text-muted"
              >
                当前租户暂无可分配角色。
              </div>

              <div class="grid gap-2 lg:grid-cols-2">
                <div
                  v-for="item in detail.directAssignments"
                  :key="item.id"
                  class="rounded-lg border border-default bg-default px-4 py-3"
                >
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <p class="font-semibold text-highlighted">
                          {{ item.roleName }}
                        </p>
                        <UBadge
                          :color="assignmentKindColor(item.assignmentKind)"
                          variant="soft"
                        >
                          {{ assignmentKindLabel(item.assignmentKind) }}
                        </UBadge>
                        <UBadge
                          :color="item.active ? 'success' : 'neutral'"
                          variant="soft"
                        >
                          {{ item.active ? '生效中' : item.status }}
                        </UBadge>
                      </div>
                      <p class="mt-1 font-mono text-xs text-muted">
                        {{ item.roleCode }}
                      </p>
                      <p class="mt-2 text-xs text-muted">
                        {{ item.sourceType }}<span v-if="item.expiredAt"> · 到期 {{ item.expiredAt }}</span><span v-if="item.reason"> · {{ item.reason }}</span>
                      </p>
                    </div>
                    <UButton
                      v-if="item.active && item.sourceType === 'manual'"
                      color="error"
                      variant="soft"
                      size="sm"
                      icon="i-lucide-ban"
                      :loading="pending.assignment"
                      @click="revokeDirectAssignment(item)"
                    >
                      撤销
                    </UButton>
                  </div>
                </div>
              </div>

              <div
                v-if="detail.directAssignments.length === 0"
                class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
              >
                当前成员没有直接角色授权。
              </div>
            </div>
          </UCard>

          <UCard v-if="detail">
            <template #header>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="text-base font-semibold text-highlighted">
                    生命周期授权审计
                  </h2>
                  <p class="mt-1 text-sm text-muted">
                    显示 {{ lifecycleAuditVisibleRange }} 条 People 主岗同步或离职回收记录
                  </p>
                </div>
                <UButton
                  color="neutral"
                  variant="soft"
                  size="sm"
                  icon="i-lucide-refresh-cw"
                  :loading="pending.lifecycleAudits"
                  @click="loadLifecycleAudits"
                >
                  刷新
                </UButton>
              </div>
            </template>

            <div
              v-if="pending.lifecycleAudits"
              class="permission-state"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-4 animate-spin"
              />
              正在加载生命周期授权审计...
            </div>
            <div
              v-else-if="lifecycleAudits.length > 0"
              class="grid gap-2"
            >
              <div
                v-for="item in lifecycleAudits"
                :key="item.id"
                class="rounded-lg border border-default bg-default px-4 py-3"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-semibold text-highlighted">
                        {{ lifecycleAuditActionLabel(item.action) }}
                      </span>
                      <UBadge
                        :color="lifecycleAuditStatusColor(item.status)"
                        variant="soft"
                      >
                        {{ lifecycleAuditStatusLabel(item.status) }}
                      </UBadge>
                    </div>
                    <p class="mt-1 text-xs text-muted">
                      {{ lifecycleAuditSummary(item) }}
                    </p>
                  </div>
                  <p class="text-xs text-muted">
                    {{ formatDateTime(item.createdAt) }}
                  </p>
                </div>
                <p class="mt-2 text-xs text-muted">
                  operator {{ item.operatorUid || 'system' }}<span v-if="item.source"> · source {{ item.source }}</span>
                </p>
              </div>
              <div
                v-if="lifecycleAuditTotal > lifecycleAuditPageSize"
                class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-default bg-muted px-4 py-3 text-sm text-muted"
              >
                <p>
                  第 {{ lifecycleAuditPage }} / {{ lifecycleAuditTotalPages }} 页
                </p>
                <div class="flex items-center gap-2">
                  <UButton
                    color="neutral"
                    variant="soft"
                    size="sm"
                    icon="i-lucide-chevron-left"
                    :disabled="lifecycleAuditPage <= 1 || pending.lifecycleAudits"
                    @click="pageLifecycleAudits(-1)"
                  >
                    上一页
                  </UButton>
                  <UButton
                    color="neutral"
                    variant="soft"
                    size="sm"
                    trailing-icon="i-lucide-chevron-right"
                    :disabled="lifecycleAuditPage >= lifecycleAuditTotalPages || pending.lifecycleAudits"
                    @click="pageLifecycleAudits(1)"
                  >
                    下一页
                  </UButton>
                </div>
              </div>
            </div>
            <div
              v-else
              class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
            >
              当前成员暂无 People 主岗同步或离职回收记录。
            </div>
          </UCard>

          <UCard v-if="detail">
            <template #header>
              <h2 class="text-base font-semibold text-highlighted">
                角色来源
              </h2>
            </template>
            <div class="grid gap-2 lg:grid-cols-2">
              <div
                v-for="role in detail.roles"
                :key="role.roleCode"
                class="rounded-lg border border-default bg-default px-4 py-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-highlighted">{{ role.roleName }}</span>
                  <UBadge
                    :color="categoryColor(role.category)"
                    variant="soft"
                  >
                    {{ categoryLabel(role.category) }}
                  </UBadge>
                </div>
                <p class="mt-1 font-mono text-xs text-muted">
                  {{ role.roleCode }}
                </p>
                <p class="mt-2 text-xs text-muted">
                  {{ role.sourceTypes.join(' / ') }} · {{ role.subjectTypes.join(' / ') }} · {{ role.permissionCount }} permissions
                </p>
              </div>
            </div>
          </UCard>

          <UCard v-if="detail">
            <template #header>
              <h2 class="text-base font-semibold text-highlighted">
                内联权限解释
              </h2>
            </template>
            <div class="space-y-4">
              <div class="grid gap-3 lg:grid-cols-4">
                <UFormField label="app">
                  <UInput v-model="explainForm.appCode" />
                </UFormField>
                <UFormField label="resource">
                  <UInput v-model="explainForm.resourceCode" />
                </UFormField>
                <UFormField label="action">
                  <UInput v-model="explainForm.action" />
                </UFormField>
                <div class="flex items-end">
                  <UButton
                    class="w-full"
                    icon="i-lucide-search-check"
                    :loading="pending.explain"
                    @click="runExplain"
                  >
                    解释
                  </UButton>
                </div>
              </div>
              <div class="grid gap-3 lg:grid-cols-3">
                <UInput
                  v-model="explainForm.ownerUid"
                  placeholder="ownerUid"
                />
                <UInput
                  v-model="explainForm.departmentCode"
                  placeholder="departmentCode"
                />
                <UInput
                  v-model="explainForm.departmentTree"
                  placeholder="departmentTree"
                />
                <UInput
                  v-model="explainForm.projectCode"
                  placeholder="projectCode"
                />
                <UInput
                  v-model="explainForm.projectMemberUids"
                  placeholder="projectMemberUids"
                />
                <UInput
                  v-model="explainForm.customerOwnerUid"
                  placeholder="customerOwnerUid"
                />
                <UInput
                  v-model="explainForm.customerTeamUids"
                  placeholder="customerTeamUids"
                />
                <UInput
                  v-model="explainForm.assignedUid"
                  placeholder="assignedUid"
                />
                <UInput
                  v-model="explainForm.assignedUids"
                  placeholder="assignedUids"
                />
                <UInput
                  v-model="explainForm.matchedRelations"
                  placeholder="matchedRelations"
                />
                <UInput
                  v-model="explainForm.environment"
                  placeholder="environment"
                />
                <UInput
                  v-model="explainForm.deploymentEnvironment"
                  placeholder="deploymentEnvironment"
                />
              </div>
              <div
                v-if="explainResult"
                class="rounded-lg border border-default bg-muted px-4 py-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <UBadge
                    :color="explainDecisionColor"
                    variant="soft"
                  >
                    {{ reasonLabel(explainResult.reasonCode) }}
                  </UBadge>
                  <span class="text-xs text-muted">
                    selected roles: {{ explainResult.selectedRoleCodes.join(' / ') || 'none' }}
                  </span>
                </div>
                <div
                  v-if="explainResult.matchedGrant"
                  class="mt-3 text-sm"
                >
                  <p class="font-semibold text-highlighted">
                    {{ grantSourceLabel(explainResult.matchedGrant) }}
                  </p>
                  <p class="mt-1 text-xs text-muted">
                    {{ explainResult.matchedGrant.sourceType }} · {{ grantScopeText(explainResult.matchedGrant) }}
                  </p>
                </div>
                <div
                  v-else-if="explainResult.candidateGrants.length > 0"
                  class="mt-3 grid gap-2"
                >
                  <div
                    v-for="grant in explainResult.candidateGrants"
                    :key="grant.grantId"
                    class="rounded-lg border border-default bg-default px-3 py-2 text-sm"
                  >
                    {{ grantSourceLabel(grant) }} · {{ grantScopeText(grant) }}
                  </div>
                </div>
              </div>
            </div>
          </UCard>

          <UCard v-if="detail">
            <template #header>
              <h2 class="text-base font-semibold text-highlighted">
                有效权限
              </h2>
            </template>
            <div class="space-y-3">
              <div
                v-for="group in permissionGroups"
                :key="group.appCode"
                class="rounded-lg border border-default bg-default"
              >
                <div class="border-b border-default px-4 py-3">
                  <h3 class="font-semibold text-highlighted">
                    {{ group.appCode }}
                  </h3>
                </div>
                <div class="divide-y divide-default">
                  <button
                    v-for="permission in group.permissions"
                    :key="`${permission.appCode}:${permission.resourceCode}:${permission.action}`"
                    type="button"
                    class="w-full px-4 py-3 text-left hover:bg-muted"
                    @click="usePermissionForExplain(permission)"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-mono text-sm text-highlighted">
                        {{ permission.resourceCode }}:{{ permission.action }}
                      </span>
                      <UBadge
                        color="neutral"
                        variant="soft"
                      >
                        {{ permission.sources.length }} sources
                      </UBadge>
                    </div>
                    <p class="mt-1 truncate text-xs text-muted">
                      {{ permissionSourceText(permission) }}
                    </p>
                  </button>
                </div>
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
