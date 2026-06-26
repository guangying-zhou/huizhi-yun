/**
 * 查询交付物列表
 * GET /api/v1/deliverables?entity_type=&entity_id=&project_id=&status=
 *
 * 归属语义（target_id / matter_id 拆分后）：
 *   - entity_type=project   → project_owner_id IS NOT NULL
 *   - entity_type=milestone → milestone_owner_id IS NOT NULL
 *   - entity_type=target    → target_id IS NOT NULL
 *   - entity_type=matter    → matter_id IS NOT NULL（包含承接行与中间产物）
 *   - entity_type=work_item → 同时兼容 target 与 matter，由 entity_id 决定
 *
 * 项目级视图（仅 project_id，不带 entity 过滤）：
 *   只返回「里程碑级成果要求」= project_owner + milestone_owner + target_id 行，
 *   matter 的中间产物不出现在项目成果清单中。
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface DeliverableRow extends RowDataPacket {
  id: number
  project_owner_id: number | null
  milestone_owner_id: number | null
  target_id: number | null
  matter_id: number | null
  name: string
  description: string | null
  acceptance_criteria: string | null
  deliverable_type: string
  required: number
  sort_order: number
  status: string
  document_uuid: string | null
  document_title: string | null
  document_source: 'codocs' | 'repo'
  repo_project_code: string | null
  repo_file_path: string | null
  repo_commit_id: string | null
  evidence_url: string | null
  evidence_note: string | null
  submitted_by: string | null
  submitted_at: string | null
  project_id: number | null
  project_code: string | null
  target_item_key: string | null
  target_title: string | null
  matter_item_key: string | null
  matter_title: string | null
  created_by: string
  created_at: string
  updated_at: string
}

function resolveEntity(row: DeliverableRow): { entityType: string, entityId: number | null } {
  if (row.project_owner_id) return { entityType: 'project', entityId: row.project_owner_id }
  if (row.milestone_owner_id) return { entityType: 'milestone', entityId: row.milestone_owner_id }
  if (row.target_id) return { entityType: 'target', entityId: row.target_id }
  if (row.matter_id) return { entityType: 'matter', entityId: row.matter_id }
  return { entityType: 'unknown', entityId: null }
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const query = getQuery(event)
  const conditions: string[] = []
  const params: unknown[] = []

  const rawEntityType = query.entity_type ? String(query.entity_type) : null
  const entityId = query.entity_id ? Number(query.entity_id) : null

  if (rawEntityType) {
    switch (rawEntityType) {
      case 'project':
        conditions.push('d.project_owner_id IS NOT NULL')
        if (entityId !== null) {
          conditions.push('d.project_owner_id = ?')
          params.push(entityId)
        }
        break
      case 'milestone':
        conditions.push('d.milestone_owner_id IS NOT NULL')
        if (entityId !== null) {
          conditions.push('d.milestone_owner_id = ?')
          params.push(entityId)
        }
        break
      case 'target':
        conditions.push('d.target_id IS NOT NULL')
        if (entityId !== null) {
          conditions.push('d.target_id = ?')
          params.push(entityId)
        }
        break
      case 'matter':
        conditions.push('d.matter_id IS NOT NULL')
        if (entityId !== null) {
          conditions.push('d.matter_id = ?')
          params.push(entityId)
        }
        break
      case 'task':
      case 'work_item':
        if (entityId !== null) {
          conditions.push('(d.target_id = ? OR d.matter_id = ?)')
          params.push(entityId, entityId)
        } else {
          conditions.push('(d.target_id IS NOT NULL OR d.matter_id IS NOT NULL)')
        }
        break
      default:
        throw createError({ statusCode: 400, message: `不支持的 entity_type: ${rawEntityType}` })
    }
  } else if (entityId !== null) {
    conditions.push('(d.project_owner_id = ? OR d.milestone_owner_id = ? OR d.target_id = ? OR d.matter_id = ?)')
    params.push(entityId, entityId, entityId, entityId)
  }

  if (query.project_id) {
    conditions.push('d.project_id = ?')
    params.push(Number(query.project_id))
  }
  if (query.status) {
    conditions.push('d.status = ?')
    params.push(query.status)
  }

  const isProjectScopeView = Boolean(query.project_id) && !rawEntityType && entityId === null
  // 项目级视图只看「里程碑级成果要求」，排除 matter 中间产物
  if (isProjectScopeView) {
    conditions.push('(d.project_owner_id IS NOT NULL OR d.milestone_owner_id IS NOT NULL OR d.target_id IS NOT NULL)')
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = await queryRows<DeliverableRow[]>(
    `SELECT d.*,
            target_wi.item_key AS target_item_key,
            target_wi.title AS target_title,
            matter_wi.item_key AS matter_item_key,
            matter_wi.title AS matter_title
     FROM deliverables d
     LEFT JOIN work_items target_wi ON target_wi.id = d.target_id
     LEFT JOIN work_items matter_wi ON matter_wi.id = d.matter_id
     ${whereClause}
     ORDER BY COALESCE(d.target_id, d.matter_id, d.milestone_owner_id, d.project_owner_id, d.id) ASC,
              d.sort_order ASC,
              d.created_at ASC`,
    params
  )

  return {
    code: 0,
    data: rows.map((r) => {
      const { entityType, entityId: eid } = resolveEntity(r)
      return {
        id: r.id,
        entityType,
        entityId: eid,
        targetId: r.target_id,
        matterId: r.matter_id,
        name: r.name,
        description: r.description,
        acceptanceCriteria: r.acceptance_criteria,
        deliverableType: r.deliverable_type,
        required: Boolean(r.required),
        sortOrder: r.sort_order,
        status: r.status,
        documentUuid: r.document_uuid,
        documentTitle: r.document_title,
        documentSource: r.document_source || 'codocs',
        repoProjectCode: r.repo_project_code,
        repoFilePath: r.repo_file_path,
        repoCommitId: r.repo_commit_id,
        evidenceUrl: r.evidence_url,
        evidenceNote: r.evidence_note,
        submittedBy: r.submitted_by,
        submittedAt: r.submitted_at,
        projectId: r.project_id,
        projectCode: r.project_code,
        targetItemKey: r.target_item_key,
        targetTitle: r.target_title,
        matterItemKey: r.matter_item_key,
        matterTitle: r.matter_title,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }
    })
  }
})
