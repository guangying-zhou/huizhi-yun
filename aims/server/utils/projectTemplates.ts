import type { PoolConnection, ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import type {
  Priority,
  ProjectCategory,
  ProjectTemplateDefinition,
  ProjectTemplateMilestoneDefinition,
  ProjectTemplateVersionDetail,
  ProjectTemplateVersionStatus
} from '~~/app/types/aims'
import { buildDefaultProjectTemplateDefinition } from '~~/app/config/project-template-defaults'
import { execute, queryRow, queryRows } from '~~/server/utils/db'

type DbExecutor = {
  query: PoolConnection['query']
  execute: PoolConnection['execute']
}

interface TemplateSetRow extends RowDataPacket {
  id: number
  code: string
  name: string
  category: ProjectCategory
  description: string | null
  is_system: number
  created_by: string
  created_at: string
  updated_at: string
}

interface TemplateVersionRow extends RowDataPacket {
  id: number
  template_set_id: number
  version_no: number
  version_label: string
  status: ProjectTemplateVersionStatus
  notes: string | null
  definition_json: string | Record<string, unknown>
  published_at: string | null
  archived_at: string | null
  published_by: string | null
  archived_by: string | null
  created_by: string
  created_at: string
  updated_at: string
  template_set_code?: string
  template_set_name?: string
  category?: ProjectCategory
  is_system?: number
  usage_count?: number
}

interface ProjectTemplateSummaryFilters {
  category?: ProjectCategory
  status?: ProjectTemplateVersionStatus
}

interface CreateProjectTemplateDraftInput {
  category: ProjectCategory
  uid: string
  templateSetId?: number | null
  templateSetCode?: string | null
  templateSetName?: string | null
  templateSetDescription?: string | null
  cloneFromVersionId?: number | null
}

interface UpdateProjectTemplateVersionInput {
  versionLabel?: string
  notes?: string | null
  definition?: unknown
}

interface TransitionProjectTemplateVersionInput {
  action: 'publish' | 'archive' | 'revert_to_draft'
  uid: string
}

interface ResolveTemplateVersionResult {
  templateSetId: number
  templateVersionId: number
  templateVersionLabel: string
}

interface InstantiateProjectTemplateOptions {
  connection: PoolConnection
  projectId: number
  projectCode: string
  templateVersionId: number
  createdBy: string
  excludedWorkItemKeys?: Set<string>
}

type ExecuteParams = Parameters<PoolConnection['execute']>[1]

const PROJECT_TEMPLATE_CATEGORIES: ProjectCategory[] = [
  'product_dev',
  'custom_dev',
  'delivery',
  'maintenance',
  'sales',
  'presales',
  'improvement',
  'compliance'
]

function sortByOrder<T extends { sortOrder: number }>(items: T[]) {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder)
}

function normalizePriority(value: unknown): Priority {
  return ['P0', 'P1', 'P2', 'P3'].includes(String(value)) ? value as Priority : 'P2'
}

