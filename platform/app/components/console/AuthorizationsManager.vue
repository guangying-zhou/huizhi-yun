<script setup lang="ts">
import type { TableColumn, TreeItem } from '@nuxt/ui'

usePageTitle('角色授权')

type NoticeTone = 'success' | 'error' | 'warning'
type RolePolicyStatus = 'not_enabled' | 'synced' | 'system_updated' | 'tenant_overridden' | 'drifted' | 'unknown'

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface SystemRoleItem {
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  description: string | null
  permissionCount: number
  scopeCount: number
  policyRevision: number
  policyHash: string | null
  policyUpdatedAt: string | null
  appCodes?: string[]
  enabled: boolean
  tenantRoleId: number | null
  tenantRoleStatus: string | null
  isOverridden: boolean
  tenantSourcePolicyHash: string | null
  tenantEffectivePolicyHash: string | null
  tenantPolicyRevision: number | null
  tenantPolicyUpdatedAt: string | null
  policyStatus: RolePolicyStatus
}

interface SystemRoleListResponse {
  items: SystemRoleItem[]
  total: number
}

interface AssignableRoleItem {
  id: number
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  source: string
  sourceRoleCode: string | null
  sourcePolicyHash?: string | null
  effectivePolicyHash?: string | null
  policyRevision?: number
  policyUpdatedAt?: string | null
  isOverridden: boolean
  status: string
  permissionCount: number
}

interface AssignableRoleResponse {
  items: AssignableRoleItem[]
  total: number
}

interface SubscriptionItem {
  application: {
    appCode: string
    appName: string
    serviceRole: string
    status: string
  }
  stage: {
    key: string
    label: string
  }
}

interface SubscriptionListResponse {
  items: SubscriptionItem[]
  total: number
}

interface SubjectItem {
  id: number
  subjectType: string
  subjectCode: string
  displayName: string
  externalRef: string | null
  parentSubjectId: number | null
  status: string
}

interface SubjectListResponse {
  items: SubjectItem[]
  memberships?: SubjectMembershipItem[]
  total: number
}

interface SubjectMembershipItem {
  subjectId: number
  containerSubjectId: number
  relationType: string
  isPrimary: boolean
  status: string
}

interface SubjectRoleItem {
  id: number
  subjectId: number
  subjectType: string
  subjectCode: string
  subjectDisplayName: string
  roleId: number
  roleCode: string
  roleName: string
  appCode: string | null
  roleSource: string
  sourceType: string
  sourceId: string | null
  grantedByUid: string | null
  grantedAt: string
  expiredAt: string | null
  active: boolean
}

interface SubjectRoleResponse {
  items: SubjectRoleItem[]
  total: number
}

interface SystemRoleDiff {
  systemRole: {
    roleCode: string
    roleName: string
  }
  tenantRole: {
    id: number
    isOverridden: boolean
  } | null
  summary: {
    permissionMissingCount: number
    permissionExtraCount: number
    permissionChangedCount: number
    scopeMissingCount: number
    scopeExtraCount: number
    scopeChangedCount: number
  }
}

interface MaterializedTenantRole {
  id: number
  roleCode: string
  roleName: string
}

interface MaterializeSystemRoleResponse {
  applied: boolean
  requiresConfirmation: boolean
  diff: SystemRoleDiff
  tenantRole: MaterializedTenantRole | null
}

interface RolePermissionItem {
  appCode: string
  resourceCode: string
  resourceName: string
  action: string
  manifestActionId?: number | null
  sourceManifestActionId?: number | null
}

interface RolePermissionResponse {
  items: RolePermissionItem[]
}

interface RolePermissionGroup {
  key: string
  appCode: string
  resourceCode: string
  resourceName: string
  actions: string[]
}

interface AuthorizationExplainScope {
  dimension: string
  predicate: string
  value?: string | null
  group?: string
  source: string
}

interface AuthorizationExplainPermission {
  appCode: string
  resourceCode: string
  action: string
}

interface AuthorizationExplainGrant {
  grantId: string
  roleCode: string | null
  subjectType: string
  sourceType: string
  permission: AuthorizationExplainPermission
  active: boolean
  actionMatched: boolean
  scopeMatched: boolean
  defaultScopes: AuthorizationExplainScope[]
  assignmentScopes: AuthorizationExplainScope[]
  relationScopes: AuthorizationExplainScope[]
}

interface AuthorizationExplainResponse {
  uid: string
  tenantCode: string
  subjectId: number | null
  selectedRoleCodes: string[]
  availableRoleCodes: string[]
  activeRoleCode: string | null
  allowed: boolean
  reasonCode: string
  matchedAction: string | null
  matchedGrant: AuthorizationExplainGrant | null
  candidateGrants: AuthorizationExplainGrant[]
}

interface AuthorizationExplainForm {
  uid: string
  appCode: string
  resourceCode: string
  action: string
  ownerUid: string
  departmentCode: string
  departmentTree: string
  projectCode: string
  projectMemberUids: string
  matchedRelations: string
}

interface RoleConflictWarning {
  ruleCode: string
  ruleName: string
  message: string
  enforcement: 'warning' | 'enforce'
}

interface SubjectRoleAssignmentResponse {
  id: number
  roleConflictWarnings?: RoleConflictWarning[]
}

type RoleConflictEnforcement = 'warning' | 'enforce'
type RoleConflictRuleStatus = 'active' | 'disabled'

interface RoleConflictRuleItem {
  id?: number
  tenantCode?: string
  ruleCode: string
  ruleName: string
  conflictType: string
  enforcement: RoleConflictEnforcement
  leftRoleCode: string
  rightRoleCode: string
  leftAppCode: string
  leftResourceCode: string
  leftAction: string
  rightAppCode: string
  rightResourceCode: string
  rightAction: string
  description: string
  status: RoleConflictRuleStatus
}

interface RoleConflictRuleApiItem extends Omit<RoleConflictRuleItem,
  'enforcement' | 'leftRoleCode' | 'rightRoleCode' | 'leftAppCode' | 'leftResourceCode' | 'leftAction'
  | 'rightAppCode' | 'rightResourceCode' | 'rightAction' | 'description' | 'status'> {
  enforcement: string
  leftRoleCode: string | null
  rightRoleCode: string | null
  leftAppCode: string | null
  leftResourceCode: string | null
  leftAction: string | null
  rightAppCode: string | null
  rightResourceCode: string | null
  rightAction: string | null
  description: string | null
  status: string
}

interface RoleConflictRuleResponse {
  items: RoleConflictRuleApiItem[]
  total: number
  migrationRequired?: boolean
}

interface FetchLikeError extends Error {
  data?: {
    message?: string
    statusMessage?: string
  }
}

interface SubjectTreeItem extends TreeItem {
  id: string
  subject: SubjectItem
  children?: SubjectTreeItem[]
}

const { currentTenantCode } = useTenantContext()
const toast = useToast()

const allValue = '__all__'
const tenantCode = computed(() => String(currentTenantCode.value || '').trim())
const appFilter = ref(allValue)
const subjectTypeFilter = ref(allValue)
const includeExpired = ref(false)
const selectedSystemRoleCode = ref('')
const selectedSubjectIds = ref<string[]>([])
const subjectKeyword = ref('')
const subjectTreeOpen = ref(false)
const expiredAt = ref('')
const pending = reactive({
  subscriptions: false,
  systemRoles: false,
  roles: false,
  subjects: false,
  assignments: false,
  action: false,
  permissions: false,
  authorizationExplain: false,
  conflictRules: false
})

const subscriptions = ref<SubscriptionItem[]>([])
const systemRoles = ref<SystemRoleItem[]>([])
const tenantRoles = ref<AssignableRoleItem[]>([])
const subjects = ref<SubjectItem[]>([])
const subjectMemberships = ref<SubjectMembershipItem[]>([])
const allAssignments = ref<SubjectRoleItem[]>([])
const activeDiff = ref<SystemRoleDiff | null>(null)
const rolePermissionOpen = ref(false)
const rolePermissionRole = ref<SystemRoleItem | null>(null)
const rolePermissionItems = ref<RolePermissionItem[]>([])
const rolePermissionError = ref('')
const rolePermissionSource = ref<'system' | 'tenant'>('system')
const authorizationExplainResult = ref<AuthorizationExplainResponse | null>(null)
const authorizationExplainForm = reactive<AuthorizationExplainForm>({
  uid: '',
  appCode: '',
  resourceCode: '',
  action: 'view',
  ownerUid: '',
  departmentCode: '',
  departmentTree: '',
  projectCode: '',
  projectMemberUids: '',
  matchedRelations: ''
})
const assignmentModalOpen = ref(false)
const conflictRules = ref<RoleConflictRuleItem[]>([])
const conflictRuleMigrationRequired = ref(false)
const conflictRuleModalOpen = ref(false)
const conflictRuleEditIndex = ref(-1)
const conflictRuleForm = reactive<RoleConflictRuleItem>({
  ruleCode: '',
  ruleName: '',
  conflictType: 'segregation_of_duties',
  enforcement: 'warning',
  leftRoleCode: '',
  rightRoleCode: '',
  leftAppCode: '',
  leftResourceCode: '',
  leftAction: '',
  rightAppCode: '',
  rightResourceCode: '',
  rightAction: '',
  description: '',
  status: 'active'
})

const subjectTypeItems = [
  { label: '全部主体', value: allValue },
  { label: 'user', value: 'user' },
  { label: 'department', value: 'department' },
  { label: 'job', value: 'job' }
]
const conflictEnforcementItems = [
  { label: 'warning', value: 'warning' },
  { label: 'enforce', value: 'enforce' }
]
const conflictRuleStatusItems = [
  { label: 'active', value: 'active' },
  { label: 'disabled', value: 'disabled' }
]

