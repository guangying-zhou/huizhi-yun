import type { RowDataPacket } from '~~/server/utils/db'
import { queryRow } from '~~/server/utils/db'

export type AimsOwnerEntityType = 'project' | 'milestone' | 'work_item'

interface ProjectContextRow extends RowDataPacket {
  project_id: number
  project_code: string | null
}

export interface AimsOwnerColumns {
  projectOwnerId: number | null
  milestoneOwnerId: number | null
  workItemOwnerId: number | null
  entityType: AimsOwnerEntityType
  entityId: number
}

export function normalizeAimsOwnerEntityType(entityType: string): AimsOwnerEntityType {
  switch (entityType) {
    case 'project':
      return 'project'
    case 'milestone':
      return 'milestone'
    case 'task':
    case 'work_item':
      return 'work_item'
    default:
      throw createError({ statusCode: 400, message: `不支持的实体类型: ${entityType}` })
  }
}

export function resolveAimsOwnerColumns(entityType: string, entityId: number): AimsOwnerColumns {
  const normalizedType = normalizeAimsOwnerEntityType(entityType)
  if (!entityId || Number.isNaN(entityId)) {
    throw createError({ statusCode: 400, message: '无效的实体ID' })
  }

  return {
    projectOwnerId: normalizedType === 'project' ? entityId : null,
    milestoneOwnerId: normalizedType === 'milestone' ? entityId : null,
    workItemOwnerId: normalizedType === 'work_item' ? entityId : null,
    entityType: normalizedType,
    entityId
  }
}

export function getAimsOwnerEntityTypeSql(alias: string): string {
  return `CASE
    WHEN ${alias}.project_owner_id IS NOT NULL THEN 'project'
    WHEN ${alias}.milestone_owner_id IS NOT NULL THEN 'milestone'
    ELSE 'work_item'
  END`
}

export function getAimsOwnerEntityIdSql(alias: string): string {
  return `COALESCE(${alias}.project_owner_id, ${alias}.milestone_owner_id, ${alias}.work_item_owner_id)`
}

export async function resolveAimsProjectContext(entityType: string, entityId: number): Promise<{ projectId: number | null, projectCode: string | null }> {
  const normalizedType = normalizeAimsOwnerEntityType(entityType)

  if (normalizedType === 'project') {
    const project = await queryRow<ProjectContextRow>(
      'SELECT id AS project_id, project_code FROM aims_projects WHERE id = ?',
      [entityId]
    )
    return {
      projectId: project?.project_id ?? null,
      projectCode: project?.project_code ?? null
    }
  }

  if (normalizedType === 'milestone') {
    const milestone = await queryRow<ProjectContextRow>(
      `SELECT m.project_id, p.project_code
       FROM milestones m
       JOIN aims_projects p ON p.id = m.project_id
       WHERE m.id = ?`,
      [entityId]
    )
    return {
      projectId: milestone?.project_id ?? null,
      projectCode: milestone?.project_code ?? null
    }
  }

  const workItem = await queryRow<ProjectContextRow>(
    `SELECT wi.project_id, p.project_code
     FROM work_items wi
     JOIN aims_projects p ON p.id = wi.project_id
     WHERE wi.id = ?`,
    [entityId]
  )
  return {
    projectId: workItem?.project_id ?? null,
    projectCode: workItem?.project_code ?? null
  }
}