function normalizeTemplateDefinition(input: unknown): ProjectTemplateDefinition {
  const source = input && typeof input === 'object' ? input as { milestones?: unknown } : {}
  const rawMilestones = Array.isArray(source.milestones) ? source.milestones : []

  const milestones: ProjectTemplateMilestoneDefinition[] = rawMilestones.map((milestone, milestoneIndex) => {
    const milestoneObject = milestone && typeof milestone === 'object' ? milestone as Record<string, unknown> : {}
    const rawWorkItems = Array.isArray(milestoneObject.workItems) ? milestoneObject.workItems : []

    return {
      key: String(milestoneObject.key || `milestone-${milestoneIndex + 1}`),
      name: String(milestoneObject.name || `里程碑 ${milestoneIndex + 1}`),
      description: milestoneObject.description ? String(milestoneObject.description) : null,
      mode: ['strong_constraint', 'rolling_plan', 'periodic'].includes(String(milestoneObject.mode))
        ? milestoneObject.mode as ProjectTemplateMilestoneDefinition['mode']
        : 'rolling_plan',
      pivrStage: ['P', 'I', 'V', 'R'].includes(String(milestoneObject.pivrStage))
        ? milestoneObject.pivrStage as ProjectTemplateMilestoneDefinition['pivrStage']
        : 'P',
      sortOrder: Number(milestoneObject.sortOrder ?? milestoneIndex) || 0,
      workItems: rawWorkItems.map((workItem, workItemIndex) => {
        const workItemObject = workItem && typeof workItem === 'object' ? workItem as Record<string, unknown> : {}
        const rawDeliverables = Array.isArray(workItemObject.deliverables) ? workItemObject.deliverables : []

        return {
          key: String(workItemObject.key || `work-item-${milestoneIndex + 1}-${workItemIndex + 1}`),
          title: String(workItemObject.title || `工作项 ${workItemIndex + 1}`),
          type: ['task', 'bug', 'requirement'].includes(String(workItemObject.type))
            ? workItemObject.type as ProjectTemplateMilestoneDefinition['workItems'][number]['type']
            : 'task',
          tier: ['target', 'matter'].includes(String(workItemObject.tier))
            ? workItemObject.tier as ProjectTemplateMilestoneDefinition['workItems'][number]['tier']
            : 'target',
          description: workItemObject.description ? String(workItemObject.description) : null,
          required: Boolean(workItemObject.required),
          reviewLevel: Math.max(0, Math.min(4, Number(workItemObject.reviewLevel ?? 1) || 1)),
          priority: normalizePriority(workItemObject.priority),
          sortOrder: Number(workItemObject.sortOrder ?? workItemIndex) || 0,
          deliverables: rawDeliverables.map((deliverable, deliverableIndex) => {
            const deliverableObject = deliverable && typeof deliverable === 'object' ? deliverable as Record<string, unknown> : {}
            return {
              key: String(deliverableObject.key || `deliverable-${milestoneIndex + 1}-${workItemIndex + 1}-${deliverableIndex + 1}`),
              name: String(deliverableObject.name || `交付物 ${deliverableIndex + 1}`),
              description: deliverableObject.description ? String(deliverableObject.description) : null,
              acceptanceCriteria: String(deliverableObject.acceptanceCriteria || ''),
              deliverableType: ['document', 'code', 'artifact', 'task'].includes(String(deliverableObject.deliverableType))
                ? deliverableObject.deliverableType as ProjectTemplateMilestoneDefinition['workItems'][number]['deliverables'][number]['deliverableType']
                : 'document',
              required: Boolean(deliverableObject.required),
              sortOrder: Number(deliverableObject.sortOrder ?? deliverableIndex) || 0
            }
          })
        }
      })
    }
  })

  return {
    milestones: sortByOrder(milestones).map(milestone => ({
      ...milestone,
      workItems: sortByOrder(milestone.workItems).map(workItem => ({
        ...workItem,
        deliverables: sortByOrder(workItem.deliverables)
      }))
    }))
  }
}

async function queryRowsUsing<T extends RowDataPacket[]>(db: DbExecutor | null, sql: string, params: unknown[] = []) {
  if (!db) return queryRows<T>(sql, params)
  const [rows] = await db.query<T>(sql, params)
  return rows
}

async function queryRowUsing<T extends RowDataPacket>(db: DbExecutor | null, sql: string, params: unknown[] = []) {
  const rows = await queryRowsUsing<T[]>(db, sql, params)
  return rows[0] || null
}

async function executeUsing<T extends ResultSetHeader>(db: DbExecutor | null, sql: string, params: unknown[] = []) {
  if (!db) return execute<T>(sql, params)
  const [result] = await db.execute<T>(sql, params as unknown as ExecuteParams)
  return result
}

function mapVersionSummary(row: TemplateVersionRow): ProjectTemplateVersionDetail {
  return {
    id: row.id,
    templateSetId: row.template_set_id,
    templateSetCode: String(row.template_set_code || ''),
    templateSetName: String(row.template_set_name || ''),
    category: row.category as ProjectCategory,
    versionNo: row.version_no,
    versionLabel: row.version_label,
    status: row.status,
    usageCount: Number(row.usage_count || 0),
    isSystem: Boolean(row.is_system),
    notes: row.notes,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    definition: normalizeTemplateDefinition(
      row.definition_json
        ? (typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : row.definition_json)
        : {}
    )
  }
}

export async function ensureDefaultProjectTemplateVersionsSeeded(category?: ProjectCategory) {
  const categories = category ? [category] : PROJECT_TEMPLATE_CATEGORIES

  for (const currentCategory of categories) {
    const existing = await queryRow<TemplateSetRow>(
      'SELECT * FROM project_template_sets WHERE category = ? LIMIT 1',
      [currentCategory]
    )
    if (existing) {
      // 对于已存在的系统模板集，若其 definition 缺失新增的"需求基线"工作项，则同步升级
      if (existing.is_system) {
        await syncSystemTemplateDefinition(existing.id, currentCategory)
      }
      continue
    }

    const setResult = await execute<ResultSetHeader>(
      `INSERT INTO project_template_sets
        (code, name, category, description, is_system, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        `system-${currentCategory}`,
        `${currentCategory} 默认模板`,
        currentCategory,
        '系统初始化模板集',
        1,
        'system'
      ]
    )

    await execute<ResultSetHeader>(
      `INSERT INTO project_template_versions
        (template_set_id, version_no, version_label, status, notes, definition_json, published_at, published_by, created_by)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
      [
        setResult.insertId,
        1,
        'v1',
        'published',
        '系统初始化版本',
        JSON.stringify(buildDefaultProjectTemplateDefinition(currentCategory)),
        'system',
        'system'
      ]
    )
  }
}

