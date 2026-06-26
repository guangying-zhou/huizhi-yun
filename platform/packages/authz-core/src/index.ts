/**
 * @hzy/authz-core —— 跨 Platform 与 Foundation 两条鉴权路径共用的纯算法授权 core。
 *
 * 零运行时框架依赖（不引 nuxt / h3 / vue），Platform（Node）与 Foundation（Nuxt）两侧
 * 都能直接消费。采用单文件源码直引（对齐 @hzy/platform-sdk）：消费方只编译这一个无内部
 * 相对 import 的文件，无需开启 allowImportingTsExtensions。
 */

// ===================== 类型 =====================

/** 资源动作三元组：app_code:resource_code:action */
export interface PermissionTriple {
  appCode: string
  resourceCode: string
  action: string
}

/**
 * 数据范围谓词。语义见 scopeMatches：
 *  - 同一 dimension 的多个谓词取 OR
 *  - 不同 dimension 之间取 AND
 *  - 永远绑定在某一个授权单元（AuthorizationGrant）内，不跨授权拼接
 */
export interface ScopePredicate {
  dimension: string
  predicate: string
  value?: string | null
  group?: string
  source: 'role_default' | 'assignment' | 'relation' | 'baseline'
}

/**
 * 授权单元 —— 引擎判定的最小单位。
 * 权限、范围、来源、有效期作为同一关系一起参与判断（文档 8.2 / 8.3）。
 */
export interface AuthorizationGrant {
  grantId: string
  subjectType: 'user' | 'job' | 'department' | 'project' | 'baseline' | 'relation'
  roleCode?: string
  sourceType: string
  startsAt?: string | null
  expiresAt?: string | null
  permission: PermissionTriple
  /** 角色自身默认范围，和授权关系范围分开判定，避免同维度范围被错误 OR 合并。 */
  defaultScopes?: ScopePredicate[]
  /** 单次授权关系上的附加范围，默认与角色范围取交集，replace 时由适配器清空 defaultScopes。 */
  assignmentScopes?: ScopePredicate[]
  scopes: ScopePredicate[]
}

export type AuthorizationMode
  = | 'merged'
    | 'role_simulation'
    | 'user_simulation'
    | 'privileged'

export interface AuthorizationContext {
  tenantCode: string
  actorUid: string
  actorSubjectId: number
  mode: AuthorizationMode
  simulatedRoleId?: number
  simulatedSubjectId?: number
  includeBaseline: boolean
  policyRevision: number
}

export interface Decision {
  allowed: boolean
  /** allowed / scope_not_matched / no_permission */
  reasonCode: string
  matchedGrantId?: string
  matchedAction?: string
  matchedScopes?: ScopePredicate[]
}

/**
 * 资源动作蕴含表，由应用 manifest 物化得到。
 * 每个“已持有动作” -> 它额外能满足的“被请求动作”集合；'*' 表示满足该资源任意动作。
 * 未提供时回退到下方保守默认层级。
 */
export interface ResourceActionPolicy {
  implications: Record<string, string[]>
}

/** 数据源端口：DB 适配器 / bundle 适配器各实现一份，产出同一种 Grant[] */
export interface GrantSource {
  loadGrants(ctx: AuthorizationContext): Promise<AuthorizationGrant[]>
}

/** 动态关系端口：跨应用关系判定（详见动态关系 resolver 架构） */
export interface RelationResolver {
  hasRelation(input: {
    tenantCode: string
    subjectUid: string
    relation: string
    object: { type: string, id: string }
  }): Promise<boolean>
}

/**
 * 鉴权时由调用应用从本地数据加载并传入的对象上下文。
 * 关系类维度（relation:*）由应用先经 RelationResolver 判定后填入 matchedRelations；
 * scopeMatches 本身不发起任何远程调用。
 */
export interface ObjectContext {
  actorUid?: string
  ownerUid?: string | null
  departmentCode?: string | null
  /** 对象所属部门的祖先链（含自身），用于 department:tree */
  departmentTree?: string[]
  projectCode?: string | null
  projectMemberUids?: string[]
  /** 已判定成立的关系谓词，如 'relation:participant'、'project:member' */
  matchedRelations?: string[]
  [key: string]: unknown
}

export interface EnterpriseRoleInput {
  appCode?: string | null
  status?: string | null
  isAssignable?: boolean | number | string | null
}

export interface RoleSelectionInput {
  availableRoleCodes: string[]
  requestedRoleCode?: string | null
  mode?: AuthorizationMode | string | null
}

export interface AuthorizationModePolicyInput {
  requestedMode?: AuthorizationMode | string | null
  allowRoleSimulation?: boolean
  allowUserSimulation?: boolean
  allowPrivileged?: boolean
}

export interface RoleSelection {
  mode: AuthorizationMode
  roleCodes: string[]
  activeRoleCode: string
}

