/**
 * 流程引擎核心逻辑
 * 包含审批人解析、节点跳过判断、流程流转等
 */
import type { RowDataPacket, ResultSetHeader } from '~~/server/utils/db'
import { queryRows, queryRow, execute } from './db'
import { executeCallback } from './callbackService'
import {
  getDirectoryDepartmentByCode,
  listDirectoryDepartmentMembers,
  getDirectoryUserByUid
} from '~~/server/utils/directoryRuntimeClient'

interface ResolvedAssignee {
  uid: string
  name: string
  position?: string
}

interface FlowNodeDef {
  name: string
  type: 'approve' | 'cc' | 'countersign'
  approve_mode?: 'any' | 'all' | 'count' | 'ratio'
  approve_threshold?: {
    count?: number
    ratio?: number
    round?: 'ceil' | 'floor_plus_one' | 'floor'
    min?: number
    max?: number
  }
  assignees: Array<{
    type: string
    uid?: string
    uid_from_context?: string
    code?: string
    scope?: string
    dept_code?: string
    field_key?: string
    value_type?: string
    exclude_initiator?: boolean
    sample?: {
      mode?: 'random'
      count?: number
      count_from_field?: string
      seed?: string
    }
  }>
  skip_when?: Record<string, unknown>
  timeout_hours?: number
  auto_action?: string
  resolved_assignees?: ResolvedAssignee[]
}

interface FlowContext {
  initiator_uid: string
  initiator_dept_code?: string
  resource_dept_code?: string
  form_data?: Record<string, unknown>
  initiator_roles?: string[]
  [key: string]: unknown
}

interface InstanceRow extends RowDataPacket {
  id: number
  instance_no: string
  action_def_id: number
  app_code: string
  resource_code: string
  action_code: string
  biz_id: string
  biz_title: string
  biz_url: string | null
  biz_context: string | Record<string, unknown>
  form_data: string | Record<string, unknown>
  initiator_uid: string
  status: string
  current_node: number
  flow_snapshot: string | { nodes: FlowNodeDef[] }
  callback_url: string | null
}

interface TaskRow extends RowDataPacket {
  id: number
  instance_id: number
  node_index: number
  assignee_uid: string
  task_type: string
  status: string
}

// ========== Console Directory / Platform policy bundle 辅助函数 ==========

interface DeptInfo {
  id: number
  name: string
  dept_code: string
  org_type: string
  manager_uid: string | null
  leader_uid: string | null
  parent_code: string | null
  level: number
}

/**
 * 通过 dept_code 获取部门信息
 */