const roleColumns: TableColumn<SystemRoleItem>[] = [
  {
    id: 'role',
    header: '角色'
  },
  {
    id: 'app',
    header: '应用'
  },
  {
    id: 'permissions',
    header: '权限'
  },
  {
    id: 'users',
    header: '已授权用户'
  },
  {
    id: 'policy',
    header: '策略状态'
  },
  {
    id: 'actions',
    header: '操作'
  }
]

const subscribedApplications = computed(() => {
  return subscriptions.value
    .filter(item => item.stage.key !== 'not_subscribed')
    .map(item => item.application)
})
const subscribedAppCodes = computed(() => new Set(subscribedApplications.value.map(item => item.appCode)))
const appOptions = computed(() => {
  return [
    { label: '全部应用', value: allValue },
    ...subscribedApplications.value.map(item => ({
      label: `${item.appName} (${item.appCode})`,
      value: item.appCode
    }))
  ]
})

const visibleSystemRoles = computed(() => {
  return systemRoles.value
})
const selectedSystemRole = computed(() => {
  return systemRoles.value.find(item => item.roleCode === selectedSystemRoleCode.value) || null
})
const selectedTenantRole = computed(() => {
  const systemRole = selectedSystemRole.value
  if (!systemRole) return null

  return tenantRoles.value.find(item => item.id === systemRole.tenantRoleId)
    || tenantRoles.value.find(item => item.sourceRoleCode === systemRole.roleCode)
    || tenantRoles.value.find(item => item.roleCode === systemRole.roleCode)
    || null
})
const assignmentRoleId = computed(() => {
  return selectedTenantRole.value?.id || selectedSystemRole.value?.tenantRoleId || 0
})
const activeAssignmentCount = computed(() => assignments.value.filter(item => item.active).length)
const activeRoleAssignmentCount = computed(() => allAssignments.value.filter(item => item.active).length)
const activeConflictRuleCount = computed(() => conflictRules.value.filter(item => item.status === 'active').length)

const rolesWithUsersCount = computed(() => systemRoles.value.filter(role => roleAuthorizedUsers(role).length > 0).length)
const assignmentsByRoleId = computed(() => {
  const groups = new Map<number, SubjectRoleItem[]>()

  for (const item of allAssignments.value) {
    if (!groups.has(item.roleId)) {
      groups.set(item.roleId, [])
    }
    groups.get(item.roleId)?.push(item)
  }

  return groups
})
const assignments = computed(() => {
  const roleId = assignmentRoleId.value
  if (!roleId) return []
  return assignmentsByRoleId.value.get(roleId) || []
})
const selectedSubjects = computed(() => {
  const subjectMap = new Map(subjects.value.map(item => [String(item.id), item]))
  return selectedSubjectIds.value
    .map(id => subjectMap.get(id))
    .filter((item): item is SubjectItem => item?.subjectType === 'user')
})
const selectedSubjectSummary = computed(() => {
  const count = selectedSubjects.value.length
  if (count === 0) return '选择一个或多个员工'
  if (count === 1) {
    const subject = selectedSubjects.value[0]
    if (!subject) return '选择一个或多个员工'
    return `${subject.displayName} (${subject.subjectType}:${subject.subjectCode})`
  }
  return `已选择 ${count} 个员工`
})
const userSubjectOptions = computed(() => {
  return subjects.value
    .filter(item => item.subjectType === 'user')
    .map(item => ({
      label: `${item.displayName} (${item.externalRef || item.subjectCode})`,
      value: item.externalRef || item.subjectCode
    }))
})
const authorizationExplainDecisionColor = computed(() => {
  if (!authorizationExplainResult.value) return 'neutral'
  return authorizationExplainResult.value.allowed ? 'success' : 'error'
})
const rolePermissionTitle = computed(() => {
  if (!rolePermissionRole.value) return '权限列表'
  return `权限列表：${rolePermissionRole.value.roleName}`
})
const rolePermissionSourceText = computed(() => {
  return rolePermissionSource.value === 'tenant'
    ? '当前租户角色权限'
    : '平台企业角色默认权限'
})
const rolePermissionGroups = computed<RolePermissionGroup[]>(() => {
  const actionOrder = new Map([
    ['view', 1],
    ['edit', 2],
    ['admin', 3]
  ])
  const groups = new Map<string, RolePermissionGroup>()

  for (const item of rolePermissionItems.value) {
    const key = `${item.appCode}:${item.resourceCode}`
    const group = groups.get(key) || {
      key,
      appCode: item.appCode,
      resourceCode: item.resourceCode,
      resourceName: item.resourceName || item.resourceCode,
      actions: []
    }

    if (!group.actions.includes(item.action)) {
      group.actions.push(item.action)
    }

    groups.set(key, group)
  }

  return Array.from(groups.values()).map(group => ({
    ...group,
    actions: group.actions.sort((a, b) => {
      const orderA = actionOrder.get(a) || 99
      const orderB = actionOrder.get(b) || 99
      if (orderA !== orderB) return orderA - orderB
      return a.localeCompare(b)
    })
  }))
})
const subjectTreeItems = computed<SubjectTreeItem[]>(() => {
  const keyword = subjectKeyword.value.trim().toLowerCase()
  const containerNodeMap = new Map<number, SubjectTreeItem>()
  const users = subjects.value.filter(item => item.subjectType === 'user')
  const nonUsers = subjects.value.filter(item => item.subjectType !== 'user')

  for (const subject of nonUsers) {
    containerNodeMap.set(subject.id, {
      id: String(subject.id),
      label: subject.displayName,
      subject,
      children: []
    })
  }

  const roots: SubjectTreeItem[] = []
  for (const node of containerNodeMap.values()) {
    const parent = node.subject.parentSubjectId ? containerNodeMap.get(node.subject.parentSubjectId) : null
    if (parent) {
      parent.children?.push(node)
    } else {
      roots.push(node)
    }
  }

  const membershipByUser = new Map<number, SubjectMembershipItem[]>()
  const attachedUserKeys = new Set<string>()

  for (const membership of subjectMemberships.value) {
    if (membership.status !== 'active') continue

    const subject = subjects.value.find(item => item.id === membership.subjectId)
    const container = containerNodeMap.get(membership.containerSubjectId)
    if (!subject || subject.subjectType !== 'user' || !container) continue

    const itemKey = `${subject.id}@${membership.containerSubjectId}`
    if (attachedUserKeys.has(itemKey)) continue

    attachedUserKeys.add(itemKey)
    container.children?.push({
      id: itemKey,
      label: subject.displayName,
      subject,
      children: []
    })

    if (!membershipByUser.has(subject.id)) {
      membershipByUser.set(subject.id, [])
    }
    membershipByUser.get(subject.id)?.push(membership)
  }

  for (const subject of users) {
    if (membershipByUser.has(subject.id)) continue

    const parent = subject.parentSubjectId ? containerNodeMap.get(subject.parentSubjectId) : null
    const item = {
      id: `${subject.id}@${parent?.subject.id || 'root'}`,
      label: subject.displayName,
      subject,
      children: []
    }

    if (parent) {
      parent.children?.push(item)
    } else {
      roots.push(item)
    }
  }

  const sortNodes = (nodes: SubjectTreeItem[]) => {
    nodes.sort((a, b) => {
      const typeCompare = a.subject.subjectType.localeCompare(b.subject.subjectType)
      if (typeCompare !== 0) return typeCompare
      return a.subject.subjectCode.localeCompare(b.subject.subjectCode)
    })
    for (const node of nodes) sortNodes(node.children || [])
  }
  sortNodes(roots)

  const matches = (subject: SubjectItem) => {
    if (!keyword) return true
    return [
      subject.subjectType,
      subject.subjectCode,
      subject.displayName,
      subject.externalRef || ''
    ].some(value => value.toLowerCase().includes(keyword))
  }

  const collect = (node: SubjectTreeItem): SubjectTreeItem | null => {
    const children = (node.children || [])
      .map(child => collect(child))
      .filter((item): item is SubjectTreeItem => Boolean(item))

    if (!matches(node.subject) && children.length === 0) return null

    return {
      ...node,
      defaultExpanded: children.length > 0,
      children: children.length > 0 ? children : undefined
    }
  }

  return roots
    .map(root => collect(root))
    .filter((item): item is SubjectTreeItem => Boolean(item))
})
const flatSubjectTreeItems = computed(() => {
  const items: SubjectTreeItem[] = []
  const collect = (nodes: SubjectTreeItem[]) => {
    for (const node of nodes) {
      items.push(node)
      collect(node.children || [])
    }
  }

  collect(subjectTreeItems.value)
  return items
})
const selectedSubjectTreeItems = computed<SubjectTreeItem[]>({
  get() {
    const selectedIds = new Set(selectedSubjectIds.value)
    return flatSubjectTreeItems.value.filter(item => selectedIds.has(String(item.subject.id)))
  },
  set(value) {
    const visibleSubjectIds = new Set(flatSubjectTreeItems.value.map(item => String(item.subject.id)))
    const nextIds = new Set(selectedSubjectIds.value.filter(id => !visibleSubjectIds.has(id)))

    for (const item of value) {
      nextIds.add(String(item.subject.id))
    }

    selectedSubjectIds.value = Array.from(nextIds)
  }
})

function selectedAppCode() {
  return appFilter.value === allValue ? undefined : appFilter.value
}

function setNotice(tone: NoticeTone, message: string) {
  toast.add({
    title: message,
    color: tone
  })
}

function errorMessage(error: unknown, fallback: string) {
  const fetchError = error as FetchLikeError
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || fallback
}

function selectSystemRole(role: SystemRoleItem) {
  selectedSystemRoleCode.value = role.roleCode
  activeDiff.value = null
}

function openAssignmentModal(role: SystemRoleItem) {
  selectSystemRole(role)
  subjectTreeOpen.value = false
  assignmentModalOpen.value = true
}