export interface EvaluateInput {
  grants: AuthorizationGrant[]
  required: { appCode: string, resourceCode: string, action: string }
  object?: ObjectContext
  policyOf?: (appCode: string, resourceCode: string) => ResourceActionPolicy | undefined
  now?: Date
}

// ===================== 动作蕴含 =====================

/**
 * 动作蕴含语义 —— Platform 在线鉴权与 Foundation/应用鉴权共用的单一事实源。
 *
 * 方向固定为：判断“持有 grantedAction 能否满足 requiredAction”。绝不能反过来（把
 * “请求的动作”展开去匹配“持有的动作”），那正是 3.3 的提权根因：旧
 * expandActions('admin') = ['view','edit','admin'] 被当作可接受持有集，导致只持有
 * view 的用户也能通过 admin 检查。
 *
 * 默认层级（无 manifest 时）刻意保守，与 console hasPermissionInSnapshot 及 platform
 * permissionActions.ts 完全一致：admin 满足 view/edit 但默认不蕴含 approve 等敏感动作；
 * edit 满足 view；approve/confirm/export/close/deploy 等必须精确持有，互不蕴含。
 * manifest 可通过 implies 覆盖默认（例如声明 admin 的 implies 含 '*' 以蕴含全部动作）。
 */
const DEFAULT_HIERARCHY: Record<string, string[]> = {
  view: [],
  edit: ['view'],
  admin: ['view', 'edit']
}

export function actionSatisfies(
  grantedAction: string,
  requiredAction: string,
  policy?: ResourceActionPolicy
): boolean {
  if (grantedAction === requiredAction) {
    return true
  }

  const implied = policy?.implications?.[grantedAction]
    ?? DEFAULT_HIERARCHY[grantedAction]
    ?? []

  if (implied.includes('*')) {
    return true
  }

  return implied.includes(requiredAction)
}

// ===================== 数据范围 =====================

function predicateMatches(p: ScopePredicate, obj: ObjectContext | undefined): boolean {
  const { dimension: dim, predicate: pred } = p

  if (dim === 'tenant' && pred === 'global') {
    return true
  }
  if (!obj) {
    return false
  }

  if (dim === 'subject' && pred === 'self') {
    return !!obj.actorUid && !!obj.ownerUid && obj.actorUid === obj.ownerUid
  }

  if (dim === 'department') {
    if (pred === 'self') {
      return !!p.value && obj.departmentCode === p.value
    }
    if (pred === 'tree') {
      return !!p.value && Array.isArray(obj.departmentTree) && obj.departmentTree.includes(p.value)
    }
  }

  if (dim === 'project') {
    if (pred === 'member') {
      return !!obj.actorUid && Array.isArray(obj.projectMemberUids) && obj.projectMemberUids.includes(obj.actorUid)
    }
    if (pred === 'owner') {
      return !!obj.actorUid && !!obj.ownerUid && obj.actorUid === obj.ownerUid
    }
  }

  if (dim === 'relation') {
    return Array.isArray(obj.matchedRelations) && obj.matchedRelations.includes(`${dim}:${pred}`)
  }

  // 兜底：维度名直接匹配 objectContext 同名字段的值
  return p.value != null && obj[dim] === p.value
}

/**
 * 单个授权单元内的范围判定：
 *  - 同一 dimension 的多个谓词取 OR
 *  - 不同 dimension 之间取 AND
 *  - 空 scopes 视为“该授权不限定范围”（true）
 *
 * 只接收单个授权单元的 scopes，从结构上保证范围不会跨授权拼接。
 */
export function scopeMatches(scopes: ScopePredicate[], obj?: ObjectContext): boolean {
  if (!scopes || scopes.length === 0) {
    return true
  }

  const byDimension = new Map<string, ScopePredicate[]>()
  for (const scope of scopes) {
    const list = byDimension.get(scope.dimension) ?? []
    list.push(scope)
    byDimension.set(scope.dimension, list)
  }

  for (const predicates of byDimension.values()) {
    const anyMatch = predicates.some(p => predicateMatches(p, obj))
    if (!anyMatch) {
      return false
    }
  }

  return true
}

export function grantScopesMatch(grant: Pick<AuthorizationGrant, 'defaultScopes' | 'assignmentScopes' | 'scopes'>, obj?: ObjectContext): boolean {
  return scopeMatches(grant.defaultScopes || [], obj)
    && scopeMatches(grant.assignmentScopes || [], obj)
    && scopeMatches(grant.scopes || [], obj)
}

function matchedGrantScopes(grant: Pick<AuthorizationGrant, 'defaultScopes' | 'assignmentScopes' | 'scopes'>) {
  return [
    ...(grant.defaultScopes || []),
    ...(grant.assignmentScopes || []),
    ...(grant.scopes || [])
  ]
}