async function getDeptByCode(deptCode: string): Promise<DeptInfo | null> {
  try {
    const department = await getDirectoryDepartmentByCode(deptCode)
    if (!department) return null

    return {
      id: department.id || 0,
      name: department.name,
      dept_code: department.deptCode,
      org_type: department.orgType || 'department',
      manager_uid: department.managerId || null,
      leader_uid: department.leaderId || null,
      parent_code: department.parentId || null,
      level: department.level || 0
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[FlowEngine] Error fetching department:', message)
    return null
  }
}

/**
 * 获取用户的角色列表
 */
async function getUserRoles(uid: string): Promise<string[]> {
  console.warn(`[FlowEngine] User role context for ${uid} requires request-scoped Console authorization and no longer reads local policy bundle`)
  return []
}

// ========== 核心函数 ==========

/**
 * 解析审批人定义为具体的用户 UID 列表
 */
export async function resolveAssignees(
  assignees: FlowNodeDef['assignees'],
  context: FlowContext
): Promise<ResolvedAssignee[]> {
  const resolved: ResolvedAssignee[] = []
  const seenUids = new Set<string>()

  for (const assignee of assignees) {
    const uids: string[] = []

    switch (assignee.type) {
      case 'user': {
        if (assignee.uid) {
          uids.push(assignee.uid)
        } else if (assignee.uid_from_context) {
          const contextUid = getContextString(context, assignee.uid_from_context)
          if (contextUid) uids.push(contextUid)
        }
        break
      }

      case 'initiator': {
        uids.push(context.initiator_uid)
        break
      }

      case 'initiator_leader': {
        // 查询发起人所在部门的 manager_uid
        if (context.initiator_dept_code) {
          const dept = await getDeptByCode(context.initiator_dept_code)
          if (dept?.manager_uid) {
            uids.push(dept.manager_uid)
          }
        }
        break
      }

      case 'dept_manager': {
        const deptCode = resolveDeptCode(assignee, context)
        if (deptCode) {
          const dept = await getDeptByCode(deptCode)
          if (dept?.manager_uid) {
            uids.push(dept.manager_uid)
          }
        }
        break
      }

      case 'dept_leader': {
        const deptCode = resolveDeptCode(assignee, context)
        if (deptCode) {
          // 向上递归查找：当前部门 leader 为空时查上级部门负责人
          let currentDeptCode: string | null = deptCode
          const maxDepth = 5 // 防止无限循环
          let depth = 0
          while (currentDeptCode && depth < maxDepth) {
            const dept = await getDeptByCode(currentDeptCode)
            if (!dept) break
            if (dept.leader_uid) {
              uids.push(dept.leader_uid)
              break
            }
            // leader 为空，尝试上级部门的 manager（即上级部门负责人）
            if (dept.parent_code) {
              const parentDept = await getDeptByCode(dept.parent_code)
              if (parentDept?.manager_uid) {
                uids.push(parentDept.manager_uid)
                break
              }
              // 上级部门 manager 也为空，继续向上
              currentDeptCode = dept.parent_code
            } else {
              break
            }
            depth++
          }
        }
        break
      }

      case 'role': {
        // 按角色查找用户，角色关系来自 Platform policy bundle。
        if (assignee.code) {
          const deptCode = resolveDeptCode(assignee, context)
          const roleUsers = await getUsersByRole(assignee.code, deptCode || undefined)
          uids.push(...roleUsers)
        }
        break
      }

      case 'form_field': {
        if (assignee.field_key) {
          uids.push(...normalizeStringList(resolveFieldValue(assignee.field_key, context)))
        }
        break
      }

      case 'dept_members': {
        const deptCode = resolveDeptCode(assignee, context)
        if (!deptCode) {
          throw createError({
            statusCode: 400,
            message: `节点审批人配置错误：${assignee.field_key || assignee.scope || 'dept_members'} 未解析到部门编码`
          })
        }

        let memberUids = (await listDirectoryDepartmentMembers(deptCode))
          .map(member => member.uid)
          .filter((memberUid): memberUid is string => Boolean(memberUid))

        if (assignee.exclude_initiator) {
          memberUids = memberUids.filter(memberUid => memberUid !== context.initiator_uid)
        }

        if (assignee.sample?.mode === 'random') {
          const sampleCount = resolveSampleCount(assignee.sample, context)
          if (sampleCount > 0 && sampleCount < memberUids.length) {
            memberUids = deterministicSample(
              memberUids,
              sampleCount,
              resolveSampleSeed(assignee.sample, context)
            )
          }
        }

        if (memberUids.length === 0) {
          throw createError({
            statusCode: 400,
            message: `部门 ${deptCode} 未解析到可用审批人`
          })
        }

        uids.push(...memberUids)
        break
      }
    }

    // 去重并获取用户详情
    for (const uid of uids) {
      if (seenUids.has(uid)) continue
      seenUids.add(uid)

      const user = await getDirectoryUserByUid(uid)
      if (user) {
        resolved.push({
          uid: user.uid,
          name: user.realName || user.displayName || user.nickname || uid
        })
      } else {
        // 用户不存在但仍然添加
        resolved.push({ uid, name: uid })
      }
    }
  }

  return resolved
}

/**
 * 根据 scope 解析部门编码
 */
function resolveDeptCode(
  assignee: { scope?: string, dept_code?: string, field_key?: string },
  context: FlowContext
): string | null {
  switch (assignee.scope) {
    case 'initiator_dept':
      return context.initiator_dept_code || null
    case 'resource_dept':
      return (context.resource_dept_code as string) || null
    case 'specified':
      return assignee.dept_code || null
    case 'form_field':
      return stringifyValue(resolveFieldValue(assignee.field_key || '', context))
    default:
      return context.initiator_dept_code || null
  }
}

function resolveFieldValue(fieldKey: string, context: FlowContext): unknown {
  if (!fieldKey) return undefined
  if (context.form_data && context.form_data[fieldKey] !== undefined) {
    return context.form_data[fieldKey]
  }
  return getContextValue(context, fieldKey)
}

function stringifyValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  return null
}

