<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'
import AuthorizationConflictRulesPanel from './AuthorizationConflictRulesPanel.vue'
import AuthorizationInstanceConflictDiagnostics from './AuthorizationInstanceConflictDiagnostics.vue'
import AuthorizationPermissionDiagnostics from './AuthorizationPermissionDiagnostics.vue'
import AuthorizationRoleAssignmentsModal from './AuthorizationRoleAssignmentsModal.vue'
import AuthorizationRoleCatalog from './AuthorizationRoleCatalog.vue'
import AuthorizationRoleDiffCard from './AuthorizationRoleDiffCard.vue'
import AuthorizationRolePermissionModal from './AuthorizationRolePermissionModal.vue'
import {
  normalizeAuthorizationConflictRule
} from '~/utils/authorizationConflictRules'
import type {
  AuthorizationConflictRule as RoleConflictRuleItem,
  AuthorizationConflictRuleApiItem as RoleConflictRuleApiItem
} from '~/utils/authorizationConflictRules'

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
  customerOwnerUid: string
  customerTeamUids: string
  assignedUid: string
  assignedUids: string
  matchedRelations: string
  environment: string
  deploymentEnvironment: string
}

interface InstanceConflictPrincipal {
  kind: string
  uid: string
  matchesActor: boolean
}

interface InstanceConflictPermission {
  appCode: string
  resourceCode: string
  action: string
}

interface InstanceConflictSideExplanation {
  permission: InstanceConflictPermission
  allowed: boolean
  reasonCode: string
  matchedAction: string | null
}

interface InstanceConflictRuleExplanation {
  ruleCode: string
  ruleName: string
  conflictType: string
  enforcement: RoleConflictEnforcement
  description: string
  requestedSide: 'left' | 'right'
  approvalLike: boolean
  sameActorPrincipals: InstanceConflictPrincipal[]
  status: 'violated' | 'satisfied' | 'not_applicable'
  reasonCode: string
  message: string
  requested: InstanceConflictSideExplanation
  counterpart: InstanceConflictSideExplanation
}

interface InstanceConflictExplainResponse {
  tenantCode: string
  uid: string
  requested: InstanceConflictPermission
  principals: InstanceConflictPrincipal[]
  hasViolation: boolean
  hasBlockingViolation: boolean
  hasWarningViolation: boolean
  rules: InstanceConflictRuleExplanation[]
}

interface InstanceConflictExplainForm {
  uid: string
  appCode: string
  resourceCode: string
  action: string
  activeRoleCode: string
  authorizationMode: 'merged' | 'role_simulation' | 'user_simulation'
  includeBaseline: boolean
  ownerUid: string
  departmentCode: string
  departmentTree: string
  projectCode: string
  projectMemberUids: string
  customerOwnerUid: string
  customerTeamUids: string
  assignedUid: string
  assignedUids: string
  matchedRelations: string
  environment: string
  deploymentEnvironment: string
  requesterUid: string
  applicantUid: string
  initiatorUid: string
  createdByUid: string
  handlerUid: string
  operatorUid: string
  submittedByUid: string
  makerUid: string
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
  instanceConflictExplain: false,
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
const showDiagnostics = ref(false)
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
  customerOwnerUid: '',
  customerTeamUids: '',
  assignedUid: '',
  assignedUids: '',
  matchedRelations: '',
  environment: '',
  deploymentEnvironment: ''
})
const instanceConflictExplainResult = ref<InstanceConflictExplainResponse | null>(null)
const instanceConflictForm = reactive<InstanceConflictExplainForm>({
  uid: '',
  appCode: 'finance',
  resourceCode: 'expenses',
  action: 'confirm',
  activeRoleCode: '',
  authorizationMode: 'merged',
  includeBaseline: true,
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
  deploymentEnvironment: '',
  requesterUid: '',
  applicantUid: '',
  initiatorUid: '',
  createdByUid: '',
  handlerUid: '',
  operatorUid: '',
  submittedByUid: '',
  makerUid: ''
})
const assignmentModalOpen = ref(false)
const conflictRules = ref<RoleConflictRuleItem[]>([])
const conflictRuleMigrationRequired = ref(false)

