/**
 * 工作流状态转换验证引擎
 * 根据 workflow_transitions 表规则校验状态流转合法性
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface TransitionRow extends RowDataPacket {
  to_status: string
  transition_key: string
}

/**
 * 校验状态转换是否合法
 * 优先查项目级规则，无结果则回退系统默认规则（project_id IS NULL）
 */
export async function validateTransition(
  projectId: number | null,
  entityType: string,
  fromStatus: string,
  toStatus: string
): Promise<boolean> {
  // 先查项目级规则
  if (projectId) {
    const projectRule = await queryRow<RowDataPacket>(
      `SELECT id FROM workflow_transitions
       WHERE project_id = ? AND entity_type = ? AND from_status = ? AND to_status = ?
       LIMIT 1`,
      [projectId, entityType, fromStatus, toStatus]
    )
    if (projectRule) return true

    // 检查项目是否有自定义规则（如果有，则不回退到系统默认）
    const hasProjectRules = await queryRow<RowDataPacket>(
      `SELECT id FROM workflow_transitions
       WHERE project_id = ? AND entity_type = ? LIMIT 1`,
      [projectId, entityType]
    )
    if (hasProjectRules) return false
  }

  // 回退到系统默认规则
  const defaultRule = await queryRow<RowDataPacket>(
    `SELECT id FROM workflow_transitions
     WHERE project_id IS NULL AND entity_type = ? AND from_status = ? AND to_status = ?
     LIMIT 1`,
    [entityType, fromStatus, toStatus]
  )
  return !!defaultRule
}

/**
 * 获取当前状态可用的转换列表
 * 优先返回项目级规则，无则返回系统默认规则
 */
export async function getAvailableTransitions(
  projectId: number | null,
  entityType: string,
  currentStatus: string
): Promise<{ toStatus: string, transitionKey: string }[]> {
  // 先查项目级规则
  if (projectId) {
    const projectRules = await queryRows<TransitionRow[]>(
      `SELECT to_status, transition_key FROM workflow_transitions
       WHERE project_id = ? AND entity_type = ? AND from_status = ?`,
      [projectId, entityType, currentStatus]
    )
    if (projectRules.length > 0) {
      return projectRules.map(r => ({
        toStatus: r.to_status,
        transitionKey: r.transition_key
      }))
    }

    // 检查项目是否有自定义规则
    const hasProjectRules = await queryRow<RowDataPacket>(
      `SELECT id FROM workflow_transitions
       WHERE project_id = ? AND entity_type = ? LIMIT 1`,
      [projectId, entityType]
    )
    if (hasProjectRules) return []
  }

  // 回退到系统默认规则
  const defaultRules = await queryRows<TransitionRow[]>(
    `SELECT to_status, transition_key FROM workflow_transitions
     WHERE project_id IS NULL AND entity_type = ? AND from_status = ?`,
    [entityType, currentStatus]
  )
  return defaultRules.map(r => ({
    toStatus: r.to_status,
    transitionKey: r.transition_key
  }))
}