function getContextString(context: FlowContext, path: string): string | null {
  return stringifyValue(getContextValue(context, path))
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) {
    return value
      .map(item => stringifyValue(item))
      .filter((item): item is string => Boolean(item))
  }
  return []
}

function resolveSampleCount(sample: NonNullable<FlowNodeDef['assignees'][number]['sample']>, context: FlowContext): number {
  if (typeof sample.count === 'number') return Math.max(0, Math.floor(sample.count))
  if (sample.count_from_field) {
    const value = resolveFieldValue(sample.count_from_field, context)
    const count = Number(value)
    return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
  }
  return 0
}

function resolveSampleSeed(sample: NonNullable<FlowNodeDef['assignees'][number]['sample']>, context: FlowContext): string {
  if (sample.seed) {
    const contextSeed = getContextValue(context, sample.seed)
    return stringifyValue(contextSeed) || sample.seed
  }
  return String(context.instance_no || context.biz_id || context.initiator_uid || 'workflow')
}

function deterministicSample(values: string[], count: number, seed: string): string[] {
  return [...values]
    .sort((a, b) => hashString(`${seed}:${a}`) - hashString(`${seed}:${b}`))
    .slice(0, count)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * 通过角色和部门查找用户
 */
async function getUsersByRole(roleCode: string, deptCode?: string): Promise<string[]> {
  throw createError({
    statusCode: 503,
    statusMessage: 'Authorization Directory Unavailable',
    message: `Workflow role assignee resolution requires Console authorization directory API: role=${roleCode}${deptCode ? `, dept=${deptCode}` : ''}`
  })
}

/**
 * 评估是否应跳过当前节点
 * skip_when 的格式与路由条件相同
 */
export function evaluateSkipWhen(
  skipWhen: Record<string, unknown> | undefined,
  context: FlowContext
): boolean {
  if (!skipWhen || Object.keys(skipWhen).length === 0) {
    return false
  }

  for (const [key, conditionValue] of Object.entries(skipWhen)) {
    const contextValue = getContextValue(context, key)

    if (typeof conditionValue === 'string' || typeof conditionValue === 'number') {
      // 精确匹配
      if (Array.isArray(contextValue)) {
        if (!contextValue.includes(conditionValue)) return false
      } else {
        if (contextValue !== conditionValue) return false
      }
    } else if (typeof conditionValue === 'object' && conditionValue !== null) {
      const cv = conditionValue as Record<string, unknown>
      if ('in' in cv && Array.isArray(cv.in)) {
        if (Array.isArray(contextValue)) {
          if (!contextValue.some(v => (cv.in as unknown[]).includes(v))) return false
        } else {
          if (!(cv.in as unknown[]).includes(contextValue)) return false
        }
      }
    }
  }

  return true
}

/**
 * 从上下文中获取嵌套值
 */
function getContextValue(context: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = context
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * 生成流程编号：WF + 日期 + 4位序号
 * 例如 WF202603180001
 */
export async function generateInstanceNo(): Promise<string> {
  const now = new Date()
  const dateStr = now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0')

  const prefix = `WF${dateStr}`

  const row = await queryRow<RowDataPacket>(
    'SELECT instance_no FROM flow_instances WHERE instance_no LIKE ? ORDER BY id DESC LIMIT 1',
    [`${prefix}%`]
  )

  let seq = 1
  if (row?.instance_no) {
    const lastSeq = parseInt(row.instance_no.substring(prefix.length), 10)
    if (!isNaN(lastSeq)) {
      seq = lastSeq + 1
    }
  }

  return `${prefix}${String(seq).padStart(4, '0')}`
}

/**
 * 为指定节点创建任务
 */
export async function createTasksForNode(
  instanceId: number,
  nodeIndex: number,
  node: FlowNodeDef
): Promise<void> {
  const assignees = node.resolved_assignees || []

  for (const assignee of assignees) {
    await execute<ResultSetHeader>(
      `INSERT INTO flow_tasks (instance_id, node_index, node_name, assignee_uid, task_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
      [instanceId, nodeIndex, node.name, assignee.uid, node.type]
    )
  }
}

function calculateApproveThreshold(node: FlowNodeDef, totalTasks: number): number {
  const threshold = node.approve_threshold || {}
  let required = 1

  if (node.approve_mode === 'all') {
    required = totalTasks
  } else if (node.approve_mode === 'count') {
    required = Number(threshold.count || 1)
  } else if (node.approve_mode === 'ratio') {
    const ratio = Number(threshold.ratio || 1)
    const raw = totalTasks * ratio
    if (threshold.round === 'floor_plus_one') {
      required = Math.floor(raw) + 1
    } else if (threshold.round === 'floor') {
      required = Math.floor(raw)
    } else {
      required = Math.ceil(raw)
    }
  }

  const min = Number(threshold.min ?? 1)
  const max = threshold.max === undefined ? totalTasks : Number(threshold.max)
  return Math.min(Math.max(Math.ceil(required), min), max, totalTasks)
}

async function listActionActorUids(instanceId: number, action: 'approve' | 'reject'): Promise<string[]> {
  const rows = await queryRows<(RowDataPacket & { actor_uid: string })[]>(
    `SELECT actor_uid, MIN(created_at) AS first_created_at
     FROM flow_actions
     WHERE instance_id = ? AND action = ? AND actor_uid IS NOT NULL AND actor_uid != ''
     GROUP BY actor_uid
     ORDER BY first_created_at ASC`,
    [instanceId, action]
  )
  return rows
    .map(row => String(row.actor_uid || '').trim())
    .filter(Boolean)
}

function isExplicitInitiatorApprovalNode(node: FlowNodeDef): boolean {
  const assigneeDefs = node.assignees || []
  return assigneeDefs.length === 1 && assigneeDefs[0]?.type === 'initiator'
}

/**
 * 自审批自动通过：仅当节点定义明确指向发起人时，直接 completed 并推进流程。
 * 部门负责人、分管领导等动态审批人即使解析为发起人本人，也必须保留真实待办。
 * 返回是否触发了自动通过。
 */
export async function maybeAutoApproveInitiatorNode(
  instanceId: number,
  nodeIndex: number,
  node: FlowNodeDef,
  initiatorUid: string
): Promise<boolean> {
  // 只处理显式发起人单审批节点；会签 countersign 不自动
  if (node.type !== 'approve') return false
  if (!isExplicitInitiatorApprovalNode(node)) return false
  const assignees = node.resolved_assignees || []
  if (assignees.length !== 1) return false
  if (assignees[0]!.uid !== initiatorUid) return false

  const tasks = await queryRows<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM flow_tasks WHERE instance_id = ? AND node_index = ? AND status = ?',
    [instanceId, nodeIndex, 'pending']
  )
  if (tasks.length === 0) return false

  for (const t of tasks) {
    await execute<ResultSetHeader>(
      'UPDATE flow_tasks SET status = \'completed\', completed_at = NOW(), updated_at = NOW() WHERE id = ?',
      [t.id]
    )
    await execute<ResultSetHeader>(
      `INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
       VALUES (?, ?, ?, 'approve', ?, NOW())`,
      [instanceId, t.id, initiatorUid, '系统自动通过（发起人自审批）']
    )
  }
  // 推进；若下一节点仍是自审批，advanceFlow 内部会再次触发本函数
  await advanceFlow(instanceId)
  return true
}

/**
 * 流程流转：当前节点完成后推进到下一节点
 */
export async function advanceFlow(instanceId: number): Promise<void> {
  const instance = await queryRow<InstanceRow>(
    'SELECT * FROM flow_instances WHERE id = ?',
    [instanceId]
  )

  if (!instance || instance.status !== 'running') {
    return
  }

  const flowSnapshot = typeof instance.flow_snapshot === 'string'
    ? JSON.parse(instance.flow_snapshot)
    : instance.flow_snapshot

  const nodes: FlowNodeDef[] = flowSnapshot.nodes
  const currentNode = instance.current_node

  // 检查当前节点是否完成
  const currentNodeDef = nodes[currentNode]
  if (!currentNodeDef) return
  if (currentNodeDef.type === 'approve' || currentNodeDef.type === 'countersign') {
    const tasks = await queryRows<TaskRow[]>(
      'SELECT * FROM flow_tasks WHERE instance_id = ? AND node_index = ?',
      [instanceId, currentNode]
    )

    const approveMode = currentNodeDef.approve_mode || 'any'

    if (tasks.length === 0) return

    if (approveMode === 'any') {
      // 或签：只要有一个 completed 即可
      const hasCompleted = tasks.some(t => t.status === 'completed')
      if (!hasCompleted) return
      // 取消其他 pending 的任务
      await execute<ResultSetHeader>(
        'UPDATE flow_tasks SET status = \'cancelled\', updated_at = NOW() WHERE instance_id = ? AND node_index = ? AND status = \'pending\'',
        [instanceId, currentNode]
      )
    } else if (approveMode === 'all') {
      // 会签：所有任务都必须 completed
      const allCompleted = tasks.every(t => t.status === 'completed' || t.status === 'cancelled')
      if (!allCompleted) return
    } else if (approveMode === 'count' || approveMode === 'ratio') {
      const completedCount = tasks.filter(t => t.status === 'completed').length
      const requiredCount = calculateApproveThreshold(currentNodeDef, tasks.length)
      if (completedCount < requiredCount) return
      await execute<ResultSetHeader>(
        'UPDATE flow_tasks SET status = \'cancelled\', updated_at = NOW() WHERE instance_id = ? AND node_index = ? AND status = \'pending\'',
        [instanceId, currentNode]
      )
    }
  }

  // 构建流程上下文（用于 skip_when 判断）
  const bizContext = typeof instance.biz_context === 'string'
    ? JSON.parse(instance.biz_context)
    : instance.biz_context
  const formData = typeof instance.form_data === 'string'
    ? JSON.parse(instance.form_data)
    : instance.form_data

  const flowContext: FlowContext = {
    initiator_uid: instance.initiator_uid,
    initiator_dept_code: bizContext?.dept_code,
    resource_dept_code: bizContext?.resource_dept_code,
    initiator_roles: bizContext?.initiator_roles || [],
    initiator_role: bizContext?.initiator_roles || [],
    form_data: formData,
    ...bizContext
  }

  // 查找下一个有效节点
  let nextNodeIndex = currentNode + 1

  while (nextNodeIndex < nodes.length) {
    const nextNode = nodes[nextNodeIndex]
    if (!nextNode) break

    // 检查是否应该跳过
    if (evaluateSkipWhen(nextNode.skip_when as Record<string, unknown> | undefined, flowContext)) {
      // 标记该节点的任务为 skipped（如果有的话）
      await execute<ResultSetHeader>(
        'UPDATE flow_tasks SET status = \'skipped\', updated_at = NOW() WHERE instance_id = ? AND node_index = ? AND status = \'pending\'',
        [instanceId, nextNodeIndex]
      )
      nextNodeIndex++
      continue
    }

    break
  }

  if (nextNodeIndex >= nodes.length) {
    // 所有节点都已完成，流程通过
    await execute<ResultSetHeader>(
      'UPDATE flow_instances SET status = \'approved\', current_node = ?, completed_at = NOW(), updated_at = NOW() WHERE id = ?',
      [currentNode, instanceId]
    )

    // 通知发起人——但纯自审批（所有审批动作均由发起人完成）不发通知
    const approvalActorUids = await listActionActorUids(instanceId, 'approve')
    const nonSelfApprovalActorUids = approvalActorUids.filter(uid => uid !== instance.initiator_uid)
    if (nonSelfApprovalActorUids.length > 0) {
      try {
        await sendNotification({
          touser: instance.initiator_uid,
          title: '审批已通过',
          description: `您的「${instance.biz_title}」已全部审批通过`,
          url: instance.biz_url || ''
        })
      } catch (e) {
        console.error('[FlowEngine] 发送通知失败:', e)
      }
    }

    // 触发回调
    if (instance.callback_url) {
      try {
        await executeCallback(instance.callback_url, {
          event: 'flow_completed',
          instance_id: instance.id,
          instance_no: instance.instance_no,
          app_code: instance.app_code,
          resource_code: instance.resource_code,
          action_code: instance.action_code,
          biz_id: instance.biz_id,
          status: 'approved',
          form_data: formData,
          completed_at: new Date().toISOString(),
          initiator_uid: instance.initiator_uid,
          approval_actor_uids: approvalActorUids,
          approval_operator_uid: nonSelfApprovalActorUids[0] || approvalActorUids[approvalActorUids.length - 1] || '',
          non_self_approval_actor_uids: nonSelfApprovalActorUids,
          has_non_self_approval: nonSelfApprovalActorUids.length > 0
        })
      } catch (e) {
        console.error('[FlowEngine] 回调失败:', e)
      }
    }

    return
  }

  // 推进到下一节点
  const nextNode = nodes[nextNodeIndex]
  if (!nextNode) return

  await execute<ResultSetHeader>(
    'UPDATE flow_instances SET current_node = ?, updated_at = NOW() WHERE id = ?',
    [nextNodeIndex, instanceId]
  )

  // 创建下一节点的任务
  await createTasksForNode(instanceId, nextNodeIndex, nextNode)

  // 若下一节点是"发起人自审批"，自动通过并继续推进
  if (await maybeAutoApproveInitiatorNode(instanceId, nextNodeIndex, nextNode, instance.initiator_uid)) {
    return
  }

  // 通知下一节点审批人
  if (nextNode.resolved_assignees?.length) {
    const assigneeUids = nextNode.resolved_assignees.map((a: { uid: string }) => a.uid)
    try {
      await sendNotification({
        touser: assigneeUids,
        title: '您有新的审批待办',
        description: `${instance.biz_title} - ${nextNode.name}，请审批`,
        url: instance.biz_url || ''
      })
    } catch (e) {
      console.error('[FlowEngine] 发送通知失败:', e)
    }
  }
}

/**
 * 收集发起人上下文信息（部门、角色等）
 */
export async function collectInitiatorContext(uid: string): Promise<Record<string, unknown>> {
  const context: Record<string, unknown> = {
    initiator_uid: uid
  }

  const user = await getDirectoryUserByUid(uid)
  if (user) {
    context.initiator_name = user.realName || user.displayName || user.nickname || uid
    if (user.deptCode) {
      context.dept_code = user.deptCode
      context.initiator_dept_code = user.deptCode
      context.dept_name = user.deptName

      // 获取部门详情
      const dept = await getDeptByCode(user.deptCode)
      if (dept) {
        context.dept_org_type = dept.org_type
        context.dept_level = dept.level
        context.initiator_dept_manager_uid = dept.manager_uid
        context.initiator_dept_leader_uid = dept.leader_uid
        context.initiator_dept_parent_code = dept.parent_code
        context.dept_manager_uid = dept.manager_uid
        context.dept_leader_uid = dept.leader_uid

        if (dept.parent_code) {
          const parentDept = await getDeptByCode(dept.parent_code)
          context.initiator_dept_parent_manager_uid = parentDept?.manager_uid || null
          context.initiator_dept_parent_leader_uid = parentDept?.leader_uid || null
        }
      }
    }
  }

  // 获取用户角色
  const roles = await getUserRoles(uid)
  context.initiator_roles = roles
  if (roles.length > 0) {
    context.initiator_role = roles
  }

  return context
}