function tenantRoleForSystemRole(role: SystemRoleItem) {
  return tenantRoles.value.find(item => item.id === role.tenantRoleId)
    || tenantRoles.value.find(item => item.sourceRoleCode === role.roleCode)
    || tenantRoles.value.find(item => item.roleCode === role.roleCode)
    || null
}

function assignmentRoleIdForRole(role: SystemRoleItem) {
  return tenantRoleForSystemRole(role)?.id || role.tenantRoleId || 0
}

function roleAssignments(role: SystemRoleItem) {
  const roleId = assignmentRoleIdForRole(role)
  if (!roleId) return []
  return assignmentsByRoleId.value.get(roleId) || []
}

function activeRoleAssignments(role: SystemRoleItem) {
  return roleAssignments(role).filter(item => item.active)
}

function roleAuthorizedUsers(role: SystemRoleItem) {
  const seen = new Set<string>()
  return activeRoleAssignments(role).filter((item) => {
    const key = `${item.subjectType}:${item.subjectCode}`
    if (item.subjectType !== 'user' || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function clearSelectedSubjects() {
  selectedSubjectIds.value = []
}

function pruneSelectedSubjects() {
  const validIds = new Set(subjects.value.map(item => String(item.id)))
  selectedSubjectIds.value = selectedSubjectIds.value.filter(id => validIds.has(id))
}

function pruneSelectedApp() {
  if (appFilter.value === allValue) return
  if (!subscribedAppCodes.value.has(appFilter.value)) {
    appFilter.value = allValue
  }
}

function getSubjectTreeItemKey(item: SubjectTreeItem) {
  return item.id
}

function isCommitteeSubject(subject: Pick<SubjectItem, 'subjectType' | 'subjectCode' | 'displayName' | 'externalRef'>) {
  if (subject.subjectType === 'committee') return true
  if (subject.subjectType !== 'department') return false

  const searchable = [
    subject.subjectCode,
    subject.displayName,
    subject.externalRef || ''
  ].join(' ').toLowerCase()

  return searchable.includes('committee') || searchable.includes('委员会')
}

function isCommitteeShadowDepartment(subject: SubjectItem, committeeCodes: Set<string>) {
  return subject.subjectType === 'department' && committeeCodes.has(subject.subjectCode)
}

function authorizationExplainReasonLabel(reasonCode: string) {
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
  if (scopes.length === 0) return '无范围限制'
  return scopes.map(scope => `${scopeText(scope)} (${scope.source})`).join(' / ')
}

function permissionActionColor(action: string) {
  if (action === 'admin') return 'error'
  if (action === 'edit') return 'warning'
  if (action === 'view') return 'success'
  return 'neutral'
}

function rolePolicyStatusLabel(status: RolePolicyStatus) {
  if (status === 'synced') return '已同步'
  if (status === 'system_updated') return '需同步'
  if (status === 'tenant_overridden') return '租户覆盖'
  if (status === 'drifted') return '双向变更'
  if (status === 'not_enabled') return '待授权'
  return '待刷新'
}

function rolePolicyStatusColor(status: RolePolicyStatus) {
  if (status === 'synced') return 'success'
  if (status === 'system_updated') return 'warning'
  if (status === 'tenant_overridden') return 'info'
  if (status === 'drifted') return 'error'
  return 'neutral'
}

function rolePolicyStatusHint(status: RolePolicyStatus) {
  if (status === 'synced') return '租户角色授权与全局默认授权一致'
  if (status === 'system_updated') return '全局默认授权已变化，租户角色尚未同步'
  if (status === 'tenant_overridden') return '租户角色授权已被手工调整'
  if (status === 'drifted') return '全局默认授权和租户覆盖均有变化，请查看差异后再同步'
  if (status === 'not_enabled') return '首次授权时会自动准备当前租户的角色授权策略'
  return '缺少授权指纹，请重新保存或同步该角色'
}

function normalizeConflictRule(rule: RoleConflictRuleItem | RoleConflictRuleApiItem): RoleConflictRuleItem {
  const normalizedString = (value: string | null | undefined) => {
    const normalized = String(value || '').trim()
    return normalized
  }

  return {
    ...rule,
    ruleCode: String(rule.ruleCode || '').trim(),
    ruleName: String(rule.ruleName || '').trim(),
    conflictType: String(rule.conflictType || 'segregation_of_duties').trim(),
    enforcement: rule.enforcement === 'enforce' ? 'enforce' : 'warning',
    leftRoleCode: normalizedString(rule.leftRoleCode),
    rightRoleCode: normalizedString(rule.rightRoleCode),
    leftAppCode: normalizedString(rule.leftAppCode),
    leftResourceCode: normalizedString(rule.leftResourceCode),
    leftAction: normalizedString(rule.leftAction),
    rightAppCode: normalizedString(rule.rightAppCode),
    rightResourceCode: normalizedString(rule.rightResourceCode),
    rightAction: normalizedString(rule.rightAction),
    description: normalizedString(rule.description),
    status: rule.status === 'disabled' ? 'disabled' : 'active'
  }
}

function resetConflictRuleForm(rule?: RoleConflictRuleItem | RoleConflictRuleApiItem | null) {
  Object.assign(conflictRuleForm, normalizeConflictRule(rule || {
    ruleCode: '',
    ruleName: '',
    conflictType: 'segregation_of_duties',
    enforcement: 'warning',
    leftRoleCode: '',
    rightRoleCode: '',
    leftAppCode: '',
    leftResourceCode: '',
    leftAction: '',
    rightAppCode: '',
    rightResourceCode: '',
    rightAction: '',
    description: '',
    status: 'active'
  }))
}

function conflictSideText(rule: RoleConflictRuleItem, side: 'left' | 'right') {
  const roleCode = side === 'left' ? rule.leftRoleCode : rule.rightRoleCode
  const appCode = side === 'left' ? rule.leftAppCode : rule.rightAppCode
  const resourceCode = side === 'left' ? rule.leftResourceCode : rule.rightResourceCode
  const action = side === 'left' ? rule.leftAction : rule.rightAction
  const parts = []
  if (roleCode) parts.push(roleCode)
  if (appCode && resourceCode && action) parts.push(`${appCode}:${resourceCode}:${action}`)
  return parts.join(' / ') || '未配置'
}

function conflictRuleStatusColor(status: RoleConflictRuleStatus) {
  return status === 'active' ? 'success' : 'neutral'
}

function conflictRuleEnforcementColor(enforcement: RoleConflictEnforcement) {
  return enforcement === 'enforce' ? 'error' : 'warning'
}

function roleAppText(role: SystemRoleItem) {
  const codes = role.appCodes || []
  if (codes.length === 0) return '无应用角色'
  if (codes.length <= 3) return codes.join(' / ')
  return `${codes.slice(0, 3).join(' / ')} +${codes.length - 3}`
}

function roleHasPolicyDiff(role: SystemRoleItem) {
  return ['system_updated', 'tenant_overridden', 'drifted'].includes(role.policyStatus)
}

async function loadSubscriptions() {
  if (!tenantCode.value) {
    subscriptions.value = []
    appFilter.value = allValue
    return
  }

  pending.subscriptions = true
  try {
    const response = await platformFetchJson<ApiEnvelope<SubscriptionListResponse>>('/api/platform/tenant-admin/subscriptions', {
      query: {
        tenantCode: tenantCode.value,
        page: 1,
        pageSize: 200
      }
    })
    subscriptions.value = response.data.items
    pruneSelectedApp()
  } catch (error) {
    setNotice('error', errorMessage(error, '订阅应用加载失败'))
    subscriptions.value = []
    appFilter.value = allValue
  } finally {
    pending.subscriptions = false
  }
}

async function loadSystemRoles() {
  if (!tenantCode.value) {
    systemRoles.value = []
    selectedSystemRoleCode.value = ''
    return
  }

  pending.systemRoles = true
  try {
    const response = await platformFetchJson<ApiEnvelope<SystemRoleListResponse>>('/api/platform/tenant-admin/system-roles', {
      query: {
        tenantCode: tenantCode.value,
        appCode: selectedAppCode(),
        page: 1,
        pageSize: 500
      }
    })
    systemRoles.value = response.data.items
    if (!visibleSystemRoles.value.some(item => item.roleCode === selectedSystemRoleCode.value)) {
      selectedSystemRoleCode.value = visibleSystemRoles.value[0]?.roleCode || ''
    }
  } catch (error) {
    setNotice('error', errorMessage(error, '企业角色加载失败'))
    systemRoles.value = []
    selectedSystemRoleCode.value = ''
  } finally {
    pending.systemRoles = false
  }
}

async function loadTenantRoles() {
  if (!tenantCode.value) {
    tenantRoles.value = []
    return
  }

  pending.roles = true
  try {
    const response = await platformFetchJson<ApiEnvelope<AssignableRoleResponse>>('/api/platform/tenant-admin/assignable-roles', {
      query: {
        tenantCode: tenantCode.value,
        appCode: selectedAppCode(),
        page: 1,
        pageSize: 200
      }
    })
    tenantRoles.value = response.data.items
  } catch (error) {
    setNotice('error', errorMessage(error, '租户角色加载失败'))
    tenantRoles.value = []
  } finally {
    pending.roles = false
  }
}

async function loadSubjects() {
  if (!tenantCode.value) {
    subjects.value = []
    subjectMemberships.value = []
    selectedSubjectIds.value = []
    return
  }

  pending.subjects = true
  try {
    const response = await platformFetchJson<ApiEnvelope<SubjectListResponse>>('/api/platform/tenant-admin/subjects', {
      query: {
        tenantCode: tenantCode.value,
        subjectType: subjectTypeFilter.value === allValue ? undefined : subjectTypeFilter.value,
        status: 'active',
        all: 'true'
      }
    })
    const committeeCodes = new Set(
      response.data.items
        .filter(item => item.subjectType === 'committee')
        .map(item => item.subjectCode)
    )
    const nextSubjects = response.data.items.filter(item =>
      !isCommitteeSubject(item) && !isCommitteeShadowDepartment(item, committeeCodes)
    )
    const nextSubjectIds = new Set(nextSubjects.map(item => item.id))

    subjects.value = nextSubjects
    subjectMemberships.value = (response.data.memberships || []).filter(item =>
      nextSubjectIds.has(item.subjectId) && nextSubjectIds.has(item.containerSubjectId)
    )
    if (!authorizationExplainForm.uid) {
      const firstUser = nextSubjects.find(item => item.subjectType === 'user')
      authorizationExplainForm.uid = firstUser?.externalRef || firstUser?.subjectCode || ''
    }
    pruneSelectedSubjects()
  } catch (error) {
    setNotice('error', errorMessage(error, '主体列表加载失败'))
    subjects.value = []
    subjectMemberships.value = []
    selectedSubjectIds.value = []
  } finally {
    pending.subjects = false
  }
}

async function loadAssignments() {
  if (!tenantCode.value) {
    allAssignments.value = []
    return
  }

  pending.assignments = true
  try {
    const response = await platformFetchJson<ApiEnvelope<SubjectRoleResponse>>('/api/platform/tenant-admin/subject-roles', {
      query: {
        tenantCode: tenantCode.value,
        subjectType: subjectTypeFilter.value === allValue ? undefined : subjectTypeFilter.value,
        appCode: selectedAppCode(),
        includeExpired: includeExpired.value ? 'true' : undefined,
        page: 1,
        pageSize: 1000
      }
    })
    allAssignments.value = response.data.items
  } catch (error) {
    setNotice('error', errorMessage(error, '授权列表加载失败'))
    allAssignments.value = []
  } finally {
    pending.assignments = false
  }
}

async function loadConflictRules() {
  if (!tenantCode.value) {
    conflictRules.value = []
    conflictRuleMigrationRequired.value = false
    return
  }

  pending.conflictRules = true
  try {
    const response = await platformFetchJson<ApiEnvelope<RoleConflictRuleResponse>>('/api/platform/tenant-admin/role-conflict-rules', {
      query: {
        tenantCode: tenantCode.value
      }
    })
    conflictRules.value = response.data.items.map(item => normalizeConflictRule(item))
    conflictRuleMigrationRequired.value = Boolean(response.data.migrationRequired)
  } catch (error) {
    setNotice('error', errorMessage(error, '角色冲突规则加载失败'))
    conflictRules.value = []
    conflictRuleMigrationRequired.value = false
  } finally {
    pending.conflictRules = false
  }
}

async function refreshAll() {
  activeDiff.value = null
  await loadSubscriptions()
  await Promise.all([
    loadSystemRoles(),
    loadTenantRoles(),
    loadSubjects(),
    loadConflictRules()
  ])
  await loadAssignments()
}

function openConflictRuleModal(rule?: RoleConflictRuleItem, index = -1) {
  conflictRuleEditIndex.value = index
  resetConflictRuleForm(rule)
  conflictRuleModalOpen.value = true
}

function useFirstSelectedSubjectForExplain() {
  const subject = selectedSubjects.value[0]
  if (!subject) {
    setNotice('warning', '请先选择一个员工。')
    return
  }
  authorizationExplainForm.uid = subject.externalRef || subject.subjectCode
}

async function runAuthorizationExplain() {
  if (!tenantCode.value) return
  const uid = authorizationExplainForm.uid.trim()
  const appCode = authorizationExplainForm.appCode.trim()
  const resourceCode = authorizationExplainForm.resourceCode.trim()
  const action = authorizationExplainForm.action.trim()
  if (!uid || !appCode || !resourceCode || !action) {
    setNotice('warning', '请填写用户、app、resource 和 action。')
    return
  }

  pending.authorizationExplain = true
  try {
    const response = await platformFetchJson<ApiEnvelope<AuthorizationExplainResponse>>('/api/platform/tenant-admin/authorization-explain', {
      query: {
        tenantCode: tenantCode.value,
        uid,
        appCode,
        resourceCode,
        action,
        ownerUid: authorizationExplainForm.ownerUid.trim() || undefined,
        departmentCode: authorizationExplainForm.departmentCode.trim() || undefined,
        departmentTree: authorizationExplainForm.departmentTree.trim() || undefined,
        projectCode: authorizationExplainForm.projectCode.trim() || undefined,
        projectMemberUids: authorizationExplainForm.projectMemberUids.trim() || undefined,
        matchedRelations: authorizationExplainForm.matchedRelations.trim() || undefined
      }
    })
    authorizationExplainResult.value = response.data
  } catch (error) {
    setNotice('error', errorMessage(error, '权限解释失败'))
    authorizationExplainResult.value = null
  } finally {
    pending.authorizationExplain = false
  }
}

function validateConflictRule(rule: RoleConflictRuleItem) {
  const hasPermission = (side: 'left' | 'right') => {
    const appCode = side === 'left' ? rule.leftAppCode : rule.rightAppCode
    const resourceCode = side === 'left' ? rule.leftResourceCode : rule.rightResourceCode
    const action = side === 'left' ? rule.leftAction : rule.rightAction
    return Boolean(appCode && resourceCode && action)
  }
  const hasAnyPermissionPart = (side: 'left' | 'right') => {
    const appCode = side === 'left' ? rule.leftAppCode : rule.rightAppCode
    const resourceCode = side === 'left' ? rule.leftResourceCode : rule.rightResourceCode
    const action = side === 'left' ? rule.leftAction : rule.rightAction
    return Boolean(appCode || resourceCode || action)
  }
  const hasSide = (side: 'left' | 'right') => {
    const roleCode = side === 'left' ? rule.leftRoleCode : rule.rightRoleCode
    return Boolean(roleCode || hasPermission(side))
  }

  if (!rule.ruleCode || !rule.ruleName) return '规则编码和名称不能为空。'
  for (const side of ['left', 'right'] as const) {
    if (hasAnyPermissionPart(side) && !hasPermission(side)) {
      return `${side === 'left' ? '左侧' : '右侧'}权限必须同时填写 app、resource 和 action。`
    }
    if (!hasSide(side)) {
      return `${side === 'left' ? '左侧' : '右侧'}必须填写角色编码或完整权限三元组。`
    }
  }
  return ''
}

async function persistConflictRules(nextRules: RoleConflictRuleItem[]) {
  pending.conflictRules = true
  try {
    await $fetch('/api/platform/tenant-admin/role-conflict-rules', {
      method: 'PUT',
      body: {
        tenantCode: tenantCode.value,
        rules: nextRules.map(item => normalizeConflictRule(item))
      }
    })
    conflictRules.value = nextRules.map(item => normalizeConflictRule(item))
    conflictRuleMigrationRequired.value = false
    setNotice('success', '角色冲突规则已保存。')
  } catch (error) {
    setNotice('error', errorMessage(error, '角色冲突规则保存失败'))
  } finally {
    pending.conflictRules = false
  }
}

async function saveConflictRule() {
  const normalized = normalizeConflictRule(conflictRuleForm)
  const validationError = validateConflictRule(normalized)
  if (validationError) {
    setNotice('warning', validationError)
    return
  }

  const duplicate = conflictRules.value.some((item, index) =>
    item.ruleCode === normalized.ruleCode && index !== conflictRuleEditIndex.value
  )
  if (duplicate) {
    setNotice('warning', `规则编码重复：${normalized.ruleCode}`)
    return
  }

  const nextRules = [...conflictRules.value]
  if (conflictRuleEditIndex.value >= 0) {
    nextRules.splice(conflictRuleEditIndex.value, 1, normalized)
  } else {
    nextRules.push(normalized)
  }

  await persistConflictRules(nextRules)
  conflictRuleModalOpen.value = false
}

async function toggleConflictRuleStatus(rule: RoleConflictRuleItem, index: number) {
  const nextRules = [...conflictRules.value]
  nextRules.splice(index, 1, {
    ...rule,
    status: rule.status === 'active' ? 'disabled' : 'active'
  })
  await persistConflictRules(nextRules)
}

async function enableSystemRole(role: SystemRoleItem, force = false) {
  if (!tenantCode.value) return

  pending.action = true
  try {
    const response = await platformFetchJson<ApiEnvelope<MaterializeSystemRoleResponse>>(`/api/platform/tenant-admin/system-roles/${encodeURIComponent(role.roleCode)}/enable`, {
      method: 'POST',
      body: {
        tenantCode: tenantCode.value,
        force
      }
    })

    activeDiff.value = response.data.diff
    if (response.data.requiresConfirmation) {
      setNotice('warning', `${role.roleCode} 已被租户覆盖，请查看差异后确认同步。`)
    } else {
      selectedSystemRoleCode.value = role.roleCode
      setNotice('success', `${role.roleCode} 已同步默认授权。`)
      await Promise.all([loadSystemRoles(), loadTenantRoles()])
      await loadAssignments()
    }
  } catch (error) {
    setNotice('error', errorMessage(error, '同步企业角色失败'))
  } finally {
    pending.action = false
  }
}

async function ensureAssignmentRoleId(role: SystemRoleItem) {
  const existingRoleId = assignmentRoleIdForRole(role)
  if (existingRoleId) return existingRoleId

  const response = await platformFetchJson<ApiEnvelope<MaterializeSystemRoleResponse>>(`/api/platform/tenant-admin/system-roles/${encodeURIComponent(role.roleCode)}/enable`, {
    method: 'POST',
    body: {
      tenantCode: tenantCode.value
    }
  })

  activeDiff.value = response.data.diff
  const tenantRoleId = Number(response.data.tenantRole?.id || 0)
  if (!tenantRoleId) {
    throw new Error('企业角色自动准备失败：未返回租户角色')
  }

  selectedSystemRoleCode.value = role.roleCode
  await Promise.all([loadSystemRoles(), loadTenantRoles()])
  return tenantRoleId
}

async function showDiff(role: SystemRoleItem) {
  if (!tenantCode.value) return

  pending.action = true
  try {
    const response = await platformFetchJson<ApiEnvelope<SystemRoleDiff>>(`/api/platform/tenant-admin/system-roles/${encodeURIComponent(role.roleCode)}/diff`, {
      query: {
        tenantCode: tenantCode.value
      }
    })
    selectedSystemRoleCode.value = role.roleCode
    activeDiff.value = response.data
  } catch (error) {
    setNotice('error', errorMessage(error, '差异加载失败'))
  } finally {
    pending.action = false
  }
}

async function showRolePermissions(role: SystemRoleItem) {
  if (!tenantCode.value) return

  rolePermissionOpen.value = true
  rolePermissionRole.value = role
  rolePermissionItems.value = []
  rolePermissionError.value = ''
  rolePermissionSource.value = role.tenantRoleId ? 'tenant' : 'system'
  pending.permissions = true

  try {
    if (role.tenantRoleId) {
      const response = await platformFetchJson<ApiEnvelope<RolePermissionResponse>>(`/api/platform/tenant-admin/assignable-roles/${role.tenantRoleId}/permissions`, {
        query: {
          tenantCode: tenantCode.value
        }
      })
      rolePermissionItems.value = response.data.items
      return
    }

    const response = await platformFetchJson<ApiEnvelope<RolePermissionResponse>>(`/api/platform/tenant-admin/system-roles/${encodeURIComponent(role.roleCode)}/permissions`, {
      query: {
        tenantCode: tenantCode.value
      }
    })
    rolePermissionItems.value = response.data.items
  } catch (error) {
    rolePermissionError.value = errorMessage(error, '权限列表加载失败')
  } finally {
    pending.permissions = false
  }
}

async function assignRole() {
  const role = selectedSystemRole.value
  if (!tenantCode.value || !role) {
    setNotice('warning', '请先选择一个企业角色。')
    return
  }

  if (selectedSubjects.value.length === 0) {
    setNotice('warning', '请先选择一个或多个员工；部门节点仅作为级联选择容器。')
    return
  }

  pending.action = true
  try {
    const roleId = await ensureAssignmentRoleId(role)
    const results = await Promise.allSettled(selectedSubjects.value.map(subject => platformFetchJson<ApiEnvelope<SubjectRoleAssignmentResponse>>('/api/platform/tenant-admin/subject-roles', {
      method: 'POST',
      body: {
        tenantCode: tenantCode.value,
        subjectType: subject.subjectType,
        subjectId: subject.id,
        roleId,
        systemRoleCode: role.roleCode,
        expiredAt: expiredAt.value || null
      }
    })))

    const failed = results.filter(item => item.status === 'rejected')
    const succeeded = results.length - failed.length
    const warningMessages = results.flatMap(item => item.status === 'fulfilled'
      ? (item.value.data.roleConflictWarnings || []).map(warning => warning.message).filter(Boolean)
      : [])
    expiredAt.value = ''

    if (failed.length > 0) {
      const firstError = failed[0] as PromiseRejectedResult
      setNotice('warning', `已授予 ${succeeded} 个员工，${failed.length} 个失败：${errorMessage(firstError.reason, '授予角色失败')}`)
    } else if (warningMessages.length > 0) {
      const suffix = warningMessages.length > 1 ? ` 等 ${warningMessages.length} 条提示` : ''
      setNotice('warning', `${role.roleCode} 已授予 ${succeeded} 个员工；${warningMessages[0]}${suffix}`)
      selectedSubjectIds.value = []
      subjectTreeOpen.value = false
    } else {
      setNotice('success', `${role.roleCode} 已授予 ${succeeded} 个员工。`)
      selectedSubjectIds.value = []
      subjectTreeOpen.value = false
    }

    await Promise.all([loadSystemRoles(), loadTenantRoles(), loadAssignments()])
  } catch (error) {
    setNotice('error', errorMessage(error, '授予角色失败'))
  } finally {
    pending.action = false
  }
}

async function revokeAssignment(item: SubjectRoleItem) {
  pending.action = true
  try {
    await $fetch(`/api/platform/tenant-admin/subject-roles/${item.id}`, {
      method: 'DELETE',
      query: {
        tenantCode: tenantCode.value
      }
    })
    setNotice('success', `${item.roleCode} 已从 ${item.subjectCode} 撤销。`)
    await loadAssignments()
  } catch (error) {
    setNotice('error', errorMessage(error, '撤销授权失败'))
  } finally {
    pending.action = false
  }
}

watch([tenantCode, appFilter], () => {
  refreshAll()
}, { immediate: true })

watch(subjectTypeFilter, async () => {
  await loadSubjects()
  await loadAssignments()
})

watch(includeExpired, () => {
  loadAssignments()
})
</script>

<template>
  <UDashboardPanel
    id="tenant-authorizations"
    class="h-[calc(100dvh-var(--topbar-h,52px)-0.5rem)] min-h-0"
    :ui="{ body: 'console-page flex flex-col flex-1 min-h-0 overflow-y-auto' }"
  >
    <template #body>
      <UAlert
        v-if="!tenantCode"
        color="warning"
        variant="soft"
        icon="i-lucide-building-2"
        title="请先在企业工作台选择企业"
        description="未选择企业时无法加载角色与成员，请先在企业工作台选择。"
      />

      <section class="console-hero">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-highlighted">
              角色授权
            </h1>
            <p class="mt-1 text-sm text-muted">
              在当前企业下选择平台预置的企业角色，并按角色集中为成员分配授权。
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-refresh-cw"
              :loading="pending.subscriptions || pending.systemRoles || pending.roles || pending.assignments"
              @click="refreshAll"
            >
              刷新
            </UButton>
          </div>
        </div>
      </section>

      <UCard class="shrink-0">
        <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem] xl:grid-cols-[1fr_1fr_1fr_18rem]">
          <div class="rounded-lg border border-default bg-muted px-4 py-3">
            <p class="text-xs font-medium text-muted">
              当前企业
            </p>
            <p class="mt-2 truncate font-mono text-sm font-semibold text-highlighted">
              {{ tenantCode || '未选择企业' }}
            </p>
          </div>
          <div class="rounded-lg border border-default bg-muted px-4 py-3">
            <p class="text-xs font-medium text-muted">
              角色
            </p>
            <p class="mt-2 text-sm font-semibold text-highlighted">
              {{ rolesWithUsersCount }} / {{ systemRoles.length }}
            </p>
          </div>
          <div class="rounded-lg border border-default bg-muted px-4 py-3">
            <p class="text-xs font-medium text-muted">
              有效授权
            </p>
            <p class="mt-2 text-sm font-semibold text-highlighted">
              {{ activeRoleAssignmentCount }}
            </p>
          </div>
          <label class="tenant-field">
            <span class="tenant-field__label">应用筛选</span>
            <USelect
              v-model="appFilter"
              :items="appOptions"
            />
          </label>
        </div>
      </UCard>

      <UCard class="shrink-0">
        <template #header>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                权限解释
              </h2>
              <p class="mt-1 text-sm text-muted">
                {{ authorizationExplainResult ? authorizationExplainReasonLabel(authorizationExplainResult.reasonCode) : '选择用户和权限三元组' }}
              </p>
            </div>
            <UBadge
              v-if="authorizationExplainResult"
              :color="authorizationExplainDecisionColor"
              variant="soft"
            >
              {{ authorizationExplainResult.allowed ? 'allowed' : 'denied' }}
            </UBadge>
          </div>
        </template>

        <div class="space-y-4">
          <div class="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto]">
            <UFormField label="用户">
              <USelect
                v-model="authorizationExplainForm.uid"
                :items="userSubjectOptions"
                placeholder="选择用户"
              />
            </UFormField>
            <div class="grid gap-3 sm:grid-cols-3">
              <UFormField label="app">
                <UInput
                  v-model="authorizationExplainForm.appCode"
                  placeholder="finance"
                />
              </UFormField>
              <UFormField label="resource">
                <UInput
                  v-model="authorizationExplainForm.resourceCode"
                  placeholder="expenses"
                />
              </UFormField>
              <UFormField label="action">
                <UInput
                  v-model="authorizationExplainForm.action"
                  placeholder="view"
                />
              </UFormField>
            </div>
            <div class="flex flex-wrap items-end gap-2">
              <UButton
                color="neutral"
                variant="soft"
                icon="i-lucide-user-check"
                :disabled="selectedSubjects.length === 0"
                @click="useFirstSelectedSubjectForExplain"
              >
                使用已选
              </UButton>
              <UButton
                color="primary"
                icon="i-lucide-search-check"
                :loading="pending.authorizationExplain"
                :disabled="!tenantCode"
                @click="runAuthorizationExplain"
              >
                解释
              </UButton>
            </div>
          </div>

          <div class="grid gap-3 lg:grid-cols-3">
            <UFormField label="ownerUid">
              <UInput
                v-model="authorizationExplainForm.ownerUid"
                placeholder="用于 subject:self"
              />
            </UFormField>
            <UFormField label="departmentCode">
              <UInput
                v-model="authorizationExplainForm.departmentCode"
                placeholder="dept-sales"
              />
            </UFormField>
            <UFormField label="departmentTree">
              <UInput
                v-model="authorizationExplainForm.departmentTree"
                placeholder="dept-root,dept-sales"
              />
            </UFormField>
            <UFormField label="projectCode">
              <UInput
                v-model="authorizationExplainForm.projectCode"
                placeholder="PRJ-001"
              />
            </UFormField>
            <UFormField label="projectMemberUids">
              <UInput
                v-model="authorizationExplainForm.projectMemberUids"
                placeholder="u1,u2"
              />
            </UFormField>
            <UFormField label="matchedRelations">
              <UInput
                v-model="authorizationExplainForm.matchedRelations"
                placeholder="relation:participant"
              />
            </UFormField>
          </div>

          <div
            v-if="authorizationExplainResult"
            class="rounded-lg border border-default bg-muted px-4 py-3"
          >
            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                :color="authorizationExplainDecisionColor"
                variant="soft"
              >
                {{ authorizationExplainReasonLabel(authorizationExplainResult.reasonCode) }}
              </UBadge>
              <span class="text-xs text-muted">
                selected roles: {{ authorizationExplainResult.selectedRoleCodes.join(' / ') || 'none' }}
              </span>
              <span
                v-if="authorizationExplainResult.matchedAction"
                class="text-xs text-muted"
              >
                matched action: {{ authorizationExplainResult.matchedAction }}
              </span>
            </div>

            <div
              v-if="authorizationExplainResult.matchedGrant"
              class="mt-3 rounded-lg border border-default bg-default px-3 py-2 text-sm"
            >
              <p class="font-semibold text-highlighted">
                {{ authorizationExplainResult.matchedGrant.roleCode || 'unknown role' }}
              </p>
              <p class="mt-1 text-xs text-muted">
                {{ authorizationExplainResult.matchedGrant.sourceType }} · {{ authorizationExplainResult.matchedGrant.subjectType }} · {{ grantScopeText(authorizationExplainResult.matchedGrant) }}
              </p>
            </div>

            <div
              v-else-if="authorizationExplainResult.candidateGrants.length > 0"
              class="mt-3 grid gap-2"
            >
              <div
                v-for="grant in authorizationExplainResult.candidateGrants"
                :key="grant.grantId"
                class="rounded-lg border border-default bg-default px-3 py-2 text-sm"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-highlighted">
                    {{ grant.roleCode || 'unknown role' }}
                  </span>
                  <UBadge
                    :color="grant.scopeMatched ? 'success' : 'warning'"
                    variant="soft"
                  >
                    {{ grant.scopeMatched ? 'scope matched' : 'scope blocked' }}
                  </UBadge>
                </div>
                <p class="mt-1 text-xs text-muted">
                  {{ grant.sourceType }} · {{ grant.permission.appCode }}:{{ grant.permission.resourceCode }}:{{ grant.permission.action }} · {{ grantScopeText(grant) }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </UCard>

      <UCard class="shrink-0">
        <template #header>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-base font-semibold text-highlighted">
                职责冲突规则
              </h2>
              <p class="mt-1 text-sm text-muted">
                active {{ activeConflictRuleCount }} / total {{ conflictRules.length }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-refresh-cw"
                :loading="pending.conflictRules"
                :disabled="!tenantCode"
                @click="loadConflictRules"
              >
                刷新
              </UButton>
              <UButton
                color="primary"
                variant="soft"
                icon="i-lucide-plus"
                :disabled="!tenantCode || conflictRuleMigrationRequired"
                @click="openConflictRuleModal()"
              >
                新增规则
              </UButton>
            </div>
          </div>
        </template>

        <div class="space-y-3">
          <UAlert
            v-if="conflictRuleMigrationRequired"
            color="warning"
            variant="soft"
            icon="i-lucide-database"
            title="角色冲突规则表尚未迁移"
            description="请先执行 Platform v2.21 migration；当前授权写入仍会使用内置静态规则。"
          />

          <div
            v-if="pending.conflictRules"
            class="permission-state"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="size-4 animate-spin"
            />
            正在加载规则...
          </div>

          <div
            v-else-if="conflictRules.length > 0"
            class="grid gap-2"
          >
            <div
              v-for="(rule, index) in conflictRules"
              :key="rule.ruleCode"
              class="rounded-lg border border-default bg-default px-4 py-3"
            >
              <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <div class="min-w-0 space-y-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="font-semibold text-highlighted">
                      {{ rule.ruleName }}
                    </p>
                    <UBadge
                      :color="conflictRuleEnforcementColor(rule.enforcement)"
                      variant="soft"
                    >
                      {{ rule.enforcement }}
                    </UBadge>
                    <UBadge
                      :color="conflictRuleStatusColor(rule.status)"
                      variant="soft"
                    >
                      {{ rule.status }}
                    </UBadge>
                  </div>
                  <p class="font-mono text-xs text-muted">
                    {{ rule.ruleCode }} · {{ rule.conflictType }}
                  </p>
                  <div class="grid gap-2 text-xs text-muted md:grid-cols-2">
                    <p class="truncate">
                      左侧：{{ conflictSideText(rule, 'left') }}
                    </p>
                    <p class="truncate">
                      右侧：{{ conflictSideText(rule, 'right') }}
                    </p>
                  </div>
                  <p
                    v-if="rule.description"
                    class="text-xs text-muted"
                  >
                    {{ rule.description }}
                  </p>
                </div>
                <div class="flex flex-wrap items-start justify-end gap-2">
                  <UButton
                    color="neutral"
                    variant="soft"
                    size="sm"
                    icon="i-lucide-pencil"
                    :disabled="pending.conflictRules"
                    @click="openConflictRuleModal(rule, index)"
                  >
                    编辑
                  </UButton>
                  <UButton
                    :color="rule.status === 'active' ? 'warning' : 'success'"
                    variant="soft"
                    size="sm"
                    :disabled="pending.conflictRules"
                    @click="toggleConflictRuleStatus(rule, index)"
                  >
                    {{ rule.status === 'active' ? '停用' : '启用' }}
                  </UButton>
                </div>
              </div>
            </div>
          </div>

          <div
            v-else-if="!conflictRuleMigrationRequired"
            class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
          >
            当前租户未配置表驱动职责冲突规则。
          </div>
        </div>
      </UCard>

      <UCard
        class="auth-role-list-card min-h-[24rem]"
        :ui="{ root: 'flex flex-col', body: 'min-h-0 p-0 sm:p-0' }"
      >
        <UTable
          :data="visibleSystemRoles"
          :columns="roleColumns"
          :loading="pending.systemRoles || pending.roles || pending.assignments"
          sticky
          :ui="{
            root: 'auth-role-table-scroll w-full overflow-auto',
            base: 'min-w-[980px] border-separate border-spacing-0',
            th: 'sticky top-0 z-10 text-xs font-semibold text-muted bg-muted whitespace-nowrap',
            td: 'align-middle text-sm whitespace-nowrap border-b border-default',
            tr: 'cursor-default'
          }"
        >
          <template #role-cell="{ row }">
            <div class="min-w-[260px]">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-semibold text-highlighted">
                  {{ row.original.roleName }}
                </p>
                <UBadge
                  v-if="row.original.isOverridden"
                  color="warning"
                  variant="soft"
                  size="sm"
                >
                  已覆盖
                </UBadge>
              </div>
              <p class="mt-1 font-mono text-xs text-muted">
                {{ row.original.roleCode }}
              </p>
              <p
                v-if="row.original.description"
                class="mt-1 max-w-[360px] truncate text-xs text-muted"
              >
                {{ row.original.description }}
              </p>
            </div>
          </template>

          <template #app-cell="{ row }">
            <UTooltip :text="(row.original.appCodes || []).join(', ') || '该企业角色未配置默认应用角色'">
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ roleAppText(row.original) }}
              </UBadge>
            </UTooltip>
          </template>

          <template #permissions-cell="{ row }">
            <button
              type="button"
              class="auth-role-card__permission-count"
              :disabled="pending.permissions && rolePermissionRole?.roleCode === row.original.roleCode"
              @click.stop="showRolePermissions(row.original)"
            >
              <UIcon
                v-if="pending.permissions && rolePermissionRole?.roleCode === row.original.roleCode"
                name="i-lucide-loader-circle"
                class="size-3 animate-spin"
              />
              <span>{{ row.original.permissionCount }} 项权限</span>
            </button>
            <span class="ml-1 text-xs text-muted">
              / {{ row.original.scopeCount }} 个范围
            </span>
          </template>

          <template #users-cell="{ row }">
            <div
              v-if="roleAuthorizedUsers(row.original).length"
              class="flex max-w-[360px] flex-wrap gap-1.5"
            >
              <UTooltip
                v-for="item in roleAuthorizedUsers(row.original).slice(0, 8)"
                :key="`${item.roleId}-${item.subjectId}-${item.id}`"
                :text="item.subjectDisplayName"
              >
                <UBadge
                  color="success"
                  variant="soft"
                  size="sm"
                  class="font-mono"
                >
                  {{ item.subjectCode }}
                </UBadge>
              </UTooltip>
              <UBadge
                v-if="roleAuthorizedUsers(row.original).length > 8"
                color="neutral"
                variant="soft"
                size="sm"
              >
                +{{ roleAuthorizedUsers(row.original).length - 8 }}
              </UBadge>
            </div>
            <span
              v-else
              class="text-xs text-muted"
            >
              未授权
            </span>
          </template>

          <template #policy-cell="{ row }">
            <UTooltip :text="rolePolicyStatusHint(row.original.policyStatus)">
              <UBadge
                :color="rolePolicyStatusColor(row.original.policyStatus)"
                variant="soft"
              >
                {{ rolePolicyStatusLabel(row.original.policyStatus) }}
              </UBadge>
            </UTooltip>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex justify-end gap-2">
              <UButton
                color="primary"
                variant="soft"
                size="sm"
                icon="i-lucide-user-plus"
                @click.stop="openAssignmentModal(row.original)"
              >
                授权
              </UButton>
              <UButton
                v-if="roleHasPolicyDiff(row.original)"
                color="neutral"
                variant="soft"
                size="sm"
                :loading="pending.action"
                @click.stop="showDiff(row.original)"
              >
                差异
              </UButton>
              <UButton
                v-if="row.original.enabled && roleHasPolicyDiff(row.original) && row.original.isOverridden"
                color="warning"
                variant="soft"
                size="sm"
                :loading="pending.action"
                @click.stop="enableSystemRole(row.original, true)"
              >
                确认同步
              </UButton>
              <UButton
                v-else-if="row.original.enabled && roleHasPolicyDiff(row.original)"
                color="primary"
                size="sm"
                :loading="pending.action"
                @click.stop="enableSystemRole(row.original)"
              >
                同步
              </UButton>
            </div>
          </template>
        </UTable>

        <div
          v-if="!pending.systemRoles && visibleSystemRoles.length === 0"
          class="m-4 rounded-lg border border-dashed border-default bg-muted px-4 py-8 text-center text-sm text-muted"
        >
          当前筛选下没有可授权的企业角色。
        </div>
      </UCard>

      <UModal
        v-model:open="assignmentModalOpen"
        :title="selectedSystemRole ? `为 ${selectedSystemRole.roleName} 授权` : '主体角色分配'"
        :description="selectedSystemRole ? selectedSystemRole.roleCode : '从列表选择一个企业角色后进行授权。'"
        :ui="{
          content: 'max-w-6xl h-[min(86dvh,54rem)] overflow-visible',
          body: 'min-h-0 overflow-y-auto'
        }"
      >
        <template #body>
          <div class="space-y-4">
            <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
              <div class="tenant-field">
                <span class="tenant-field__label">主体</span>
                <div class="subject-picker">
                  <button
                    type="button"
                    class="subject-picker__trigger"
                    :disabled="!selectedSystemRole"
                    @click="subjectTreeOpen = !subjectTreeOpen"
                  >
                    <span class="truncate">{{ selectedSubjectSummary }}</span>
                    <UIcon
                      name="i-lucide-chevron-down"
                      class="h-4 w-4 shrink-0 text-muted"
                    />
                  </button>

                  <div
                    v-if="subjectTreeOpen"
                    class="subject-picker__menu"
                  >
                    <div class="grid gap-2 md:grid-cols-[9rem_minmax(0,1fr)]">
                      <USelect
                        v-model="subjectTypeFilter"
                        :items="subjectTypeItems"
                      />
                      <UInput
                        v-model="subjectKeyword"
                        icon="i-lucide-search"
                        placeholder="搜索主体"
                      />
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-default pb-2">
                      <span class="text-xs text-muted">
                        已选 {{ selectedSubjects.length }} 名成员 / {{ selectedSubjectIds.length }} 个节点
                      </span>
                      <div class="flex flex-wrap gap-2">
                        <UButton
                          size="xs"
                          color="neutral"
                          variant="ghost"
                          :disabled="selectedSubjectIds.length === 0"
                          @click="clearSelectedSubjects"
                        >
                          清空
                        </UButton>
                        <UButton
                          size="xs"
                          color="neutral"
                          variant="soft"
                          :disabled="flatSubjectTreeItems.length === 0"
                          @click="subjectTreeOpen = false"
                        >
                          确定
                        </UButton>
                      </div>
                    </div>

                    <div class="subject-tree">
                      <UTree
                        v-if="subjectTreeItems.length > 0"
                        v-model="selectedSubjectTreeItems"
                        :as="{ link: 'div' }"
                        :items="subjectTreeItems"
                        :get-key="getSubjectTreeItemKey"
                        multiple
                        propagate-select
                        bubble-select
                        color="neutral"
                        size="sm"
                        :ui="{
                          root: 'subject-tree__component',
                          link: 'subject-tree__link',
                          linkLabel: 'min-w-0',
                          linkTrailing: 'subject-tree__trailing'
                        }"
                      >
                        <template #item-leading="{ selected, indeterminate, handleSelect }">
                          <UCheckbox
                            :model-value="indeterminate ? 'indeterminate' : selected"
                            tabindex="-1"
                            @change="handleSelect"
                            @click.stop
                          />
                        </template>

                        <template #item-label="{ item }">
                          <span class="subject-tree__label">
                            <span class="truncate text-sm font-medium text-highlighted">
                              {{ item.subject.displayName }}
                            </span>
                            <span class="truncate font-mono text-xs text-muted">
                              {{ item.subject.subjectType }}:{{ item.subject.subjectCode }}
                            </span>
                          </span>
                        </template>

                        <template
                          #item-trailing="{ item, expanded, handleToggle }"
                        >
                          <button
                            v-if="item.children?.length"
                            type="button"
                            class="subject-tree__toggle"
                            @click.stop="handleToggle"
                          >
                            <UBadge
                              color="neutral"
                              variant="soft"
                              size="sm"
                            >
                              {{ item.children.length }}
                            </UBadge>
                            <UIcon
                              name="i-lucide-chevron-down"
                              class="subject-tree__toggle-icon"
                              :class="{ 'is-expanded': expanded }"
                            />
                          </button>
                        </template>
                      </UTree>

                      <div
                        v-if="!pending.subjects && subjectTreeItems.length === 0"
                        class="rounded-lg border border-dashed border-default bg-muted px-4 py-6 text-center text-sm text-muted"
                      >
                        当前筛选下没有可选主体。
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <label class="tenant-field">
                <span class="tenant-field__label">过期时间</span>
                <UInput
                  v-model="expiredAt"
                  type="datetime-local"
                  size="lg"
                  :disabled="!selectedSystemRole"
                />
              </label>
            </div>

            <div class="flex flex-wrap gap-2">
              <UButton
                color="primary"
                icon="i-lucide-plus"
                :loading="pending.action"
                :disabled="!selectedSystemRole || selectedSubjects.length === 0"
                @click="assignRole"
              >
                授予{{ selectedSubjects.length === 0 ? '' : selectedSubjects.length + ' 个' }}员工
              </UButton>
              <UButton
                color="neutral"
                variant="soft"
                :loading="pending.assignments"
                :disabled="!assignmentRoleId"
                @click="loadAssignments"
              >
                刷新授权
              </UButton>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
              <UCheckbox
                v-model="includeExpired"
                label="显示过期授权"
              />
              <span class="text-sm text-muted">
                active {{ activeAssignmentCount }} / total {{ assignments.length }}
              </span>
            </div>

            <div class="grid gap-3">
              <div
                v-for="item in assignments"
                :key="item.id"
                class="rounded-lg border border-default bg-default px-4 py-3"
              >
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0 space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="font-semibold text-highlighted">
                        {{ item.subjectDisplayName }}
                      </p>
                      <UBadge
                        :color="item.active ? 'success' : 'neutral'"
                        variant="soft"
                      >
                        {{ item.active ? 'active' : 'expired' }}
                      </UBadge>
                    </div>
                    <p class="font-mono text-xs text-muted">
                      {{ item.subjectType }}:{{ item.subjectCode }} → {{ item.roleCode }}
                    </p>
                    <p class="text-xs text-muted">
                      {{ item.roleSource }} · {{ item.appCode || 'platform' }}
                    </p>
                    <p class="text-xs text-muted">
                      granted {{ item.grantedAt }}<span v-if="item.expiredAt"> · expires {{ item.expiredAt }}</span>
                    </p>
                  </div>
                  <UButton
                    color="error"
                    variant="soft"
                    size="sm"
                    :disabled="!item.active"
                    :loading="pending.action"
                    @click="revokeAssignment(item)"
                  >
                    撤销
                  </UButton>
                </div>
              </div>

              <div
                v-if="!pending.assignments && assignments.length === 0"
                class="rounded-lg border border-dashed border-default bg-muted px-4 py-8 text-center text-sm text-muted"
              >
                当前角色还没有匹配的主体授权。
              </div>
            </div>
          </div>
        </template>
      </UModal>

      <UModal
        v-model:open="conflictRuleModalOpen"
        :title="conflictRuleEditIndex >= 0 ? '编辑职责冲突规则' : '新增职责冲突规则'"
        :description="tenantCode ? `tenantCode=${tenantCode}` : '未选择企业'"
        :ui="{ content: 'max-w-5xl' }"
      >
        <template #body>
          <div class="space-y-5">
            <div class="grid gap-3 md:grid-cols-2">
              <UFormField label="规则编码">
                <UInput
                  v-model="conflictRuleForm.ruleCode"
                  placeholder="finance-expense-maker-confirmation"
                />
              </UFormField>
              <UFormField label="规则名称">
                <UInput
                  v-model="conflictRuleForm.ruleName"
                  placeholder="付款制单与付款确认分离"
                />
              </UFormField>
              <UFormField label="冲突类型">
                <UInput v-model="conflictRuleForm.conflictType" />
              </UFormField>
              <div class="grid gap-3 sm:grid-cols-2">
                <UFormField label="执行级别">
                  <USelect
                    v-model="conflictRuleForm.enforcement"
                    :items="conflictEnforcementItems"
                  />
                </UFormField>
                <UFormField label="状态">
                  <USelect
                    v-model="conflictRuleForm.status"
                    :items="conflictRuleStatusItems"
                  />
                </UFormField>
              </div>
            </div>

            <div class="grid gap-4 lg:grid-cols-2">
              <div class="rounded-lg border border-default bg-muted p-4">
                <h3 class="text-sm font-semibold text-highlighted">
                  左侧职责
                </h3>
                <div class="mt-3 grid gap-3">
                  <UFormField label="角色编码">
                    <UInput
                      v-model="conflictRuleForm.leftRoleCode"
                      placeholder="可选，如 finance_maker"
                    />
                  </UFormField>
                  <div class="grid gap-3 sm:grid-cols-3">
                    <UFormField label="app">
                      <UInput
                        v-model="conflictRuleForm.leftAppCode"
                        placeholder="finance"
                      />
                    </UFormField>
                    <UFormField label="resource">
                      <UInput
                        v-model="conflictRuleForm.leftResourceCode"
                        placeholder="expenses"
                      />
                    </UFormField>
                    <UFormField label="action">
                      <UInput
                        v-model="conflictRuleForm.leftAction"
                        placeholder="edit"
                      />
                    </UFormField>
                  </div>
                </div>
              </div>

              <div class="rounded-lg border border-default bg-muted p-4">
                <h3 class="text-sm font-semibold text-highlighted">
                  右侧职责
                </h3>
                <div class="mt-3 grid gap-3">
                  <UFormField label="角色编码">
                    <UInput
                      v-model="conflictRuleForm.rightRoleCode"
                      placeholder="可选，如 finance_confirmer"
                    />
                  </UFormField>
                  <div class="grid gap-3 sm:grid-cols-3">
                    <UFormField label="app">
                      <UInput
                        v-model="conflictRuleForm.rightAppCode"
                        placeholder="finance"
                      />
                    </UFormField>
                    <UFormField label="resource">
                      <UInput
                        v-model="conflictRuleForm.rightResourceCode"
                        placeholder="expenses"
                      />
                    </UFormField>
                    <UFormField label="action">
                      <UInput
                        v-model="conflictRuleForm.rightAction"
                        placeholder="confirm"
                      />
                    </UFormField>
                  </div>
                </div>
              </div>
            </div>

            <UFormField label="说明">
              <UTextarea
                v-model="conflictRuleForm.description"
                :rows="3"
                placeholder="允许兼任时，业务实例必须保留双人校验。"
              />
            </UFormField>

            <div class="flex flex-wrap justify-end gap-2 border-t border-default pt-4">
              <UButton
                color="neutral"
                variant="soft"
                :disabled="pending.conflictRules"
                @click="conflictRuleModalOpen = false"
              >
                取消
              </UButton>
              <UButton
                color="primary"
                icon="i-lucide-save"
                :loading="pending.conflictRules"
                @click="saveConflictRule"
              >
                保存规则
              </UButton>
            </div>
          </div>
        </template>
      </UModal>

      <UCard v-if="activeDiff">
        <template #header>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
                Diff
              </p>
              <h2 class="text-lg font-semibold text-highlighted">
                {{ activeDiff.systemRole.roleName }}
              </h2>
              <p class="font-mono text-xs text-muted">
                {{ activeDiff.systemRole.roleCode }}
              </p>
            </div>
            <UBadge
              :color="activeDiff.tenantRole?.isOverridden ? 'warning' : 'neutral'"
              variant="soft"
            >
              {{ activeDiff.tenantRole?.isOverridden ? '已覆盖' : '标准' }}
            </UBadge>
          </div>
        </template>

        <div class="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div class="diff-stat">
            <span>perm missing</span>
            <strong>{{ activeDiff.summary.permissionMissingCount }}</strong>
          </div>
          <div class="diff-stat">
            <span>perm extra</span>
            <strong>{{ activeDiff.summary.permissionExtraCount }}</strong>
          </div>
          <div class="diff-stat">
            <span>perm changed</span>
            <strong>{{ activeDiff.summary.permissionChangedCount }}</strong>
          </div>
          <div class="diff-stat">
            <span>scope missing</span>
            <strong>{{ activeDiff.summary.scopeMissingCount }}</strong>
          </div>
          <div class="diff-stat">
            <span>scope extra</span>
            <strong>{{ activeDiff.summary.scopeExtraCount }}</strong>
          </div>
          <div class="diff-stat">
            <span>scope changed</span>
            <strong>{{ activeDiff.summary.scopeChangedCount }}</strong>
          </div>
        </div>
      </UCard>

      <UModal
        v-model:open="rolePermissionOpen"
        :title="rolePermissionTitle"
        :description="rolePermissionSourceText"
        :ui="{ content: 'max-w-3xl' }"
      >
        <template #body>
          <div class="space-y-4">
            <div
              v-if="rolePermissionRole"
              class="rounded-lg border border-default bg-muted px-4 py-3"
            >
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="min-w-0">
                  <p class="font-semibold text-highlighted">
                    {{ rolePermissionRole.roleName }}
                  </p>
                  <p class="font-mono text-xs text-muted">
                    {{ rolePermissionRole.roleCode }}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <UBadge
                    color="neutral"
                    variant="soft"
                  >
                    {{ rolePermissionRole.appCode || 'platform' }}
                  </UBadge>
                  <UBadge
                    :color="rolePermissionSource === 'tenant' ? 'success' : 'neutral'"
                    variant="soft"
                  >
                    {{ rolePermissionSourceText }}
                  </UBadge>
                </div>
              </div>
            </div>

            <UAlert
              v-if="rolePermissionError"
              color="error"
              variant="soft"
              icon="i-lucide-circle-alert"
              title="权限列表加载失败"
              :description="rolePermissionError"
            />

            <div
              v-if="pending.permissions"
              class="permission-state"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-4 animate-spin"
              />
              正在加载权限...
            </div>

            <div
              v-else-if="rolePermissionGroups.length > 0"
              class="grid gap-3"
            >
              <div
                v-for="group in rolePermissionGroups"
                :key="group.key"
                class="permission-group"
              >
                <div class="min-w-0">
                  <p class="font-semibold text-highlighted">
                    {{ group.resourceName }}
                  </p>
                  <p class="font-mono text-xs text-muted">
                    {{ group.appCode }}:{{ group.resourceCode }}
                  </p>
                </div>
                <div class="flex flex-wrap justify-end gap-2">
                  <UBadge
                    v-for="action in group.actions"
                    :key="action"
                    :color="permissionActionColor(action)"
                    variant="soft"
                  >
                    {{ action }}
                  </UBadge>
                </div>
              </div>
            </div>

            <div
              v-else-if="!rolePermissionError"
              class="permission-state"
            >
              当前角色没有权限项。
            </div>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
