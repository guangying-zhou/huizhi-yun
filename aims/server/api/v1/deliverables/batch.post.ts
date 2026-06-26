/**
 * 批量创建交付物
 * POST /api/v1/deliverables/batch
 * Body: { items: [{ entityType, entityId, name, description?, acceptanceCriteria?, deliverableType, required, projectId?, projectCode?, templateKey? }] }
 *
 * entityType 支持：project / milestone / target / matter
 * （旧值 task / work_item 兼容为 target；调用方如需创建 matter 中间产物请显式传 matter）
 */
import type { ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { resolveAimsProjectContext } from '~~/server/utils/aimsOwners'

type OwnerKind = 'project' | 'milestone' | 'target' | 'matter'

interface TierRow extends RowDataPacket {
  tier: string
}

function normalizeKind(entityType: string): OwnerKind {
  switch (entityType) {
    case 'project':
    case 'milestone':
    case 'target':
    case 'matter':
      return entityType
    case 'task':
    case 'work_item':
      return 'target'
    default:
      throw createError({ statusCode: 400, message: `不支持的 entityType: ${entityType}` })
  }
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const body = await readBody(event)
  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    throw createError({ statusCode: 400, message: 'items 不能为空' })
  }

  const values: unknown[][] = []
  for (const item of body.items) {
    if (!item.entityType || !item.entityId || !item.name) continue
    const kind = normalizeKind(String(item.entityType))
    const entityId = Number(item.entityId)

    // 当调用方传 work_item / task 时做一次安全校验：必须是 target 层
    if ((item.entityType === 'work_item' || item.entityType === 'task')) {
      const row = await queryRow<TierRow>(
        'SELECT tier FROM work_items WHERE id = ?',
        [entityId]
      )
      if (row && row.tier !== 'target') {
        throw createError({
          statusCode: 400,
          message: `work_item ${entityId} 不是目标层，中间产物请通过任务分解接口创建`
        })
      }
    }

    const projectContext = item.projectId
      ? { projectId: Number(item.projectId), projectCode: item.projectCode || null }
      : await resolveAimsProjectContext(
          kind === 'target' || kind === 'matter' ? 'work_item' : kind,
          entityId
        )

    if (!projectContext.projectId) {
      throw createError({ statusCode: 400, message: `无法解析交付物所属项目: ${item.entityType}#${entityId}` })
    }

    values.push([
      kind === 'project' ? entityId : null,
      kind === 'milestone' ? entityId : null,
      kind === 'target' ? entityId : null,
      kind === 'matter' ? entityId : null,
      item.name.trim(),
      item.description || null,
      item.acceptanceCriteria || null,
      item.deliverableType || 'document',
      item.required === undefined ? 1 : item.required ? 1 : 0,
      item.sortOrder || 0,
      'pending',
      projectContext.projectId,
      projectContext.projectCode,
      uid,
      item.templateKey || null
    ])
  }

  if (values.length === 0) {
    return { code: 0, data: { created: 0 } }
  }

  const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
  const flatParams = values.flat()

  await execute<ResultSetHeader>(
    `INSERT INTO deliverables
      (project_owner_id, milestone_owner_id, target_id, matter_id,
       name, description, acceptance_criteria, deliverable_type, \`required\`, sort_order,
       status, project_id, project_code, created_by, template_key)
     VALUES ${placeholders}`,
    flatParams
  )

  return {
    code: 0,
    data: { created: values.length }
  }
})
