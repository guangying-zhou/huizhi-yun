import type { RowDataPacket } from '~~/server/utils/db'
import { execute, queryRow, queryRows } from '~~/server/utils/db'

export interface MilestoneDeliverableCompat {
  name: string
  required: boolean
  completed: boolean
}

interface MilestoneDeliverableRow extends RowDataPacket {
  id: number
  milestone_owner_id: number
  name: string
  required: number
  status: string
}

interface ProjectCodeRow extends RowDataPacket {
  project_code: string | null
}

function normalizeMilestoneDeliverables(items: unknown): MilestoneDeliverableCompat[] {
  if (!Array.isArray(items)) return []

  const normalized: MilestoneDeliverableCompat[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const name = typeof item === 'object' && item && 'name' in item ? String(item.name || '').trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)

    normalized.push({
      name,
      required: typeof item === 'object' && item && 'required' in item
        ? item.required !== false
        : true,
      completed: Boolean(typeof item === 'object' && item && 'completed' in item ? item.completed : false)
    })
  }

  return normalized
}

export async function fetchMilestoneDeliverablesMap(projectId: number, milestoneIds: number[]): Promise<Map<number, MilestoneDeliverableCompat[]>> {
  const deliverableMap = new Map<number, MilestoneDeliverableCompat[]>()
  if (milestoneIds.length === 0) return deliverableMap

  const placeholders = milestoneIds.map(() => '?').join(', ')
  // 聚合到里程碑粒度：
  //   - milestone_owner_id 直挂里程碑的成果
  //   - target_id 指向的 work_item 所属里程碑（目标层成果要求）
  //   matter 的中间产物（target_id IS NULL 且 matter_id IS NOT NULL）不进入里程碑成果清单
  const rows = await queryRows<MilestoneDeliverableRow[]>(
    `SELECT
        d.id,
        COALESCE(d.milestone_owner_id, wi.milestone_id) AS milestone_owner_id,
        d.name,
        d.\`required\`,
        d.status
     FROM deliverables d
     LEFT JOIN work_items wi ON wi.id = d.target_id
     WHERE d.project_id = ?
       AND (
         d.milestone_owner_id IN (${placeholders})
         OR wi.milestone_id IN (${placeholders})
       )
     ORDER BY d.sort_order ASC, d.created_at ASC, d.id ASC`,
    [projectId, ...milestoneIds, ...milestoneIds]
  )

  for (const row of rows) {
    const list = deliverableMap.get(row.milestone_owner_id) || []
    const normalizedName = row.name.trim()
    const existing = list.find(item => item.name === normalizedName)

    if (existing) {
      existing.required = existing.required || Boolean(row.required)
      existing.completed = existing.completed || row.status === 'approved'
      continue
    }

    list.push({
      name: normalizedName,
      required: Boolean(row.required),
      completed: row.status === 'approved'
    })
    deliverableMap.set(row.milestone_owner_id, list)
  }

  // 补充：需求类 target 工作项默认无 deliverables 明细（需求项本身即其产物），
  // 以工作项标题作为里程碑信息卡的一项，状态取自工作项 status。
  interface RequirementTargetRow extends RowDataPacket {
    id: number
    milestone_id: number
    title: string
    status: string
    required: number
  }
  const reqRows = await queryRows<RequirementTargetRow[]>(
    `SELECT id, milestone_id, title, status, \`required\`
     FROM work_items
     WHERE project_id = ?
       AND tier = 'target'
       AND type = 'requirement'
       AND milestone_id IN (${placeholders})
     ORDER BY sort_order ASC, created_at ASC`,
    [projectId, ...milestoneIds]
  )
  for (const row of reqRows) {
    const list = deliverableMap.get(row.milestone_id) || []
    const name = row.title.trim()
    if (list.some(item => item.name === name)) continue
    list.push({
      name,
      required: Boolean(row.required),
      completed: row.status === 'completed'
    })
    deliverableMap.set(row.milestone_id, list)
  }

  return deliverableMap
}

export async function fetchMilestoneDeliverables(projectId: number, milestoneId: number): Promise<MilestoneDeliverableCompat[] | null> {
  const deliverableMap = await fetchMilestoneDeliverablesMap(projectId, [milestoneId])
  return deliverableMap.get(milestoneId) || null
}

export async function syncMilestoneDeliverables(options: {
  milestoneId: number
  projectId: number
  createdBy: string
  projectCode?: string | null
  items: unknown
}) {
  const normalized = normalizeMilestoneDeliverables(options.items)

  const existingRows = await queryRows<MilestoneDeliverableRow[]>(
    `SELECT id, milestone_owner_id, name, \`required\`, status
     FROM deliverables
     WHERE project_id = ?
       AND milestone_owner_id = ?`,
    [options.projectId, options.milestoneId]
  )

  const existingByName = new Map(existingRows.map(row => [row.name, row]))

  if (normalized.length === 0) {
    await execute(
      'DELETE FROM deliverables WHERE project_id = ? AND milestone_owner_id = ?',
      [options.projectId, options.milestoneId]
    )
    return
  }

  let projectCode = options.projectCode ?? null
  if (projectCode === null) {
    const project = await queryRow<ProjectCodeRow>(
      'SELECT project_code FROM aims_projects WHERE id = ?',
      [options.projectId]
    )
    projectCode = project?.project_code ?? null
  }

  const incomingNames = normalized.map(item => item.name)
  const deletePlaceholders = incomingNames.map(() => '?').join(', ')

  await execute(
    `DELETE FROM deliverables
     WHERE project_id = ?
       AND milestone_owner_id = ?
       AND name NOT IN (${deletePlaceholders})`,
    [options.projectId, options.milestoneId, ...incomingNames]
  )

  for (const [index, item] of normalized.entries()) {
    const status = item.completed ? 'approved' : 'pending'
    const existing = existingByName.get(item.name)

    if (existing) {
      await execute(
        `UPDATE deliverables
         SET \`required\` = ?, sort_order = ?, status = ?
         WHERE id = ?`,
        [item.required ? 1 : 0, index, status, existing.id]
      )
      continue
    }

    await execute(
      `INSERT INTO deliverables
        (project_owner_id, milestone_owner_id, target_id, matter_id,
         name, description, acceptance_criteria, deliverable_type, \`required\`, sort_order,
         status, project_id, project_code, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        null,
        options.milestoneId,
        null,
        null,
        item.name,
        null,
        null,
        'document',
        item.required ? 1 : 0,
        index,
        status,
        options.projectId,
        projectCode,
        options.createdBy
      ]
    )
  }
}
