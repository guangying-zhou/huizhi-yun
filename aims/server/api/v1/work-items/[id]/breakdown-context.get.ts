/**
 * 获取工作项分解页上下文
 * GET /api/v1/work-items/:id/breakdown-context
 */
import type { RowDataPacket } from '~~/server/utils/db'
import { hasWorkItemStartDateColumn } from '~~/server/utils/workItemStartDate'

interface ItemRow extends RowDataPacket {
  id: number
  project_id: number
  project_code: string
  project_name: string
  milestone_id: number
  milestone_name: string
  milestone_start_date: string | null
  milestone_end_date: string | null
  pivr_stage: string | null
  item_number: number
  item_key: string
  tier: string
  type: string
  title: string
  description: string | null
  start_date: string | null
  due_date: string | null
  status: string
  priority: string
  severity: string | null
  assignee_uid: string | null
  reporter_uid: string | null
  estimated_hours: number | null
  parent_id: number | null
  approval_status: string
  review_level: number
  required: number
  template_key: string | null
  created_at: string
  updated_at: string
}

interface DeliverableRow extends RowDataPacket {
  id: number
  project_id: number
  project_code: string | null
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
  document_source: 'codocs' | 'repo' | null
  repo_project_code: string | null
  repo_file_path: string | null
  repo_commit_id: string | null
  evidence_url: string | null
  evidence_note: string | null
  submitted_by: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
  source_stage: string | null
  source_milestone_name: string | null
  source_item_key: string | null
  source_item_title: string | null
}

interface DocumentRow extends RowDataPacket {
  id: number
  uuid: string
  title: string
  doc_category: string | null
  codocs_uuid: string | null
  document_source: 'codocs' | 'repo' | null
  repo_project_code: string | null
  repo_file_path: string | null
  repo_commit_id: string | null
  content_size: number
  created_at: string
  updated_at: string
  milestone_id: number | null
  work_item_id: number | null
  source_stage: string | null
  source_milestone_name: string | null
  source_item_key: string | null
  source_item_title: string | null
}

interface ChildRow extends RowDataPacket {
  id: number
  project_id: number
  milestone_id: number
  item_number: number
  item_key: string
  tier: string
  type: string
  title: string
  description: string | null
  start_date: string | null
  due_date: string | null
  status: string
  priority: string
  severity: string | null
  assignee_uid: string | null
  reporter_uid: string | null
  estimated_hours: number | null
  parent_id: number | null
  sort_order: number
  approval_status: string
  required: number
  template_key: string | null
  created_at: string
  updated_at: string
}

interface ApprovalRow extends RowDataPacket {
  id: number
  transition: string
  title: string | null
  requested_by: string
  requested_at: string
  request_comment: string | null
  reviewer_uid: string | null
  status: string
  reviewed_at: string | null
  review_comment: string | null
  created_at: string
}

/** 可纳入前序产物的任务状态：已提交确认 / 已完成 */
const terminalStatuses = ['in_review', 'completed']

function resolveEntity(row: DeliverableRow): { entityType: string, entityId: number | null } {
  if (row.project_owner_id) return { entityType: 'project', entityId: row.project_owner_id }
  if (row.milestone_owner_id) return { entityType: 'milestone', entityId: row.milestone_owner_id }
  if (row.target_id) return { entityType: 'target', entityId: row.target_id }
  if (row.matter_id) return { entityType: 'matter', entityId: row.matter_id }
  return { entityType: 'unknown', entityId: null }
}

