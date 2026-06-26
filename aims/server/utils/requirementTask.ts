import type { PoolConnection, ResultSetHeader, RowDataPacket } from '~~/server/utils/db'

interface RequirementRow extends RowDataPacket {
  id: number
  item_kind: string
  project_id: number
  req_code: string
  title: string
  type: 'functional' | 'non_functional'
  status: string
  scope_note: string | null
  milestone_id: number | null
  work_item_id: number | null
}

interface TargetRow extends RowDataPacket {
  id: number
  milestone_id: number | null
  item_key: string
}

interface ProjectRow extends RowDataPacket {
  project_code: string
}

interface CounterRow extends RowDataPacket {
  next_number: number
}

interface ContentRow extends RowDataPacket {
  id: number
  content_original_id: number | null
  source_parent_id: number | null
  title: string
  heading_depth: number
  sort_order: number
  content_md: string | null
}

interface ContextModuleRow extends RowDataPacket {
  id: number
  title: string
  heading_depth: number
  sort_order: number
  content_md: string | null
}

export interface DeliverableInput {
  name?: string
  deliverableType?: 'document' | 'code' | 'artifact' | 'task'
  description?: string
  acceptanceCriteria?: string
  required?: boolean
}

export interface CreateRequirementTaskOptions {
  connection: PoolConnection
  requirementId: number
  uid: string
  title?: string | null
  description?: string | null
  milestoneId?: number | null
  assigneeUid?: string | null
  priority?: string | null
  estimatedHours?: number | null
  startDate?: string | null
  dueDate?: string | null
  reviewLevel?: number | null
  deliverables?: DeliverableInput[]
  status?: 'planning' | 'todo'
  skipIfTaskExists?: boolean
}

export interface CreateRequirementTaskSuccess {
  created: true
  requirementId: number
  taskId: number
  itemKey: string
  title: string
  milestoneId: number
  status: 'planning' | 'todo'
}

export interface CreateRequirementTaskSkipped {
  created: false
  requirementId: number
  reason: 'existing_task'
  message: string
}

export type CreateRequirementTaskResult = CreateRequirementTaskSuccess | CreateRequirementTaskSkipped

async function nextItemNumber(connection: PoolConnection, projectId: number) {
  await connection.execute(
    'UPDATE project_counters SET counter = LAST_INSERT_ID(counter + 1) WHERE project_id = ?',
    [projectId]
  )
  const [counterRows] = await connection.query<CounterRow[]>('SELECT LAST_INSERT_ID() AS next_number')
  const itemNumber = counterRows[0]?.next_number
  if (!itemNumber) {
    throw createError({ statusCode: 500, message: '生成编号失败' })
  }
  return itemNumber
}

function inferRequirementHeadingLevel(title: string): number | null {
  const normalizedTitle = title.trim()
  const match = normalizedTitle.match(/^(\d+(?:\.\d+)+)\b/)
  if (!match?.[1]) return null
  const segments = match[1].split('.').length
  return Math.min(6, Math.max(3, segments + 1))
}

function buildRequirementTaskDescription(
  reqCode: string,
  title: string,
  items: ContentRow[],
  scopeNote?: string | null,
  contextModules: ContextModuleRow[] = []
) {
  const headerLines = [
    '## 需求来源',
    '',
    `- 编号：${reqCode}`,
    `- 标题：${title}`
  ]
  if (scopeNote?.trim()) {
    headerLines.push(`- 范围说明：${scopeNote.trim()}`)
  }
  const header = `${headerLines.join('\n')}\n`
  if (!items.length) return header

  const sortedModules = [...contextModules].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  const sortedItems = [...items].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  const moduleMap = new Map(sortedModules.map(module => [module.id, module]))
  const moduleSections = new Map<number, ContentRow[]>()
  const standaloneItems: ContentRow[] = []

  for (const item of sortedItems) {
    if (item.source_parent_id && moduleMap.has(item.source_parent_id)) {
      if (!moduleSections.has(item.source_parent_id)) {
        moduleSections.set(item.source_parent_id, [])
      }
      moduleSections.get(item.source_parent_id)!.push(item)
    } else {
      standaloneItems.push(item)
    }
  }

  const renderItem = (item: ContentRow, fallbackMinDepth: number) => {
    const inferredLevel = inferRequirementHeadingLevel(item.title)
    const relativeLevel = Math.min(6, Math.max(3, 3 + ((item.heading_depth || fallbackMinDepth) - fallbackMinDepth)))
    const hashes = '#'.repeat(inferredLevel ?? relativeLevel)
    const md = (item.content_md || '').trim()
    return md ? `${hashes} ${item.title}\n\n${md}` : `${hashes} ${item.title}`
  }

  const bodyParts: string[] = []
  for (const module of sortedModules) {
    const itemsUnderModule = moduleSections.get(module.id) || []
    if (itemsUnderModule.length === 0) continue

    const moduleHeading = `${'#'.repeat(Math.min(6, Math.max(2, module.heading_depth || 2)))} ${module.title}`
    const moduleIntro = (module.content_md || '').trim()
    const moduleMinDepth = Math.min(...itemsUnderModule.map(item => item.heading_depth || 1))
    const moduleBody = itemsUnderModule.map(item => renderItem(item, moduleMinDepth)).join('\n\n')
    bodyParts.push([moduleHeading, moduleIntro, moduleBody].filter(Boolean).join('\n\n'))
  }

  if (standaloneItems.length > 0) {
    const standaloneMinDepth = Math.min(...standaloneItems.map(item => item.heading_depth || 1))
    for (const item of standaloneItems) {
      bodyParts.push(renderItem(item, standaloneMinDepth))
    }
  }

  return `${header}\n## 需求内容\n\n${bodyParts.join('\n\n')}\n`
}