async function syncSystemTemplateDefinition(templateSetId: number, category: ProjectCategory) {
  // 仅对研发类（product_dev/custom_dev）系统模板做幂等升级：缺失 requirement_baseline 时补齐。
  if (!['product_dev', 'custom_dev'].includes(category)) return

  const row = await queryRow<RowDataPacket & { id: number, definition_json: string | Record<string, unknown> }>(
    `SELECT id, definition_json FROM project_template_versions
     WHERE template_set_id = ? AND status = 'published'
     ORDER BY version_no DESC LIMIT 1`,
    [templateSetId]
  )
  if (!row) return

  const definition = typeof row.definition_json === 'string'
    ? JSON.parse(row.definition_json)
    : row.definition_json

  const milestones = Array.isArray((definition as { milestones?: unknown }).milestones)
    ? (definition as { milestones: Array<Record<string, unknown>> }).milestones
    : []
  const iMilestone = milestones.find(m => m.pivrStage === 'I')
  if (!iMilestone) return

  const workItems = Array.isArray(iMilestone.workItems) ? iMilestone.workItems as Array<Record<string, unknown>> : []
  if (workItems.some(w => w.key === 'requirement_baseline')) return

  const rebuilt = buildDefaultProjectTemplateDefinition(category)
  await execute<ResultSetHeader>(
    'UPDATE project_template_versions SET definition_json = ? WHERE id = ?',
    [JSON.stringify(rebuilt), row.id]
  )
}

export async function fetchProjectTemplateVersionSummaries(filters: ProjectTemplateSummaryFilters = {}) {
  await ensureDefaultProjectTemplateVersionsSeeded(filters.category)

  const conditions: string[] = ['1 = 1']
  const params: unknown[] = []

  if (filters.category) {
    conditions.push('s.category = ?')
    params.push(filters.category)
  }
  if (filters.status) {
    conditions.push('v.status = ?')
    params.push(filters.status)
  }

  const rows = await queryRows<TemplateVersionRow[]>(
    `SELECT
        v.*,
        s.code AS template_set_code,
        s.name AS template_set_name,
        s.category,
        s.is_system,
        COUNT(p.id) AS usage_count
     FROM project_template_versions v
     JOIN project_template_sets s ON s.id = v.template_set_id
     LEFT JOIN aims_projects p ON p.template_version_id = v.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY v.id
     ORDER BY s.category ASC, s.is_system DESC, v.version_no DESC, v.updated_at DESC`,
    params
  )

  return rows.map((row) => {
    const detail = mapVersionSummary(row)
    return {
      ...detail,
      definition: undefined
    }
  })
}

export async function fetchProjectTemplateVersionDetail(id: number, db: DbExecutor | null = null) {
  const row = await queryRowUsing<TemplateVersionRow>(
    db,
    `SELECT
        v.*,
        s.code AS template_set_code,
        s.name AS template_set_name,
        s.category,
        s.is_system,
        (SELECT COUNT(*) FROM aims_projects p WHERE p.template_version_id = v.id) AS usage_count
     FROM project_template_versions v
     JOIN project_template_sets s ON s.id = v.template_set_id
     WHERE v.id = ?`,
    [id]
  )

  if (!row) return null
  return mapVersionSummary(row)
}

async function getTemplateVersionUsageCount(id: number, db: DbExecutor | null = null) {
  const row = await queryRowUsing<RowDataPacket & { usage_count: number }>(
    db,
    'SELECT COUNT(*) AS usage_count FROM aims_projects WHERE template_version_id = ?',
    [id]
  )
  return Number(row?.usage_count || 0)
}