function mapDeliverable(row: DeliverableRow) {
  const { entityType, entityId } = resolveEntity(row)
  return {
    id: row.id,
    entityType,
    entityId,
    targetId: row.target_id,
    matterId: row.matter_id,
    // sourceDeliverableId 保留作为前端兼容字段：target 行本身的 id 就是"承接源"
    sourceDeliverableId: row.target_id && row.matter_id ? row.id : null,
    name: row.name,
    description: row.description,
    acceptanceCriteria: row.acceptance_criteria,
    deliverableType: row.deliverable_type,
    required: Boolean(row.required),
    sortOrder: row.sort_order,
    status: row.status,
    documentUuid: row.document_uuid,
    documentTitle: row.document_title,
    documentSource: row.document_source || 'codocs',
    repoProjectCode: row.repo_project_code,
    repoFilePath: row.repo_file_path,
    repoCommitId: row.repo_commit_id,
    evidenceUrl: row.evidence_url,
    evidenceNote: row.evidence_note,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    projectId: row.project_id,
    projectCode: row.project_code,
    sourceStage: row.source_stage,
    sourceMilestoneName: row.source_milestone_name,
    sourceItemKey: row.source_item_key,
    sourceItemTitle: row.source_item_title,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapDocument(row: DocumentRow) {
  const source = row.document_source || (row.repo_project_code && row.repo_file_path ? 'repo' : 'codocs')
  return {
    id: row.id,
    uuid: row.uuid,
    title: row.title,
    docCategory: row.doc_category,
    codocsUuid: row.codocs_uuid,
    documentSource: source,
    repoProjectCode: row.repo_project_code,
    repoFilePath: row.repo_file_path,
    repoCommitId: row.repo_commit_id,
    contentSize: row.content_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    milestoneId: row.milestone_id,
    workItemId: row.work_item_id,
    sourceStage: row.source_stage,
    sourceMilestoneName: row.source_milestone_name,
    sourceItemKey: row.source_item_key,
    sourceItemTitle: row.source_item_title
  }
}

function getDocumentDedupKey(doc: ReturnType<typeof mapDocument>) {
  if (doc.documentSource === 'repo') {
    return `repo:${doc.repoProjectCode || ''}:${doc.repoFilePath || ''}:${doc.repoCommitId || ''}`
  }
  return `codocs:${doc.codocsUuid || doc.uuid || ''}`
}

function mapChild(row: ChildRow, deliverables: ReturnType<typeof mapDeliverable>[]) {
  return {
    id: row.id,
    projectId: row.project_id,
    milestoneId: row.milestone_id,
    itemNumber: row.item_number,
    itemKey: row.item_key,
    tier: row.tier,
    type: row.type,
    title: row.title,
    description: row.description,
    startDate: row.start_date,
    dueDate: row.due_date,
    status: row.status,
    priority: row.priority,
    severity: row.severity,
    assigneeUid: row.assignee_uid,
    reporterUid: row.reporter_uid,
    estimatedHours: row.estimated_hours,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    required: Boolean(row.required),
    templateKey: row.template_key,
    approvalStatus: row.approval_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliverables
  }
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const workItemId = Number(getRouterParam(event, 'id'))
  if (!workItemId || Number.isNaN(workItemId)) {
    throw createError({ statusCode: 400, message: '无效的工作项ID' })
  }

  const supportsStartDate = await hasWorkItemStartDateColumn()

  const item = await queryRow<ItemRow>(
    `SELECT
        wi.id,
        wi.project_id,
        p.project_code,
        p.name AS project_name,
        wi.milestone_id,
        m.name AS milestone_name,
        m.start_date AS milestone_start_date,
        m.end_date AS milestone_end_date,
        m.pivr_stage,
        wi.item_number,
        wi.item_key,
        wi.tier,
        wi.type,
        wi.title,
        wi.description,
        ${supportsStartDate ? 'wi.start_date' : 'NULL AS start_date'},
        wi.due_date,
        wi.status,
        wi.priority,
        wi.severity,
        wi.assignee_uid,
        wi.reporter_uid,
        wi.estimated_hours,
        wi.parent_id,
        wi.approval_status,
        wi.review_level,
        wi.required,
        wi.template_key,
        wi.created_at,
        wi.updated_at
     FROM work_items wi
     JOIN aims_projects p ON p.id = wi.project_id
     JOIN milestones m ON m.id = wi.milestone_id
     WHERE wi.id = ?`,
    [workItemId]
  )

  if (!item) {
    throw createError({ statusCode: 404, message: '工作项不存在' })
  }

  const [currentDeliverableRows, currentDocumentRows, childRows, latestApproval, pendingApproval] = await Promise.all([
    queryRows<DeliverableRow[]>(
      // 当前目标的成果要求（含已被 matter 承接的行）
      `SELECT
          d.*,
          m.pivr_stage AS source_stage,
          m.name AS source_milestone_name,
          wi.item_key AS source_item_key,
          wi.title AS source_item_title
       FROM deliverables d
       LEFT JOIN milestones m ON m.id = d.milestone_owner_id
       LEFT JOIN work_items wi ON wi.id = d.target_id
       WHERE d.project_id = ?
         AND d.target_id = ?
       ORDER BY d.sort_order ASC, d.created_at ASC`,
      [item.project_id, workItemId]
    ),
    queryRows<DocumentRow[]>(
      `SELECT
          d.id,
          d.uuid,
          d.title,
          d.doc_category,
          d.codocs_uuid,
          d.document_source,
          d.repo_project_code,
          d.repo_file_path,
          d.repo_commit_id,
          d.content_size,
          d.created_at,
          d.updated_at,
          d.milestone_id,
          d.work_item_id,
          m.pivr_stage AS source_stage,
          m.name AS source_milestone_name,
          wi.item_key AS source_item_key,
          wi.title AS source_item_title
       FROM project_documents d
       LEFT JOIN milestones m ON m.id = d.milestone_id
       LEFT JOIN work_items wi ON wi.id = d.work_item_id
       WHERE d.work_item_id = ?
         AND d.is_folder = 0
       ORDER BY d.updated_at DESC, d.created_at DESC`,
      [workItemId]
    ),
    queryRows<ChildRow[]>(
      `SELECT *,
              ${supportsStartDate ? 'start_date' : 'NULL AS start_date'}
       FROM work_items
       WHERE parent_id = ?
       ORDER BY sort_order ASC, created_at ASC`,
      [workItemId]
    ),
    queryRow<ApprovalRow>(
      `SELECT id, transition, title, requested_by, requested_at, request_comment,
              reviewer_uid, status, reviewed_at, review_comment, created_at
       FROM approval_records
       WHERE project_id = ?
         AND work_item_owner_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [item.project_id, workItemId]
    ),
    queryRow<ApprovalRow>(
      `SELECT id, transition, title, requested_by, requested_at, request_comment,
              reviewer_uid, status, reviewed_at, review_comment, created_at
       FROM approval_records
       WHERE project_id = ?
         AND work_item_owner_id = ?
         AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [item.project_id, workItemId]
    )
  ])

  const childIds = childRows.map(child => child.id)
  // child matter 相关的成果 = 承接的 target 成果（target_id IS NOT NULL 且 matter_id = child）
  //                        + 该 matter 的中间产物（target_id IS NULL 且 matter_id = child）
  const childDeliverableRows = childIds.length > 0
    ? await queryRows<DeliverableRow[]>(
        `SELECT
            d.*,
            m.pivr_stage AS source_stage,
            m.name AS source_milestone_name,
            wi.item_key AS source_item_key,
            wi.title AS source_item_title
         FROM deliverables d
         LEFT JOIN milestones m ON m.id = d.milestone_owner_id
         LEFT JOIN work_items wi ON wi.id = COALESCE(d.target_id, d.matter_id)
         WHERE d.project_id = ?
           AND d.matter_id IN (${childIds.map(() => '?').join(', ')})
         ORDER BY d.sort_order ASC, d.created_at ASC`,
        [item.project_id, ...childIds]
      )
    : []

  const childDeliverableMap = new Map<number, ReturnType<typeof mapDeliverable>[]>()
  for (const row of childDeliverableRows) {
    if (!row.matter_id) continue
    const list = childDeliverableMap.get(row.matter_id) || []
    list.push(mapDeliverable(row))
    childDeliverableMap.set(row.matter_id, list)
  }

  // ── 前序阶段产物：项目文档 + 前序里程碑文档 + 本里程碑已完成工作项文档 ──

  // 1) 项目级文档（不挂在里程碑或工作项下的）
  const projectLevelDocs = await queryRows<DocumentRow[]>(
    `SELECT
        d.id, d.uuid, d.title, d.doc_category, d.codocs_uuid, d.content_size,
        d.document_source, d.repo_project_code, d.repo_file_path, d.repo_commit_id,
        d.created_at, d.updated_at, d.milestone_id, d.work_item_id,
        NULL AS source_stage, NULL AS source_milestone_name,
        NULL AS source_item_key, NULL AS source_item_title
     FROM project_documents d
     WHERE d.project_id = ?
       AND d.milestone_id IS NULL
       AND d.work_item_id IS NULL
       AND d.is_folder = 0
     ORDER BY d.sort_order ASC, d.updated_at DESC`,
    [item.project_id]
  )

  // 2) 查询当前里程碑的 sort_order，找到排在它前面的所有里程碑
  interface MilestoneMetaRow extends RowDataPacket {
    id: number
    name: string
    pivr_stage: string | null
    sort_order: number
  }
  const currentMsRow = await queryRow<RowDataPacket & { sort_order: number }>(
    'SELECT sort_order FROM milestones WHERE id = ?',
    [item.milestone_id]
  )
  const currentMsSortOrder = currentMsRow?.sort_order ?? 0

  const priorMilestoneRows = await queryRows<MilestoneMetaRow[]>(
    `SELECT id, name, pivr_stage, sort_order
     FROM milestones
     WHERE project_id = ?
       AND id != ?
       AND sort_order < ?
     ORDER BY sort_order ASC, start_date ASC, id ASC`,
    [item.project_id, item.milestone_id, currentMsSortOrder]
  )

  // 查询前序里程碑的文档（直接挂里程碑的 + 挂工作项的 + 任务交付物绑定文档）
  let priorMilestoneDocs: DocumentRow[] = []
  const priorMilestoneIds = priorMilestoneRows.map(ms => ms.id)
  if (priorMilestoneIds.length > 0) {
    const ph = priorMilestoneIds.map(() => '?').join(', ')
    const baseMilestoneDocs = await queryRows<DocumentRow[]>(
      `SELECT
          d.id, d.uuid, d.title, d.doc_category, d.codocs_uuid, d.content_size,
          d.document_source, d.repo_project_code, d.repo_file_path, d.repo_commit_id,
          d.created_at, d.updated_at, d.milestone_id, d.work_item_id,
          COALESCE(m.pivr_stage, mw.pivr_stage) AS source_stage,
          COALESCE(m.name, mw.name) AS source_milestone_name,
          wi.item_key AS source_item_key,
          wi.title AS source_item_title
       FROM project_documents d
       LEFT JOIN milestones m ON m.id = d.milestone_id
       LEFT JOIN work_items wi ON wi.id = d.work_item_id
       LEFT JOIN milestones mw ON mw.id = wi.milestone_id
       WHERE d.is_folder = 0
         AND (
           d.milestone_id IN (${ph})
           OR wi.milestone_id IN (${ph})
         )
       ORDER BY COALESCE(m.sort_order, mw.sort_order) ASC, d.updated_at DESC`,
      [...priorMilestoneIds, ...priorMilestoneIds]
    )

    interface PriorDeliverableDocRow extends RowDataPacket {
      deliverable_id: number
      deliverable_name: string
      work_item_id: number
      milestone_id: number
      source_stage: string | null
      source_milestone_name: string | null
      source_item_key: string | null
      source_item_title: string | null
      document_uuid: string | null
      document_title: string | null
      document_source: 'codocs' | 'repo' | null
      repo_project_code: string | null
      repo_file_path: string | null
      repo_commit_id: string | null
      created_at: string
      updated_at: string
    }

    const priorDeliverableDocs = await queryRows<PriorDeliverableDocRow[]>(
      `SELECT
          d.id AS deliverable_id,
          d.name AS deliverable_name,
          wi.id AS work_item_id,
          wi.milestone_id AS milestone_id,
          m.pivr_stage AS source_stage,
          m.name AS source_milestone_name,
          wi.item_key AS source_item_key,
          wi.title AS source_item_title,
          d.document_uuid,
          d.document_title,
          d.document_source,
          d.repo_project_code,
          d.repo_file_path,
          d.repo_commit_id,
          d.created_at,
          d.updated_at
       FROM deliverables d
       JOIN work_items wi ON wi.id = d.matter_id
       JOIN milestones m ON m.id = wi.milestone_id
       WHERE wi.milestone_id IN (${ph})
         AND (
           d.document_uuid IS NOT NULL
           OR (d.repo_project_code IS NOT NULL AND d.repo_file_path IS NOT NULL)
         )
       ORDER BY m.sort_order ASC, wi.sort_order ASC, d.updated_at DESC`,
      [...priorMilestoneIds]
    )

    const deliverableDocsAsDocuments: DocumentRow[] = priorDeliverableDocs.map(doc => ({
      id: -doc.deliverable_id,
      uuid: doc.document_uuid || `deliverable-${doc.deliverable_id}`,
      title: doc.document_title || doc.deliverable_name,
      doc_category: 'deliverable',
      codocs_uuid: doc.document_source === 'repo' ? null : doc.document_uuid,
      document_source: doc.document_source,
      repo_project_code: doc.repo_project_code,
      repo_file_path: doc.repo_file_path,
      repo_commit_id: doc.repo_commit_id,
      content_size: 0,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      milestone_id: doc.milestone_id,
      work_item_id: doc.work_item_id,
      source_stage: doc.source_stage,
      source_milestone_name: doc.source_milestone_name,
      source_item_key: doc.source_item_key,
      source_item_title: doc.source_item_title
    } as DocumentRow))

    priorMilestoneDocs = [...baseMilestoneDocs, ...deliverableDocsAsDocuments]
  }

  // 3) 本里程碑已提交确认/已完成工作项（不含当前工作项及其子项）的文档
  const terminalPh = terminalStatuses.map(() => '?').join(', ')
  const completedItemDocs = await queryRows<DocumentRow[]>(
    `SELECT
        d.id, d.uuid, d.title, d.doc_category, d.codocs_uuid, d.content_size,
        d.document_source, d.repo_project_code, d.repo_file_path, d.repo_commit_id,
        d.created_at, d.updated_at, d.milestone_id, d.work_item_id,
        m.pivr_stage AS source_stage,
        m.name AS source_milestone_name,
        wi.item_key AS source_item_key,
        wi.title AS source_item_title
     FROM project_documents d
     JOIN work_items wi ON wi.id = d.work_item_id
     JOIN milestones m ON m.id = wi.milestone_id
     WHERE d.is_folder = 0
       AND wi.milestone_id = ?
       AND wi.status IN (${terminalPh})
       AND wi.id != ?
       AND wi.id NOT IN (SELECT id FROM work_items WHERE parent_id = ?)
     ORDER BY wi.sort_order ASC, d.updated_at DESC`,
    [item.milestone_id, ...terminalStatuses, workItemId, workItemId]
  )

  interface CompletedDeliverableDocRow extends RowDataPacket {
    deliverable_id: number
    deliverable_name: string
    work_item_id: number
    milestone_id: number
    source_stage: string | null
    source_milestone_name: string | null
    source_item_key: string | null
    source_item_title: string | null
    document_uuid: string | null
    document_title: string | null
    document_source: 'codocs' | 'repo' | null
    repo_project_code: string | null
    repo_file_path: string | null
    repo_commit_id: string | null
    created_at: string
    updated_at: string
  }

  const completedDeliverableDocs = await queryRows<CompletedDeliverableDocRow[]>(
    `SELECT
        d.id AS deliverable_id,
        d.name AS deliverable_name,
        wi.id AS work_item_id,
        wi.milestone_id AS milestone_id,
        m.pivr_stage AS source_stage,
        m.name AS source_milestone_name,
        wi.item_key AS source_item_key,
        wi.title AS source_item_title,
        d.document_uuid,
        d.document_title,
        d.document_source,
        d.repo_project_code,
        d.repo_file_path,
        d.repo_commit_id,
        d.created_at,
        d.updated_at
     FROM deliverables d
     JOIN work_items wi ON wi.id = d.matter_id
     JOIN milestones m ON m.id = wi.milestone_id
     WHERE wi.milestone_id = ?
       AND wi.status IN (${terminalPh})
       AND wi.id != ?
       AND wi.id NOT IN (SELECT id FROM work_items WHERE parent_id = ?)
       AND (
         d.document_uuid IS NOT NULL
         OR (d.repo_project_code IS NOT NULL AND d.repo_file_path IS NOT NULL)
       )
     ORDER BY wi.sort_order ASC, d.updated_at DESC`,
    [item.milestone_id, ...terminalStatuses, workItemId, workItemId]
  )

  // 4) 本里程碑已提交确认/已完成工作项列表（用于树形展示）
  interface CompletedItemRow extends RowDataPacket {
    id: number
    item_key: string
    title: string
    type: string
    status: string
  }
  const completedWorkItems = await queryRows<CompletedItemRow[]>(
    `SELECT id, item_key, title, type, status
     FROM work_items
     WHERE milestone_id = ?
       AND status IN (${terminalPh})
       AND id != ?
       AND id NOT IN (SELECT id FROM work_items WHERE parent_id = ?)
     ORDER BY sort_order ASC, created_at ASC`,
    [item.milestone_id, ...terminalStatuses, workItemId, workItemId]
  )

  // ── 组装树形结构 ──
  const previousMilestones = priorMilestoneRows.map(row => ({
    id: row.id,
    name: row.name,
    pivrStage: row.pivr_stage
  }))

  // 构建里程碑 -> 工作项 -> 文档的映射
  const priorMilestoneDocMap = new Map<number, {
    milestoneDocs: ReturnType<typeof mapDocument>[]
    workItemDocs: Map<number, {
      itemKey: string
      itemTitle: string
      docs: ReturnType<typeof mapDocument>[]
    }>
  }>()

  for (const msId of priorMilestoneIds) {
    priorMilestoneDocMap.set(msId, { milestoneDocs: [], workItemDocs: new Map() })
  }

  for (const doc of priorMilestoneDocs) {
    const mapped = mapDocument(doc)
    if (doc.work_item_id) {
      // 挂在工作项上 → 通过工作项的 milestone 归到对应里程碑
      const targetMsId = doc.milestone_id
        || priorMilestoneRows.find(ms => ms.name === doc.source_milestone_name)?.id
      if (targetMsId && priorMilestoneDocMap.has(targetMsId)) {
        const entry = priorMilestoneDocMap.get(targetMsId)!
        if (!entry.workItemDocs.has(doc.work_item_id)) {
          entry.workItemDocs.set(doc.work_item_id, {
            itemKey: doc.source_item_key || '',
            itemTitle: doc.source_item_title || '',
            docs: []
          })
        }
        const wiDocs = entry.workItemDocs.get(doc.work_item_id)!.docs
        const key = getDocumentDedupKey(mapped)
        if (!wiDocs.some(x => getDocumentDedupKey(x) === key)) {
          wiDocs.push(mapped)
        }
      }
    } else if (doc.milestone_id && priorMilestoneDocMap.has(doc.milestone_id)) {
      // 直接挂在里程碑上
      const milestoneDocs = priorMilestoneDocMap.get(doc.milestone_id)!.milestoneDocs
      const key = getDocumentDedupKey(mapped)
      if (!milestoneDocs.some(x => getDocumentDedupKey(x) === key)) {
        milestoneDocs.push(mapped)
      }
    }
  }

  // 本里程碑已完成工作项文档映射
  const completedItemDocMap = new Map<number, ReturnType<typeof mapDocument>[]>()
  function getDocDedupKey(doc: ReturnType<typeof mapDocument>) {
    if (doc.documentSource === 'repo') {
      return `repo:${doc.repoProjectCode || ''}:${doc.repoFilePath || ''}:${doc.repoCommitId || ''}`
    }
    return `codocs:${doc.codocsUuid || doc.uuid || ''}`
  }
  function pushCompletedDoc(workItemId: number, doc: ReturnType<typeof mapDocument>) {
    const list = completedItemDocMap.get(workItemId) || []
    const key = getDocDedupKey(doc)
    if (!list.some(x => getDocDedupKey(x) === key)) {
      list.push(doc)
      completedItemDocMap.set(workItemId, list)
    }
  }
  for (const doc of completedItemDocs) {
    if (!doc.work_item_id) continue
    pushCompletedDoc(doc.work_item_id, mapDocument(doc))
  }
  for (const doc of completedDeliverableDocs) {
    const mapped = mapDocument({
      id: -doc.deliverable_id,
      uuid: doc.document_uuid || `deliverable-${doc.deliverable_id}`,
      title: doc.document_title || doc.deliverable_name,
      doc_category: 'deliverable',
      codocs_uuid: doc.document_source === 'repo' ? null : doc.document_uuid,
      document_source: doc.document_source,
      repo_project_code: doc.repo_project_code,
      repo_file_path: doc.repo_file_path,
      repo_commit_id: doc.repo_commit_id,
      content_size: 0,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      milestone_id: doc.milestone_id,
      work_item_id: doc.work_item_id,
      source_stage: doc.source_stage,
      source_milestone_name: doc.source_milestone_name,
      source_item_key: doc.source_item_key,
      source_item_title: doc.source_item_title
    } as DocumentRow)
    pushCompletedDoc(doc.work_item_id, mapped)
  }

  // 组装树形数据
  const treeData = {
    project: {
      id: item.project_id,
      name: item.project_name,
      documents: projectLevelDocs.map(mapDocument)
    },
    milestones: previousMilestones.map((ms) => {
      const entry = priorMilestoneDocMap.get(ms.id)
      const workItems: Array<{
        id: number
        itemKey: string
        title: string
        documents: ReturnType<typeof mapDocument>[]
      }> = []
      if (entry) {
        for (const [wiId, wiData] of entry.workItemDocs) {
          workItems.push({
            id: wiId,
            itemKey: wiData.itemKey,
            title: wiData.itemTitle,
            documents: wiData.docs
          })
        }
      }
      return {
        id: ms.id,
        name: ms.name,
        pivrStage: ms.pivrStage,
        documents: entry?.milestoneDocs || [],
        workItems
      }
    }),
    currentMilestoneCompleted: {
      milestoneId: item.milestone_id,
      milestoneName: item.milestone_name,
      pivrStage: item.pivr_stage,
      workItems: completedWorkItems.map(wi => ({
        id: wi.id,
        itemKey: wi.item_key,
        title: wi.title,
        documents: completedItemDocMap.get(wi.id) || []
      }))
    }
  }

  return {
    code: 0,
    data: {
      item: {
        id: item.id,
        projectId: item.project_id,
        projectCode: item.project_code,
        projectName: item.project_name,
        milestoneId: item.milestone_id,
        milestoneName: item.milestone_name,
        milestoneStartDate: item.milestone_start_date,
        milestoneEndDate: item.milestone_end_date,
        pivrStage: item.pivr_stage,
        itemNumber: item.item_number,
        itemKey: item.item_key,
        tier: item.tier,
        type: item.type,
        title: item.title,
        description: item.description,
        startDate: item.start_date,
        dueDate: item.due_date,
        status: item.status,
        priority: item.priority,
        severity: item.severity,
        assigneeUid: item.assignee_uid,
        reporterUid: item.reporter_uid,
        estimatedHours: item.estimated_hours,
        parentId: item.parent_id,
        approvalStatus: item.approval_status,
        reviewLevel: item.review_level ?? 1,
        required: Boolean(item.required),
        templateKey: item.template_key,
        createdAt: item.created_at,
        updatedAt: item.updated_at
      },
      current: {
        documents: currentDocumentRows.map(mapDocument),
        deliverables: currentDeliverableRows.map(mapDeliverable)
      },
      children: childRows.map(child => mapChild(child, childDeliverableMap.get(child.id) || [])),
      previousArtifacts: treeData,
      latestApproval: latestApproval
        ? {
            id: latestApproval.id,
            transition: latestApproval.transition,
            title: latestApproval.title,
            requestedBy: latestApproval.requested_by,
            requestedAt: latestApproval.requested_at,
            requestComment: latestApproval.request_comment,
            reviewerUid: latestApproval.reviewer_uid,
            status: latestApproval.status,
            reviewedAt: latestApproval.reviewed_at,
            reviewComment: latestApproval.review_comment,
            createdAt: latestApproval.created_at
          }
        : null,
      pendingApproval: pendingApproval
        ? {
            id: pendingApproval.id,
            transition: pendingApproval.transition,
            title: pendingApproval.title,
            requestedBy: pendingApproval.requested_by,
            requestedAt: pendingApproval.requested_at,
            requestComment: pendingApproval.request_comment,
            reviewerUid: pendingApproval.reviewer_uid,
            status: pendingApproval.status,
            reviewedAt: pendingApproval.reviewed_at,
            reviewComment: pendingApproval.review_comment,
            createdAt: pendingApproval.created_at
          }
        : null
    }
  }
})