async function buildRequirementDescription(connection: PoolConnection, req: RequirementRow) {
  const relationType = req.item_kind === 'change' ? 'change' : 'baseline'
  const visibleVersionStatuses = relationType === 'change'
    ? '\'baselined\', \'change_draft\', \'in_review\''
    : '\'draft\', \'baselined\''

  const [contents] = await connection.query<ContentRow[]>(
    `WITH RECURSIVE content_scope AS (
       SELECT c.id, c.content_original_id, c.parent_id AS source_parent_id,
              c.title, c.heading_depth, c.sort_order, c.content_md,
              CAST(CONCAT(LPAD(COALESCE(ric.sort_order, c.sort_order), 10, '0'), '.', LPAD(c.id, 10, '0')) AS CHAR(2000)) AS sort_path,
              CAST(CONCAT(',', c.id, ',') AS CHAR(2000)) AS path_ids
       FROM requirement_contents c
       LEFT JOIN requirement_item_contents ric
         ON ric.content_id = c.id
        AND ric.requirement_id = ?
        AND ric.relation_type = ?
       WHERE ric.id IS NOT NULL
         AND c.version_status IN (${visibleVersionStatuses})

       UNION ALL

       SELECT child.id, child.content_original_id, child.parent_id AS source_parent_id,
              child.title, child.heading_depth, child.sort_order, child.content_md,
              CONCAT(scope.sort_path, '.', LPAD(child.sort_order, 10, '0'), '.', LPAD(child.id, 10, '0')) AS sort_path,
              CONCAT(scope.path_ids, child.id, ',') AS path_ids
       FROM requirement_contents child
       INNER JOIN requirement_contents parent_version ON parent_version.id = child.parent_id
       INNER JOIN content_scope scope
         ON COALESCE(parent_version.content_original_id, parent_version.id) = COALESCE(scope.content_original_id, scope.id)
       WHERE child.project_id = ?
         AND child.version_status IN (${visibleVersionStatuses})
         AND LOCATE(CONCAT(',', child.id, ','), scope.path_ids) = 0
     )
     SELECT id, content_original_id, source_parent_id, title, heading_depth, sort_order, content_md
     FROM (
       SELECT content_scope.*,
              ROW_NUMBER() OVER (PARTITION BY id ORDER BY sort_path) AS rn
       FROM content_scope
     ) ranked
     WHERE rn = 1
     ORDER BY sort_path`,
    [req.id, relationType, req.project_id]
  )

  const contextModuleIds = [...new Set(
    contents
      .map(content => content.source_parent_id)
      .filter((id): id is number => !!id && !contents.some(item => item.id === id))
  )]

  let contextModules: ContextModuleRow[] = []
  if (contextModuleIds.length > 0) {
    const [rows] = await connection.query<ContextModuleRow[]>(
      `SELECT id, title, heading_depth, sort_order, content_md
       FROM requirement_contents
       WHERE id IN (${contextModuleIds.map(() => '?').join(',')})
       ORDER BY sort_order, id`,
      contextModuleIds
    )
    contextModules = rows
  }

  return buildRequirementTaskDescription(req.req_code, req.title, contents, req.scope_note, contextModules)
}

function normalizePriority(priority: string | null | undefined) {
  return ['P0', 'P1', 'P2', 'P3'].includes(priority || '') ? String(priority) : 'P2'
}

function normalizeReviewLevel(reviewLevel: number | null | undefined) {
  return Number.isInteger(reviewLevel) && reviewLevel! >= 0 && reviewLevel! <= 4
    ? Number(reviewLevel)
    : 1
}

function buildDefaultDeliverables(reqType: RequirementRow['type']) {
  if (reqType === 'functional') {
    return [{
      name: '代码',
      deliverableType: 'code' as const,
      description: '实现该需求并提交代码',
      acceptanceCriteria: '代码满足需求要求，并通过单元测试',
      required: true
    }]
  }
  return []
}