const authorizationModeItems: Array<{
  label: string
  value: InstanceConflictExplainForm['authorizationMode']
}> = [
  { label: '合并当前所有有效角色', value: 'merged' },
  { label: '只模拟某个角色', value: 'role_simulation' },
  { label: '只模拟目标用户', value: 'user_simulation' }
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
  const departmentNodeMap = new Map<number, SubjectTreeItem>()
  const users = subjects.value.filter(item => item.subjectType === 'user')
  const departments = subjects.value.filter(item => item.subjectType === 'department')

  for (const subject of departments) {
    departmentNodeMap.set(subject.id, {
      id: String(subject.id),
      label: subject.displayName,
      subject,
      children: []
    })
  }

  const roots: SubjectTreeItem[] = []
  for (const node of departmentNodeMap.values()) {
    const parent = node.subject.parentSubjectId ? departmentNodeMap.get(node.subject.parentSubjectId) : null
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
    const container = departmentNodeMap.get(membership.containerSubjectId)
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

    const parent = subject.parentSubjectId ? departmentNodeMap.get(subject.parentSubjectId) : null
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
      if (item.subject.subjectType === 'user') {
        nextIds.add(String(item.subject.id))
      }
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
      instanceConflictForm.uid ||= authorizationExplainForm.uid
      instanceConflictForm.applicantUid ||= authorizationExplainForm.uid
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
    conflictRules.value = response.data.items.map(item => normalizeAuthorizationConflictRule(item))
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

function useFirstSelectedSubjectForExplain() {
  const subject = selectedSubjects.value[0]
  if (!subject) {
    setNotice('warning', '请先选择一个员工。')
    return
  }
  authorizationExplainForm.uid = subject.externalRef || subject.subjectCode
}

function useFirstSelectedSubjectForInstanceConflict() {
  const subject = selectedSubjects.value[0]
  if (!subject) {
    setNotice('warning', '请先选择一个员工。')
    return
  }
  const uid = subject.externalRef || subject.subjectCode
  instanceConflictForm.uid = uid
  instanceConflictForm.applicantUid ||= uid
}

async function runAuthorizationExplain() {
  if (!tenantCode.value) return
  const uid = authorizationExplainForm.uid.trim()
  const appCode = authorizationExplainForm.appCode.trim()
  const resourceCode = authorizationExplainForm.resourceCode.trim()
  const action = authorizationExplainForm.action.trim()
  if (!uid || !appCode || !resourceCode || !action) {
    setNotice('warning', '请填写员工、应用编码、业务对象和操作。')
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
        customerOwnerUid: authorizationExplainForm.customerOwnerUid.trim() || undefined,
        customerTeamUids: authorizationExplainForm.customerTeamUids.trim() || undefined,
        assignedUid: authorizationExplainForm.assignedUid.trim() || undefined,
        assignedUids: authorizationExplainForm.assignedUids.trim() || undefined,
        matchedRelations: authorizationExplainForm.matchedRelations.trim() || undefined,
        environment: authorizationExplainForm.environment.trim() || undefined,
        deploymentEnvironment: authorizationExplainForm.deploymentEnvironment.trim() || undefined
      }
    })
    authorizationExplainResult.value = response.data
  } catch (error) {
    setNotice('error', errorMessage(error, '权限检查失败'))
    authorizationExplainResult.value = null
  } finally {
    pending.authorizationExplain = false
  }
}