// ===================== 有效期 + 判定 =====================

export function isActiveAt(grant: AuthorizationGrant, now: Date): boolean {
  if (grant.startsAt && new Date(grant.startsAt) > now) {
    return false
  }
  if (grant.expiresAt && new Date(grant.expiresAt) <= now) {
    return false
  }
  return true
}

/**
 * 有效权限判定（文档 8.6）。
 *
 * 普通运行下多个授权取“允许并集”，但每个授权单元必须各自完整成立：动作满足 + 该授权
 * 自己的范围满足。绝不把 A 授权的权限与 B 授权的范围交叉组合。
 */
export function evaluate(input: EvaluateInput): Decision {
  const now = input.now ?? new Date()
  const policy = input.policyOf?.(input.required.appCode, input.required.resourceCode)

  const candidates = input.grants
    .filter(grant => isActiveAt(grant, now))
    .filter(grant =>
      grant.permission.appCode === input.required.appCode
      && grant.permission.resourceCode === input.required.resourceCode
      && actionSatisfies(grant.permission.action, input.required.action, policy)
    )

  for (const grant of candidates) {
    if (grantScopesMatch(grant, input.object)) {
      return {
        allowed: true,
        reasonCode: 'allowed',
        matchedGrantId: grant.grantId,
        matchedAction: grant.permission.action,
        matchedScopes: matchedGrantScopes(grant)
      }
    }
  }

  return {
    allowed: false,
    reasonCode: candidates.length ? 'scope_not_matched' : 'no_permission'
  }
}

// ===================== 角色 =====================

/**
 * 企业角色有效性判断 —— 修复 3.4。
 *
 * 仅以角色自身属性为准：app_code 为空 + status=active + 可分配。不再依赖
 * platform_system_roles 或 sourceRoleCode，使没有平台母版的纯租户自定义角色也能生效。
 * 角色来源只用于展示、升级和治理，不参与运行时有效性判断。
 */
export function isEnterpriseRole(role: EnterpriseRoleInput): boolean {
  const appCode = (role.appCode ?? '').trim()
  if (appCode) {
    return false
  }
  if ((role.status || 'active') !== 'active') {
    return false
  }
  const isAssignable = role.isAssignable
  if (
    isAssignable === false
    || isAssignable === 0
    || (typeof isAssignable === 'string' && ['0', 'false', 'no'].includes(isAssignable.trim().toLowerCase()))
  ) {
    return false
  }
  return true
}

function normalizeAuthorizationMode(mode: RoleSelectionInput['mode']): AuthorizationMode {
  switch (mode) {
    case 'role_simulation':
    case 'user_simulation':
    case 'privileged':
    case 'merged':
      return mode
    default:
      return 'merged'
  }
}

export function resolveAuthorizationMode(input: AuthorizationModePolicyInput = {}): AuthorizationMode {
  const requestedMode = normalizeAuthorizationMode(input.requestedMode)
  if (requestedMode === 'role_simulation') {
    return input.allowRoleSimulation ? requestedMode : 'merged'
  }
  if (requestedMode === 'user_simulation') {
    return input.allowUserSimulation ? requestedMode : 'merged'
  }
  if (requestedMode === 'privileged') {
    return input.allowPrivileged ? requestedMode : 'merged'
  }
  return 'merged'
}

function uniqueRoleCodes(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const roleCode = String(value || '').trim()
    if (!roleCode || seen.has(roleCode)) continue
    seen.add(roleCode)
    result.push(roleCode)
  }
  return result
}

/**
 * Runtime role selection policy.
 *
 * Normal runtime defaults to merged permissions across all effective enterprise
 * roles. The requested active role remains a UI view hint and only narrows the
 * effective role set when an explicit role simulation mode is supplied.
 */
export function selectEffectiveRoleCodes(input: RoleSelectionInput): RoleSelection {
  const mode = normalizeAuthorizationMode(input.mode)
  const availableRoleCodes = uniqueRoleCodes(input.availableRoleCodes)
  const requestedRoleCode = String(input.requestedRoleCode || '').trim()
  const activeRoleCode = requestedRoleCode && availableRoleCodes.includes(requestedRoleCode)
    ? requestedRoleCode
    : availableRoleCodes[0] || ''

  if (mode === 'role_simulation' && (!requestedRoleCode || !availableRoleCodes.includes(requestedRoleCode))) {
    return { mode, roleCodes: [], activeRoleCode: '' }
  }
  if (!activeRoleCode) {
    return { mode, roleCodes: [], activeRoleCode: '' }
  }
  if (mode === 'role_simulation') {
    return { mode, roleCodes: [activeRoleCode], activeRoleCode }
  }

  return { mode, roleCodes: availableRoleCodes, activeRoleCode }
}
