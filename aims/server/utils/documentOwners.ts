import type { RowDataPacket } from '~~/server/utils/db'
import { queryRow } from '~~/server/utils/db'

export interface DocumentOwnerContext {
  portfolioId: number | null
  projectId: number | null
  projectCode: string | null
  milestoneId: number | null
  workItemId: number | null
}

interface DocumentOwnerRow extends RowDataPacket {
  id: number
  is_folder: number
  portfolio_id: number | null
  project_id: number | null
  project_code: string | null
  milestone_id: number | null
  work_item_id: number | null
}

interface ProjectRow extends RowDataPacket {
  project_id: number
  project_code: string | null
}

interface PortfolioRow extends RowDataPacket {
  code: string
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

function getExplicitOwnerContext(input: Record<string, unknown>): DocumentOwnerContext {
  return {
    portfolioId: normalizeNullableNumber(input.portfolioId),
    projectId: normalizeNullableNumber(input.projectId),
    projectCode: typeof input.projectCode === 'string' && input.projectCode.trim() ? input.projectCode.trim() : null,
    milestoneId: normalizeNullableNumber(input.milestoneId),
    workItemId: normalizeNullableNumber(input.workItemId)
  }
}

function countOwners(context: DocumentOwnerContext) {
  return [
    context.portfolioId,
    context.projectId,
    context.milestoneId,
    context.workItemId
  ].filter(Boolean).length
}

function sameOwnerContext(a: DocumentOwnerContext, b: DocumentOwnerContext) {
  return a.portfolioId === b.portfolioId
    && a.projectId === b.projectId
    && a.milestoneId === b.milestoneId
    && a.workItemId === b.workItemId
}

export async function getDocumentOwnerContext(documentId: number): Promise<(DocumentOwnerContext & { isFolder: boolean }) | null> {
  const row = await queryRow<DocumentOwnerRow>(
    `SELECT id, is_folder, portfolio_id, project_id, project_code, milestone_id, work_item_id
     FROM project_documents
     WHERE id = ?`,
    [documentId]
  )

  if (!row) return null

  return {
    portfolioId: row.portfolio_id,
    projectId: row.project_id,
    projectCode: row.project_code,
    milestoneId: row.milestone_id,
    workItemId: row.work_item_id,
    isFolder: Boolean(row.is_folder)
  }
}

async function resolveProjectContextFromOwner(context: DocumentOwnerContext): Promise<Pick<DocumentOwnerContext, 'projectId' | 'projectCode'>> {
  if (context.workItemId) {
    const workItem = await queryRow<ProjectRow>(
      `SELECT wi.project_id, p.project_code
       FROM work_items wi
       JOIN aims_projects p ON p.id = wi.project_id
       WHERE wi.id = ?`,
      [context.workItemId]
    )
    if (!workItem) {
      throw createError({ statusCode: 400, message: '工作项不存在' })
    }
    return { projectId: workItem.project_id, projectCode: workItem.project_code }
  }

  if (context.milestoneId) {
    const milestone = await queryRow<ProjectRow>(
      `SELECT m.project_id, p.project_code
       FROM milestones m
       JOIN aims_projects p ON p.id = m.project_id
       WHERE m.id = ?`,
      [context.milestoneId]
    )
    if (!milestone) {
      throw createError({ statusCode: 400, message: '里程碑不存在' })
    }
    return { projectId: milestone.project_id, projectCode: milestone.project_code }
  }

  if (context.projectId) {
    const project = await queryRow<ProjectRow>(
      'SELECT id AS project_id, project_code FROM aims_projects WHERE id = ?',
      [context.projectId]
    )
    if (!project) {
      throw createError({ statusCode: 400, message: '项目不存在' })
    }
    return { projectId: project.project_id, projectCode: project.project_code }
  }

  if (context.portfolioId) {
    const portfolio = await queryRow<PortfolioRow>(
      'SELECT code FROM project_portfolios WHERE id = ?',
      [context.portfolioId]
    )
    if (!portfolio) {
      throw createError({ statusCode: 400, message: '项目集不存在' })
    }
    return { projectId: null, projectCode: portfolio.code }
  }

  throw createError({ statusCode: 400, message: '文档必须且只能归属于一个对象' })
}

export async function resolveDocumentProjectContext(context: DocumentOwnerContext): Promise<Pick<DocumentOwnerContext, 'projectId' | 'projectCode'>> {
  return resolveProjectContextFromOwner(context)
}

export async function resolveDocumentOwnerContext(input: Record<string, unknown>): Promise<DocumentOwnerContext> {
  const explicitOwner = getExplicitOwnerContext(input)
  const explicitOwnerCount = countOwners(explicitOwner)

  if (explicitOwnerCount > 1) {
    throw createError({ statusCode: 400, message: '文档必须且只能归属于一个对象' })
  }

  const parentId = normalizeNullableNumber(input.parentId)
  if (parentId) {
    const parent = await getDocumentOwnerContext(parentId)
    if (!parent) {
      throw createError({ statusCode: 400, message: '父目录不存在' })
    }
    if (!parent.isFolder) {
      throw createError({ statusCode: 400, message: '父节点必须是文件夹' })
    }

    const inheritedOwner: DocumentOwnerContext = {
      portfolioId: parent.portfolioId,
      projectId: parent.projectId,
      projectCode: parent.projectCode,
      milestoneId: parent.milestoneId,
      workItemId: parent.workItemId
    }

    if (explicitOwnerCount === 0) {
      return inheritedOwner
    }

    const normalizedExplicitOwner = {
      ...explicitOwner,
      ...(await resolveProjectContextFromOwner(explicitOwner))
    }

    if (!sameOwnerContext(normalizedExplicitOwner, inheritedOwner)) {
      throw createError({ statusCode: 400, message: '父目录归属与文档归属不一致' })
    }

    return inheritedOwner
  }

  if (explicitOwnerCount !== 1) {
    throw createError({ statusCode: 400, message: '文档必须且只能归属于一个对象' })
  }

  const projectContext = await resolveProjectContextFromOwner(explicitOwner)
  return {
    ...explicitOwner,
    projectId: projectContext.projectId ?? explicitOwner.projectId,
    projectCode: explicitOwner.projectCode ?? projectContext.projectCode
  }
}