.auth-role-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: white;
  padding: 0.75rem;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
}

.auth-role-card.is-selected {
  border-color: rgb(56 189 248);
  background: rgb(240 249 255);
  box-shadow: 0 10px 24px rgb(15 23 42 / 0.07);
}

.auth-role-card__select {
  min-width: 0;
  text-align: left;
  cursor: pointer;
  outline: none;
}

.auth-role-card__select:focus-visible {
  border-radius: 0.375rem;
  box-shadow: 0 0 0 2px rgb(14 165 233 / 0.35);
}

.auth-role-card__permission-count {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.25rem;
  color: rgb(2 132 199);
  font: inherit;
  font-weight: 600;
  line-height: 1;
  vertical-align: baseline;
}

.auth-role-card__permission-count:hover {
  color: rgb(3 105 161);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.auth-role-card__permission-count:focus-visible {
  outline: 2px solid rgb(14 165 233 / 0.45);
  outline-offset: 2px;
}

.auth-role-card__permission-count:disabled {
  cursor: wait;
  opacity: 0.75;
  text-decoration: none;
}

.auth-role-card__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.auth-role-list-card {
  min-height: 24rem;
  overflow: hidden;
}

:deep(.auth-role-table-scroll) {
  min-height: 22rem;
  max-height: min(42rem, calc(100dvh - 10rem));
}

.subject-picker {
  position: relative;
}

.subject-picker__trigger {
  display: flex;
  width: 100%;
  min-height: 2.5rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border: 1px solid rgb(203 213 225);
  border-radius: 0.5rem;
  background: white;
  padding: 0.5rem 0.75rem;
  color: rgb(15 23 42);
  text-align: left;
}

.subject-picker__trigger:disabled {
  cursor: not-allowed;
  background: rgb(248 250 252);
  color: rgb(148 163 184);
}

.subject-picker__menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 0.375rem);
  left: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  width: min(24rem, calc(100vw - 2rem));
  max-height: min(38rem, calc(100dvh - 14rem));
  gap: 0.75rem;
  overflow: hidden;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: white;
  padding: 0.75rem;
  box-shadow: 0 20px 45px rgb(15 23 42 / 0.16);
}