export async function createProjectTemplateDraft(input: CreateProjectTemplateDraftInput) {
  await ensureDefaultProjectTemplateVersionsSeeded(input.category)

  let templateSetId = input.templateSetId || null

  if (!templateSetId && input.cloneFromVersionId) {
    const source = await fetchProjectTemplateVersionDetail(input.cloneFromVersionId)
    templateSetId = source?.templateSetId || null
  }

  if (!templateSetId) {
    const createSetResult = await execute<ResultSetHeader>(
      `INSERT INTO project_template_sets
        (code, name, category, description, is_system, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.templateSetCode || `${input.category}-${Date.now()}`,
        input.templateSetName || `${input.category} 自定义模板`,
        input.category,
        input.templateSetDescription || null,
        0,
        input.uid
      ]
    )
    templateSetId = createSetResult.insertId
  }

  const latestVersion = await queryRow<RowDataPacket & { version_no: number }>(
    'SELECT IFNULL(MAX(version_no), 0) AS version_no FROM project_template_versions WHERE template_set_id = ?',
    [templateSetId]
  )
  const nextVersionNo = Number(latestVersion?.version_no || 0) + 1

  let definition = buildDefaultProjectTemplateDefinition(input.category)
  if (input.cloneFromVersionId) {
    const source = await fetchProjectTemplateVersionDetail(input.cloneFromVersionId)
    if (source) {
      definition = source.definition
    }
  }

  const result = await execute<ResultSetHeader>(
    `INSERT INTO project_template_versions
      (template_set_id, version_no, version_label, status, notes, definition_json, created_by)
     VALUES (?, ?, ?, 'draft', ?, ?, ?)`,
    [
      templateSetId,
      nextVersionNo,
      `v${nextVersionNo}`,
      input.cloneFromVersionId ? `基于版本 #${input.cloneFromVersionId} 克隆` : null,
      JSON.stringify(definition),
      input.uid
    ]
  )

  return fetchProjectTemplateVersionDetail(result.insertId)
}

export async function updateProjectTemplateVersion(id: number, input: UpdateProjectTemplateVersionInput) {
  const current = await fetchProjectTemplateVersionDetail(id)
  if (!current) {
    throw createError({ statusCode: 404, message: '模板版本不存在' })
  }
  if (current.status !== 'draft') {
    throw createError({ statusCode: 400, message: '只有草稿版本允许编辑' })
  }

  const definition = input.definition !== undefined
    ? normalizeTemplateDefinition(input.definition)
    : current.definition

  await execute<ResultSetHeader>(
    `UPDATE project_template_versions
     SET version_label = ?, notes = ?, definition_json = ?
     WHERE id = ?`,
    [
      input.versionLabel || current.versionLabel,
      input.notes !== undefined ? input.notes : current.notes,
      JSON.stringify(definition),
      id
    ]
  )

  return fetchProjectTemplateVersionDetail(id)
}

export async function transitionProjectTemplateVersion(id: number, input: TransitionProjectTemplateVersionInput) {
  const current = await fetchProjectTemplateVersionDetail(id)
  if (!current) {
    throw createError({ statusCode: 404, message: '模板版本不存在' })
  }

  const usageCount = await getTemplateVersionUsageCount(id)

  if (input.action === 'publish') {
    if (current.status !== 'draft') {
      throw createError({ statusCode: 400, message: '只有草稿版本可以发布' })
    }
    await execute<ResultSetHeader>(
      `UPDATE project_template_versions
       SET status = 'published', published_at = CURRENT_TIMESTAMP, published_by = ?
       WHERE id = ?`,
      [input.uid, id]
    )
  } else if (input.action === 'archive') {
    if (current.status !== 'published') {
      throw createError({ statusCode: 400, message: '只有已发布版本可以归档' })
    }
    await execute<ResultSetHeader>(
      `UPDATE project_template_versions
       SET status = 'archived', archived_at = CURRENT_TIMESTAMP, archived_by = ?
       WHERE id = ?`,
      [input.uid, id]
    )
  } else if (input.action === 'revert_to_draft') {
    if (usageCount > 0) {
      throw createError({ statusCode: 400, message: '已用于项目的版本不能回退为草稿，请改为克隆新版本' })
    }
    if (!['published', 'archived'].includes(current.status)) {
      throw createError({ statusCode: 400, message: '当前状态不支持回退为草稿' })
    }
    await execute<ResultSetHeader>(
      `UPDATE project_template_versions
       SET status = 'draft', published_at = NULL, published_by = NULL, archived_at = NULL, archived_by = NULL
       WHERE id = ?`,
      [id]
    )
  }

  return fetchProjectTemplateVersionDetail(id)
}

