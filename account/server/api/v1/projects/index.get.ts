import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '获取项目列表',
    description: '获取项目列表，支持多条件筛选。需要 API Key 认证。',
    parameters: [
      { in: 'query', name: 'dept_code', schema: { type: 'string' }, description: '按部门编码筛选' },
      { in: 'query', name: 'leader_uid', schema: { type: 'string' }, description: '按项目负责人 UID 筛选' },
      { in: 'query', name: 'search', schema: { type: 'string' }, description: '关键字搜索' },
      { in: 'query', name: 'status', schema: { type: 'integer' }, description: '状态（1启用）' },
      { in: 'query', name: 'only_group', schema: { type: 'boolean' }, description: '只查询组项目' },
      { in: 'query', name: 'include_template', schema: { type: 'boolean' }, description: '是否包含模板项目' }
    ]
  }
})

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  parent_code: string | null
  name: string
  dept_code: string
  leader_uid: string | null
  description: string | null
  status: number
  repo_url: string | null
  is_group: number
  is_template: number
  docs_synced_at: Date | null
  docs_committed_at: Date | null
}

interface ProjectItem {
  id: number
  projectCode: string
  parentId: string | null
  name: string
  deptCode: string
  leaderUid: string | null
  description: string | null
  status: number
  repoUrl: string | null
  isGroup: number
  isTemplate: number
  docsSyncedAt: Date | null
  docsCommittedAt: Date | null
  subProjects: ProjectItem[]
}

/**
 * Build hierarchical project tree from flat list
 */
function buildProjectTree(git_projects: ProjectItem[]): ProjectItem[] {
  const projectMap = new Map<string, ProjectItem>()
  const roots: ProjectItem[] = []

  // First pass: create map and initialize subProjects
  git_projects.forEach((p) => {
    p.subProjects = []
    projectMap.set(p.projectCode, p)
  })

  // Second pass: build tree
  git_projects.forEach((p) => {
    if (p.parentId && projectMap.has(p.parentId)) {
      projectMap.get(p.parentId)!.subProjects.push(p)
    } else {
      roots.push(p)
    }
  })

  return roots
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const pool = useDbPool()
  const query = getQuery(event)

  const search = (query.search as string) || ''
  const deptCode = query.dept_code as string
  const leaderUid = query.leader_uid as string
  const status = query.status ? Number(query.status) : undefined
  const parentId = query.parent_id as string
  const onlyGroup = query.only_group === 'true'
  const includeTemplate = query.include_template !== 'false'

  try {
    let sql = `
      SELECT id, project_code, parent_code, name, dept_code, leader_uid, description, status,
             repo_url, is_group, is_template, docs_synced_at, docs_committed_at
      FROM git_projects
      WHERE 1=1
    `
    const params: unknown[] = []

    if (search) {
      sql += ' AND (project_code LIKE ? OR name LIKE ?)'
      params.push(`%${search}%`, `%${search}%`)
    }

    if (deptCode) {
      sql += ' AND dept_code = ?'
      params.push(deptCode)
    }

    if (leaderUid) {
      sql += ' AND leader_uid = ?'
      params.push(leaderUid)
    }

    if (status !== undefined) {
      sql += ' AND status = ?'
      params.push(status)
    }

    if (parentId) {
      sql += ' AND parent_code = ?'
      params.push(parentId)
    }

    if (onlyGroup) {
      sql += ' AND is_group = 1'
    }

    if (!includeTemplate) {
      sql += ' AND is_template = 0'
    }

    // Order by created_at desc
    sql += ' ORDER BY created_at'

    const [rows] = await pool.query<ProjectRow[]>(sql, params)

    // Map to camelCase and build tree
    const items: ProjectItem[] = rows.map(row => ({
      id: row.id,
      projectCode: row.project_code,
      parentId: row.parent_code,
      name: row.name,
      deptCode: row.dept_code,
      leaderUid: row.leader_uid,
      description: row.description,
      status: row.status,
      repoUrl: row.repo_url,
      isGroup: row.is_group,
      isTemplate: row.is_template,
      docsSyncedAt: row.docs_synced_at,
      docsCommittedAt: row.docs_committed_at,
      subProjects: []
    }))

    // Build tree structure
    const treeItems = buildProjectTree(items)

    return {
      code: 0,
      data: {
        items: treeItems,
        total: rows.length // Total count includes all git_projects
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get git_projects:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to get git_projects'
    })
  }
})