.subject-tree {
  display: grid;
  min-height: 0;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.subject-tree__component {
  min-width: 0;
}

:deep(.subject-tree__link) {
  align-items: center;
  min-height: 2.75rem;
  border-radius: 0.45rem;
}

:deep(.subject-tree__link:hover) {
  background: rgb(248 250 252);
}

.subject-tree__label {
  display: grid;
  min-width: 0;
  gap: 0.1rem;
  text-align: left;
}

:deep(.subject-tree__trailing) {
  margin-inline-start: auto;
}

.subject-tree__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.subject-tree__toggle-icon {
  width: 1rem;
  height: 1rem;
  color: rgb(100 116 139);
  transition: transform 0.16s ease;
}

.subject-tree__toggle-icon.is-expanded {
  transform: rotate(180deg);
}

.diff-stat {
  display: grid;
  gap: 0.25rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: rgb(248 250 252);
}

.diff-stat span {
  font-size: 0.6875rem;
  color: rgb(100 116 139);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.diff-stat strong {
  font-size: 1.25rem;
  color: rgb(15 23 42);
}

.permission-group {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: white;
  padding: 0.75rem;
}

.permission-state {
  display: flex;
  min-height: 8rem;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 1px dashed rgb(203 213 225);
  border-radius: 0.5rem;
  background: rgb(248 250 252);
  color: rgb(100 116 139);
  font-size: 0.875rem;
}

@media (max-width: 768px) {
  .auth-role-list-card {
    min-height: 20rem;
  }

  :deep(.auth-role-table-scroll) {
    min-height: 18rem;
    max-height: max(20rem, calc(100dvh - 22rem));
  }

  .auth-role-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .permission-group {
    grid-template-columns: minmax(0, 1fr);
  }

  .auth-role-card__actions {
    justify-content: flex-start;
  }

  .subject-picker__menu {
    position: fixed;
    inset: auto 1rem 1rem 1rem;
    width: auto;
    max-height: min(34rem, calc(100vh - 6rem));
  }
}
</style>