export async function resolveProjectTemplateVersion(category: ProjectCategory, templateVersionId?: number | null): Promise<ResolveTemplateVersionResult> {
  await ensureDefaultProjectTemplateVersionsSeeded(category)

  if (templateVersionId) {
    const current = await fetchProjectTemplateVersionDetail(templateVersionId)
    if (!current || current.category !== category) {
      throw createError({ statusCode: 400, message: '所选模板版本不存在或与项目分类不匹配' })
    }
    if (current.status !== 'published') {
      throw createError({ statusCode: 400, message: '项目只能绑定已发布模板版本' })
    }
    return {
      templateSetId: current.templateSetId,
      templateVersionId: current.id,
      templateVersionLabel: current.versionLabel
    }
  }

  const latestPublished = await queryRow<TemplateVersionRow>(
    `SELECT
        v.*,
        s.code AS template_set_code,
        s.name AS template_set_name,
        s.category,
        s.is_system,
        0 AS usage_count
     FROM project_template_versions v
     JOIN project_template_sets s ON s.id = v.template_set_id
     WHERE s.category = ? AND v.status = 'published'
     ORDER BY s.is_system DESC, v.version_no DESC, v.updated_at DESC
     LIMIT 1`,
    [category]
  )

  if (!latestPublished) {
    throw createError({ statusCode: 400, message: '当前项目分类没有可用的已发布模板版本' })
  }

  return {
    templateSetId: latestPublished.template_set_id,
    templateVersionId: latestPublished.id,
    templateVersionLabel: latestPublished.version_label
  }
}

export async function instantiateProjectFromTemplate(options: InstantiateProjectTemplateOptions) {
  const version = await fetchProjectTemplateVersionDetail(options.templateVersionId, options.connection)
  if (!version) {
    throw createError({ statusCode: 404, message: '模板版本不存在' })
  }

  let counter = 0
  const counterRow = await queryRowUsing<RowDataPacket & { counter: number }>(
    options.connection,
    'SELECT counter FROM project_counters WHERE project_id = ?',
    [options.projectId]
  )
  counter = Number(counterRow?.counter || 0)

  for (const milestone of sortByOrder(version.definition.milestones)) {
    const milestoneResult = await executeUsing<ResultSetHeader>(
      options.connection,
      `INSERT INTO milestones
        (project_id, name, description, mode, pivr_stage, sort_order, created_by, template_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        options.projectId,
        milestone.name,
        milestone.description || null,
        milestone.mode,
        milestone.pivrStage,
        milestone.sortOrder,
        options.createdBy,
        milestone.key
      ]
    )

    for (const workItem of sortByOrder(milestone.workItems)) {
      if (options.excludedWorkItemKeys?.has(workItem.key) && !workItem.required) {
        continue
      }
      counter += 1
      const itemKey = `${options.projectCode}-${counter}`
      const status = workItem.tier === 'target' ? 'planning' : 'todo'
      const workItemResult = await executeUsing<ResultSetHeader>(
        options.connection,
        `INSERT INTO work_items
          (project_id, milestone_id, item_number, item_key, type, tier, title, description,
           status, priority, severity, weight, assignee_uid, reporter_uid, due_date,
           estimated_hours, parent_id, sort_order, approval_status, review_level, required, template_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          options.projectId,
          milestoneResult.insertId,
          counter,
          itemKey,
          workItem.type,
          workItem.tier,
          workItem.title,
          workItem.description || null,
          status,
          workItem.priority,
          null,
          1,
          null,
          options.createdBy,
          null,
          null,
          null,
          workItem.sortOrder,
          'not_required',
          workItem.reviewLevel,
          workItem.required ? 1 : 0,
          workItem.key
        ]
      )

      // 模板实例化出的 work_item 都是 target 层（见上文 tier: workItem.tier 默认 target）
      // 其成果要求写入 target_id；matter_id 留空，待 breakdown 承接
      for (const deliverable of sortByOrder(workItem.deliverables)) {
        await executeUsing<ResultSetHeader>(
          options.connection,
          `INSERT INTO deliverables
            (project_owner_id, milestone_owner_id, target_id, matter_id,
             name, description, acceptance_criteria, deliverable_type, required, sort_order,
             status, project_id, project_code, created_by, template_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            null,
            null,
            workItemResult.insertId,
            null,
            deliverable.name,
            deliverable.description || null,
            deliverable.acceptanceCriteria || null,
            deliverable.deliverableType,
            deliverable.required ? 1 : 0,
            deliverable.sortOrder,
            'pending',
            options.projectId,
            options.projectCode,
            options.createdBy,
            deliverable.key
          ]
        )
      }
    }
  }

  await executeUsing<ResultSetHeader>(
    options.connection,
    'UPDATE project_counters SET counter = ? WHERE project_id = ?',
    [counter, options.projectId]
  )
}