export async function createRequirementTaskFromRequirement(
  options: CreateRequirementTaskOptions
): Promise<CreateRequirementTaskResult> {
  const {
    connection,
    requirementId,
    uid,
    title,
    description,
    milestoneId,
    assigneeUid,
    priority,
    estimatedHours,
    startDate,
    dueDate,
    reviewLevel,
    deliverables,
    status,
    skipIfTaskExists
  } = options

  const [reqRows] = await connection.query<RequirementRow[]>(
    `SELECT id, item_kind, project_id, req_code, title, type, status, scope_note, milestone_id, work_item_id
     FROM requirement_items
     WHERE id = ?`,
    [requirementId]
  )
  const req = reqRows[0]
  if (!req) {
    throw createError({ statusCode: 404, message: '需求不存在' })
  }
  if (req.status !== 'baselined') {
    throw createError({ statusCode: 409, message: '只能为已基线的需求创建任务' })
  }

  const [existingTaskRows] = await connection.query<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM work_items WHERE requirement_id = ? AND type = \'task\' LIMIT 1',
    [requirementId]
  )
  if (existingTaskRows[0]) {
    if (skipIfTaskExists) {
      return {
        created: false,
        requirementId,
        reason: 'existing_task',
        message: '该需求已关联任务'
      }
    }
    throw createError({ statusCode: 409, message: '该需求已关联任务' })
  }

  const [targetRows] = await connection.query<TargetRow[]>(
    `SELECT id, milestone_id, item_key
     FROM work_items
     WHERE id = ? AND tier = 'target' AND type = 'requirement'
     LIMIT 1
     FOR UPDATE`,
    [req.work_item_id]
  )
  const targetRow = targetRows[0] || null

  const finalMilestoneId = milestoneId || req.milestone_id || targetRow?.milestone_id || null
  if (!finalMilestoneId) {
    throw createError({ statusCode: 400, message: '请指定里程碑' })
  }

  const [projectRows] = await connection.query<ProjectRow[]>(
    'SELECT project_code FROM aims_projects WHERE id = ?',
    [req.project_id]
  )
  const project = projectRows[0] || null

  const itemNumber = await nextItemNumber(connection, req.project_id)
  // 任务编号规则：
  //   - 挂接到需求 target（如 AIMS-3） → 顺序编号 AIMS-3-1, AIMS-3-2 ...
  //   - 无 target 兜底 → 沿用项目级自增编号 AIMS-{itemNumber}
  let itemKey: string
  if (targetRow) {
    const [seqRows] = await connection.query<(RowDataPacket & { next_seq: number })[]>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(item_key, '-', -1) AS UNSIGNED)), 0) + 1 AS next_seq
       FROM work_items
       WHERE parent_id = ?
         AND type = 'task'
         AND item_key LIKE CONCAT(?, '-%')`,
      [targetRow.id, targetRow.item_key]
    )
    const nextSeq = Number(seqRows[0]?.next_seq || 1)
    itemKey = `${targetRow.item_key}-${nextSeq}`
  } else {
    itemKey = `${project?.project_code || 'AIMS'}-${itemNumber}`
  }
  const finalTitle = title?.trim() || req.title
  const finalDescription = description?.trim() || await buildRequirementDescription(connection, req)
  const finalPriority = normalizePriority(priority)
  const finalReviewLevel = normalizeReviewLevel(reviewLevel)
  const finalStatus = status === 'planning' ? 'planning' : 'todo'

  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO work_items
     (project_id, milestone_id, item_number, item_key, tier, type, title, description,
      status, priority, assignee_uid, estimated_hours, start_date, due_date,
      review_level, requirement_id, reporter_uid, parent_id, sort_order)
     VALUES (?, ?, ?, ?, 'matter', 'task', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      req.project_id,
      finalMilestoneId,
      itemNumber,
      itemKey,
      finalTitle,
      finalDescription || null,
      finalStatus,
      finalPriority,
      assigneeUid || null,
      estimatedHours || null,
      startDate || null,
      dueDate || null,
      finalReviewLevel,
      requirementId,
      uid,
      targetRow?.id ?? null
    ]
  )
  const taskId = result.insertId

  let finalDeliverables = Array.isArray(deliverables) ? deliverables : []
  if (finalDeliverables.length === 0) {
    finalDeliverables = buildDefaultDeliverables(req.type)
  }

  for (let i = 0; i < finalDeliverables.length; i++) {
    const deliverable = finalDeliverables[i]
    if (!deliverable?.name?.trim()) continue

    const deliverableType: 'document' | 'code' | 'artifact' | 'task'
      = ['document', 'code', 'artifact', 'task'].includes(deliverable.deliverableType as string)
        ? (deliverable.deliverableType as 'document' | 'code' | 'artifact' | 'task')
        : 'code'

    await connection.execute(
      `INSERT INTO deliverables
       (project_id, project_code, matter_id, name, description, acceptance_criteria,
        deliverable_type, required, status, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        req.project_id,
        project?.project_code || null,
        taskId,
        deliverable.name.trim(),
        deliverable.description?.trim() || null,
        deliverable.acceptanceCriteria?.trim() || null,
        deliverableType,
        deliverable.required === false ? 0 : 1,
        i,
        uid
      ]
    )
  }

  await connection.execute(
    `UPDATE project_documents SET import_status = 'imported_locked'
     WHERE project_id = ? AND doc_category = 'requirement_spec' AND import_status != 'imported_locked'`,
    [req.project_id]
  )

  return {
    created: true,
    requirementId,
    taskId,
    itemKey,
    title: finalTitle,
    milestoneId: finalMilestoneId,
    status: finalStatus
  }
}