async function runInstanceConflictExplain() {
  if (!tenantCode.value) return
  const uid = instanceConflictForm.uid.trim()
  const appCode = instanceConflictForm.appCode.trim()
  const resourceCode = instanceConflictForm.resourceCode.trim()
  const action = instanceConflictForm.action.trim()
  if (!uid || !appCode || !resourceCode || !action) {
    setNotice('warning', '请填写员工、应用编码、业务对象和操作。')
    return
  }

  pending.instanceConflictExplain = true
  try {
    const response = await platformFetchJson<ApiEnvelope<InstanceConflictExplainResponse>>('/api/platform/tenant-admin/instance-conflict-explain', {
      query: {
        tenantCode: tenantCode.value,
        uid,
        appCode,
        resourceCode,
        action,
        activeRoleCode: instanceConflictForm.activeRoleCode.trim() || undefined,
        authorizationMode: instanceConflictForm.authorizationMode,
        includeBaseline: instanceConflictForm.includeBaseline ? 'true' : 'false',
        ownerUid: instanceConflictForm.ownerUid.trim() || undefined,
        departmentCode: instanceConflictForm.departmentCode.trim() || undefined,
        departmentTree: instanceConflictForm.departmentTree.trim() || undefined,
        projectCode: instanceConflictForm.projectCode.trim() || undefined,
        projectMemberUids: instanceConflictForm.projectMemberUids.trim() || undefined,
        customerOwnerUid: instanceConflictForm.customerOwnerUid.trim() || undefined,
        customerTeamUids: instanceConflictForm.customerTeamUids.trim() || undefined,
        assignedUid: instanceConflictForm.assignedUid.trim() || undefined,
        assignedUids: instanceConflictForm.assignedUids.trim() || undefined,
        matchedRelations: instanceConflictForm.matchedRelations.trim() || undefined,
        environment: instanceConflictForm.environment.trim() || undefined,
        deploymentEnvironment: instanceConflictForm.deploymentEnvironment.trim() || undefined,
        requesterUid: instanceConflictForm.requesterUid.trim() || undefined,
        applicantUid: instanceConflictForm.applicantUid.trim() || undefined,
        initiatorUid: instanceConflictForm.initiatorUid.trim() || undefined,
        createdByUid: instanceConflictForm.createdByUid.trim() || undefined,
        handlerUid: instanceConflictForm.handlerUid.trim() || undefined,
        operatorUid: instanceConflictForm.operatorUid.trim() || undefined,
        submittedByUid: instanceConflictForm.submittedByUid.trim() || undefined,
        makerUid: instanceConflictForm.makerUid.trim() || undefined
      }
    })
    instanceConflictExplainResult.value = response.data
  } catch (error) {
    setNotice('error', errorMessage(error, '职责冲突检查失败'))
    instanceConflictExplainResult.value = null
  } finally {
    pending.instanceConflictExplain = false
  }
}

