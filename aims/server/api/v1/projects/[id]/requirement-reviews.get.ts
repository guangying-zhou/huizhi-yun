/**
 * 获取项目下所有需求评审批次
 * GET /api/v1/projects/:id/requirement-reviews
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface BatchRow extends RowDataPacket {
  id: number
  batch_type: string
  title: string
  description: string | null
  requirement_ids_json: string
  status: string
  workflow_instance_id: string | null
  submitted_by: string
  submitted_at: string
  closed_at: string | null
}

interface RequirementBriefRow extends RowDataPacket {
  id: number
  item_kind: string
  parent_requirement_id: number | null
  milestone_id: number | null
  milestone_name: string | null
  req_code: string
  title: string
  status: string
  priority: string
  change_reason: string | null
  scope_note: string | null
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const projectId = Number(getRouterParam(event, 'id'))
  if (!projectId || Number.isNaN(projectId)) {
    throw createError({ statusCode: 400, message: '无效的项目ID' })
  }

  const rows = await queryRows<BatchRow[]>(
    `SELECT id, batch_type, title, description, requirement_ids_json, status,
            workflow_instance_id, submitted_by, submitted_at, closed_at
     FROM requirement_review_batches
     WHERE project_id = ? AND status != 'withdrawn'
     ORDER BY submitted_at DESC`,
    [projectId]
  )

  function parseIds(raw: unknown): number[] {
    if (Array.isArray(raw)) return raw as number[]
    if (typeof raw === 'string' && raw.trim()) {
      try {
        return JSON.parse(raw) as number[]
      } catch {
        return []
      }
    }
    return []
  }

  const parsedRows = rows.map(row => ({
    row,
    requirementIds: parseIds(row.requirement_ids_json)
  }))
  const allRequirementIds = [...new Set(parsedRows.flatMap(item => item.requirementIds))]

  const requirementMap = new Map<number, RequirementBriefRow>()
  if (allRequirementIds.length > 0) {
    const requirementRows = await queryRows<RequirementBriefRow[]>(
      `SELECT r.id, r.item_kind, r.parent_requirement_id, r.milestone_id,
              m.name AS milestone_name,
              r.req_code, r.title, r.status, r.priority, r.change_reason, r.scope_note
       FROM requirement_items
       r LEFT JOIN milestones m ON m.id = r.milestone_id
       WHERE r.project_id = ? AND r.id IN (${allRequirementIds.map(() => '?').join(',')})`,
      [projectId, ...allRequirementIds]
    )
    for (const requirement of requirementRows) {
      requirementMap.set(requirement.id, requirement)
    }
  }

  return {
    code: 0,
    data: {
      batches: parsedRows.map(({ row, requirementIds }) => ({
        id: row.id,
        batchType: row.batch_type,
        title: row.title,
        description: row.description,
        requirementIds,
        requirements: requirementIds
          .map(id => requirementMap.get(id))
          .filter((requirement): requirement is RequirementBriefRow => !!requirement)
          .map(requirement => ({
            id: requirement.id,
            itemKind: requirement.item_kind,
            parentRequirementId: requirement.parent_requirement_id,
            milestoneId: requirement.milestone_id,
            milestoneName: requirement.milestone_name,
            reqCode: requirement.req_code,
            title: requirement.title,
            status: requirement.status,
            priority: requirement.priority,
            changeReason: requirement.change_reason,
            scopeNote: requirement.scope_note
          })),
        status: row.status,
        workflowInstanceId: row.workflow_instance_id,
        submittedBy: row.submitted_by,
        submittedAt: row.submitted_at,
        closedAt: row.closed_at
      }))
    }
  }
})
