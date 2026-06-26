/**
 * 项目生命周期状态校验工具
 *
 * 业务规则：
 *   - draft        : 立项前，允许编辑项目骨架结构（里程碑、target 层工作目标）；
 *                    禁止执行层操作（需求规格书导入、需求项、任务分配、追加任务、状态流转）
 *   - approval_pending: 立项审批中，一律只读
 *   - active       : 立项后正式执行，全部操作允许
 *   - paused       : 暂停，禁止变更
 *   - completed    : 已完成，禁止变更
 *   - archived     : 已归档，禁止变更
 *
 * 两档校验：
 *   - assertProjectActive            — 仅 active 可操作（需求/任务分配/流转）
 *   - assertProjectStructureEditable — draft 或 active 可操作（里程碑 / target 的 CRUD）
 */
import type { RowDataPacket } from '~~/server/utils/db'

export type ProjectLifecycleStatus
  = | 'draft'
    | 'approval_pending'
    | 'active'
    | 'paused'
    | 'completed'
    | 'archived'

interface LifecycleRow extends RowDataPacket {
  lifecycle_status: ProjectLifecycleStatus
}

const READONLY_REASON: Record<ProjectLifecycleStatus, string> = {
  draft: '项目尚未立项，需完成立项审批后方可执行此操作',
  approval_pending: '项目立项审批中，请等待审批通过',
  active: '',
  paused: '项目已暂停，恢复后可继续操作',
  completed: '项目已完成',
  archived: '项目已归档'
}

const STRUCTURE_BLOCK_REASON: Record<ProjectLifecycleStatus, string> = {
  draft: '',
  approval_pending: '项目立项审批中，禁止修改工作目标结构',
  active: '',
  paused: '项目已暂停，禁止修改工作目标结构',
  completed: '项目已完成，禁止修改工作目标结构',
  archived: '项目已归档，禁止修改工作目标结构'
}

/** 读取项目生命周期状态；不存在时抛 404 */
export async function getProjectLifecycleStatus(projectId: number): Promise<ProjectLifecycleStatus> {
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }
  const row = await queryRow<LifecycleRow>(
    'SELECT lifecycle_status FROM aims_projects WHERE id = ?',
    [projectId]
  )
  if (!row) {
    throw createError({ statusCode: 404, message: '项目不存在' })
  }
  return row.lifecycle_status
}

/** 通过工作项反查其所属项目的生命周期状态；工作项不存在抛 404 */
export async function getProjectLifecycleStatusByWorkItem(workItemId: number): Promise<ProjectLifecycleStatus> {
  if (!workItemId || Number.isNaN(workItemId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }
  const row = await queryRow<LifecycleRow>(
    `SELECT p.lifecycle_status
     FROM work_items wi
     JOIN aims_projects p ON p.id = wi.project_id
     WHERE wi.id = ?`,
    [workItemId]
  )
  if (!row) {
    throw createError({ statusCode: 404, message: '工作项或其所属项目不存在' })
  }
  return row.lifecycle_status
}

/** 基于 work_item 反查项目并断言 active */
export async function assertProjectActiveByWorkItem(workItemId: number): Promise<void> {
  const status = await getProjectLifecycleStatusByWorkItem(workItemId)
  if (status !== 'active') {
    throw createError({
      statusCode: 409,
      message: READONLY_REASON[status] || '项目当前状态不允许此操作'
    })
  }
}

/** 基于 work_item 反查项目并断言 draft 或 active */
export async function assertProjectStructureEditableByWorkItem(workItemId: number): Promise<void> {
  const status = await getProjectLifecycleStatusByWorkItem(workItemId)
  if (status !== 'draft' && status !== 'active') {
    throw createError({
      statusCode: 409,
      message: STRUCTURE_BLOCK_REASON[status] || '项目当前状态不允许修改工作目标结构'
    })
  }
}

/**
 * 仅允许 active（立项后执行阶段）。
 * 适用：需求规格书导入、需求项创建、任务分配（breakdown）、追加任务、分配确认/撤回、
 *       工作项状态流转到非规划态等。
 */
export async function assertProjectActive(projectId: number): Promise<void> {
  const status = await getProjectLifecycleStatus(projectId)
  if (status !== 'active') {
    throw createError({
      statusCode: 409,
      message: READONLY_REASON[status] || '项目当前状态不允许此操作'
    })
  }
}

/**
 * 允许 draft 或 active（骨架结构编辑）。
 * 适用：立项书 WBS 里的 target 创建/编辑/删除、里程碑骨架编辑。
 */
export async function assertProjectStructureEditable(projectId: number): Promise<void> {
  const status = await getProjectLifecycleStatus(projectId)
  if (status !== 'draft' && status !== 'active') {
    throw createError({
      statusCode: 409,
      message: STRUCTURE_BLOCK_REASON[status] || '项目当前状态不允许修改工作目标结构'
    })
  }
}