async function persistConflictRules(expectedTenantCode: string, nextRules: RoleConflictRuleItem[]) {
  if (!expectedTenantCode || expectedTenantCode !== tenantCode.value) {
    setNotice('warning', '企业已切换，请重新打开职责冲突规则后再保存。')
    return false
  }
  pending.conflictRules = true
  try {
    await $fetch('/api/platform/tenant-admin/role-conflict-rules', {
      method: 'PUT',
      body: {
        tenantCode: expectedTenantCode,
        rules: nextRules.map(item => normalizeAuthorizationConflictRule(item))
      }
    })
    if (tenantCode.value !== expectedTenantCode) return false
    conflictRules.value = nextRules.map(item => normalizeAuthorizationConflictRule(item))
    conflictRuleMigrationRequired.value = false
    setNotice('success', '角色冲突规则已保存。')
    return true
  } catch (error) {
    setNotice('error', errorMessage(error, '角色冲突规则保存失败'))
    return false
  } finally {
    pending.conflictRules = false
  }
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
              icon="i-lucide-shield-question"
              @click="showDiagnostics = !showDiagnostics"
            >
              {{ showDiagnostics ? '收起诊断' : '高级诊断' }}
            </UButton>
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
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div class="authorization-guide">
            <div class="authorization-guide__icon">
              <UIcon
                name="i-lucide-users-round"
                class="size-4"
              />
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-highlighted">
                角色授权
              </p>
              <p class="mt-1 text-sm text-muted">
                给员工分配企业角色。员工日常权限会合并所有有效角色，不需要切换角色才能工作。
              </p>
            </div>
          </div>

          <div class="authorization-guide">
            <div class="authorization-guide__icon">
              <UIcon
                name="i-lucide-shield-alert"
                class="size-4"
              />
            </div>
            <div class="min-w-0">
              <p class="text-sm font-semibold text-highlighted">
                职责冲突
              </p>
              <p class="mt-1 text-sm text-muted">
                用来防止同一个人在同一张业务单里同时经办和审批、制单和确认；规则可设置为提醒或直接拦截。
              </p>
            </div>
          </div>

          <div class="flex items-start lg:justify-end">
            <UButton
              color="neutral"
              variant="soft"
              icon="i-lucide-search-check"
              @click="showDiagnostics = !showDiagnostics"
            >
              {{ showDiagnostics ? '收起排查工具' : '排查具体问题' }}
            </UButton>
          </div>
        </div>
      </UCard>

      <AuthorizationInstanceConflictDiagnostics
        :open="showDiagnostics"
        :form="instanceConflictForm"
        :result="instanceConflictExplainResult"
        :pending="pending.instanceConflictExplain"
        :tenant-code="tenantCode"
        :user-subject-options="userSubjectOptions"
        :authorization-mode-items="authorizationModeItems"
        :can-use-selected-subject="selectedSubjects.length > 0"
        @run="runInstanceConflictExplain"
        @use-selected-subject="useFirstSelectedSubjectForInstanceConflict"
      />

      <AuthorizationPermissionDiagnostics
        :open="showDiagnostics"
        :form="authorizationExplainForm"
        :result="authorizationExplainResult"
        :pending="pending.authorizationExplain"
        :tenant-code="tenantCode"
        :user-subject-options="userSubjectOptions"
        :can-use-selected-subject="selectedSubjects.length > 0"
        @run="runAuthorizationExplain"
        @use-selected-subject="useFirstSelectedSubjectForExplain"
      />

      <AuthorizationConflictRulesPanel
        :tenant-code="tenantCode"
        :rules="conflictRules"
        :migration-required="conflictRuleMigrationRequired"
        :pending="pending.conflictRules"
        :save-rules="persistConflictRules"
        @refresh="loadConflictRules"
        @warning="setNotice('warning', $event)"
      />

      <AuthorizationRoleCatalog
        :roles="visibleSystemRoles"
        :loading="pending.systemRoles || pending.roles || pending.assignments"
        :pending-action="pending.action"
        :pending-permissions="pending.permissions"
        :pending-permission-role-code="rolePermissionRole?.roleCode || null"
        :role-authorized-users="roleAuthorizedUsers"
        :role-app-text="roleAppText"
        :role-policy-status-label="rolePolicyStatusLabel"
        :role-policy-status-color="rolePolicyStatusColor"
        :role-policy-status-hint="rolePolicyStatusHint"
        :role-has-policy-diff="roleHasPolicyDiff"
        @select="selectSystemRole"
        @assign="openAssignmentModal"
        @show-permissions="showRolePermissions"
        @show-diff="showDiff"
        @sync="enableSystemRole"
      />

      <AuthorizationRoleAssignmentsModal
        :open="assignmentModalOpen"
        :selected-role="selectedSystemRole"
        :assignment-role-id="assignmentRoleId"
        :selected-subject-summary="selectedSubjectSummary"
        :selected-subjects-count="selectedSubjects.length"
        :subject-tree-open="subjectTreeOpen"
        :subject-keyword="subjectKeyword"
        :subject-tree-items="subjectTreeItems"
        :flat-subject-tree-items-count="flatSubjectTreeItems.length"
        :selected-subject-tree-items="selectedSubjectTreeItems"
        :expired-at="expiredAt"
        :include-expired="includeExpired"
        :active-assignment-count="activeAssignmentCount"
        :assignments="assignments"
        :pending-action="pending.action"
        :pending-assignments="pending.assignments"
        :pending-subjects="pending.subjects"
        @update:open="assignmentModalOpen = $event"
        @update:subject-tree-open="subjectTreeOpen = $event"
        @update:subject-keyword="subjectKeyword = $event"
        @update:selected-subject-tree-items="selectedSubjectTreeItems = $event"
        @update:expired-at="expiredAt = $event"
        @update:include-expired="includeExpired = $event"
        @clear-selected-subjects="clearSelectedSubjects"
        @assign="assignRole"
        @refresh="loadAssignments"
        @revoke="revokeAssignment"
      />

      <AuthorizationRoleDiffCard
        v-if="activeDiff"
        :diff="activeDiff"
      />

      <AuthorizationRolePermissionModal
        :open="rolePermissionOpen"
        :title="rolePermissionTitle"
        :source-text="rolePermissionSourceText"
        :source="rolePermissionSource"
        :role="rolePermissionRole"
        :error="rolePermissionError"
        :loading="pending.permissions"
        :groups="rolePermissionGroups"
        @update:open="rolePermissionOpen = $event"
      />
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

.auth-role-card__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.authorization-guide {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem;
  align-items: start;
}

.authorization-guide__icon {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(203 213 225);
  border-radius: 0.5rem;
  background: rgb(248 250 252);
  color: rgb(51 65 85);
}

@media (max-width: 768px) {
  .auth-role-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .auth-role-card__actions {
    justify-content: flex-start;
  }

}
</style>
