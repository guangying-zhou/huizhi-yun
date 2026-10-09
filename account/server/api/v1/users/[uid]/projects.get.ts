import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '获取用户参与的项目',
    description: '查询用户作为负责人（managed）和普通成员（joined）的项目列表。需要 API Key 认证。',
    parameters: [
      { in: 'path', name: 'uid', required: true, schema: { type: 'string' }, description: '用户名（uid）' },
      { in: 'query', name: 'include_template', schema: { type: 'boolean' }, description: '是否包含模板项目' },
      { in: 'query', name: 'only_group', schema: { type: 'boolean' }, description: '是否只包含组项目' }
    ]
  }
})

interface ProjectRow extends RowDataPacket {
  id: number
  projectCode: string
  parentId: string | null
  name: string
  deptCode: string
  leaderUid?: string | null
  description?: string | null
  status?: number
  repoUrl: string | null
  isGroup?: number
  isTemplate?: number
  docsSyncedAt: Date | null
  docsCommittedAt: Date | null
  role?: string
}

interface ProjectItem {
  id: number
  projectCode: string
  parentId: string | null
  name: string
  deptCode: string
  leaderUid?: string | null
  description?: string | null
  status?: number
  repoUrl: string | null
  isGroup?: number
  isTemplate?: number
  docsSyncedAt: Date | null
  docsCommittedAt: Date | null
  role?: string
  subProjects: ProjectItem[]
}

const appendChildrenRecursively = async ({
  pool,
  parents,
  onlyGroup,
  includeTemplate
}: {
  pool: ReturnType<typeof useDbPool>
  parents: ProjectItem[]
  onlyGroup: boolean
  includeTemplate: boolean
}): Promise<void> => {
  let currentLevel = parents
  const knownItems = new Map<string, ProjectItem>()
  parents.forEach((project) => {
    knownItems.set(project.projectCode, project)
  })
  const processedCodes = new Set<string>()
  const maxDepth = 20
  let depth = 0

  while (currentLevel.length > 0 && depth < maxDepth) {
    currentLevel = currentLevel.filter(project => !processedCodes.has(project.projectCode))
    if (currentLevel.length === 0) {
      break
    }

    depth += 1
    const currentCodes = [...new Set(currentLevel.map(project => project.projectCode))]
    if (currentCodes.length === 0) {
      break
    }

    currentCodes.forEach(code => processedCodes.add(code))

    const placeholders = currentCodes.map(() => '?').join(',')
    let childSql = `SELECT id, project_code as projectCode, parent_code as parentId, name, dept_code as deptCode,
              leader_uid as leaderUid, description, status,
              repo_url as repoUrl, is_group as isGroup, is_template as isTemplate,
              docs_synced_at as docsSyncedAt,
              docs_committed_at as docsCommittedAt
       FROM git_projects
       WHERE parent_code IN (${placeholders}) AND status = 1`

    if (onlyGroup) childSql += ' AND is_group = 1'
    if (!includeTemplate) childSql += ' AND is_template = 0'

    const [childRows] = await pool.query<ProjectRow[]>(childSql, currentCodes)
    if (childRows.length === 0) {
      break
    }

    const childrenByParent = new Map<string, ProjectItem[]>()
    const nextLevelMap = new Map<string, ProjectItem>()

    childRows.forEach((row) => {
      let child = knownItems.get(row.projectCode)
      if (!child) {
        child = {
          ...row,
          subProjects: []
        }
        knownItems.set(row.projectCode, child)
      }

      const siblings = childrenByParent.get(child.parentId || '') || []
      if (!siblings.some(item => item.projectCode === child.projectCode)) {
        siblings.push(child)
      }
      childrenByParent.set(child.parentId || '', siblings)

      if (!processedCodes.has(child.projectCode)) {
        nextLevelMap.set(child.projectCode, child)
      }
    })

    currentLevel.forEach((parent) => {
      const nextChildren = childrenByParent.get(parent.projectCode) || []
      if (nextChildren.length === 0) {
        return
      }

      const merged = [...parent.subProjects]
      nextChildren.forEach((child) => {
        if (!merged.some(item => item.projectCode === child.projectCode)) {
          merged.push(child)
        }
      })
      parent.subProjects = merged
    })

    currentLevel = [...nextLevelMap.values()]
  }

  if (depth >= maxDepth) {
    console.warn(`[UserProjects] Maximum project hierarchy depth ${maxDepth} reached, possible circular reference detected`)
  }
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const uid = getRouterParam(event, 'uid')
  const query = getQuery(event)
  const onlyGroup = query.only_group === 'true'
  const includeTemplate = query.include_template !== 'false'
  const pool = useDbPool()

  try {
    // 1. Managed Projects (where user is leader)
    let managedSql = `SELECT id, project_code as projectCode, parent_code as parentId, name, dept_code as deptCode,
              leader_uid as leaderUid, description, status,
              repo_url as repoUrl, is_group as isGroup, is_template as isTemplate,
              docs_synced_at as docsSyncedAt,
              docs_committed_at as docsCommittedAt
       FROM git_projects
       WHERE leader_uid = ? AND status = 1`

    if (onlyGroup) managedSql += ' AND is_group = 1'
    if (!includeTemplate) managedSql += ' AND is_template = 0'

    managedSql += ' ORDER BY created_at DESC'

    const [managedRows] = await pool.query<ProjectRow[]>(managedSql, [uid])

    // 2. Joined Projects (where user is member)
    let joinedSql = `SELECT p.id, p.project_code as projectCode, p.parent_code as parentId, p.name, p.dept_code as deptCode,
              p.leader_uid as leaderUid, p.description, p.status,
              p.repo_url as repoUrl, p.is_group as isGroup, p.is_template as isTemplate,
              p.docs_synced_at as docsSyncedAt,
              p.docs_committed_at as docsCommittedAt, pm.role
       FROM git_project_members pm
       JOIN git_projects p ON pm.project_code = p.project_code

       WHERE pm.uid = ? AND p.status = 1 AND (p.leader_uid IS NULL OR p.leader_uid != ?)`

    if (onlyGroup) joinedSql += ' AND p.is_group = 1'
    if (!includeTemplate) joinedSql += ' AND p.is_template = 0'

    joinedSql += ' ORDER BY pm.joined_at DESC'

    const [joinedRows] = await pool.query<ProjectRow[]>(joinedSql, [uid, uid])

    // Transform to ProjectItem and build trees
    const managedItems: ProjectItem[] = managedRows.map(row => ({
      ...row,
      subProjects: []
    }))

    const joinedItems: ProjectItem[] = joinedRows.map(row => ({
      ...row,
      subProjects: []
    }))

    // 3. 递归填充所有层级的子项目
    await appendChildrenRecursively({
      pool,
      parents: managedItems,
      onlyGroup,
      includeTemplate
    })
    await appendChildrenRecursively({
      pool,
      parents: joinedItems,
      onlyGroup,
      includeTemplate
    })

    // 4. 如果用户管理的是子项目，把父项目组也加到 managed 中
    const managedProjectCodes = new Set(managedItems.map(p => p.projectCode))
    const parentIdsNeeded = managedItems
      .filter(p => p.parentId && !managedProjectCodes.has(p.parentId))
      .map(p => p.parentId!)

    if (parentIdsNeeded.length > 0) {
      const uniqueParentIds = [...new Set(parentIdsNeeded)]
      const pholder = uniqueParentIds.map(() => '?').join(',')
      const [parentRows] = await pool.query<ProjectRow[]>(
        `SELECT id, project_code as projectCode, parent_code as parentId, name, dept_code as deptCode,
                leader_uid as leaderUid, description, status,
                repo_url as repoUrl, is_group as isGroup, is_template as isTemplate,
                docs_synced_at as docsSyncedAt, docs_committed_at as docsCommittedAt
         FROM git_projects WHERE project_code IN (${pholder}) AND status = 1`,
        uniqueParentIds
      )
      for (const row of parentRows) {
        if (!managedProjectCodes.has(row.projectCode)) {
          const parentItem: ProjectItem = { ...row, subProjects: [] }
          // 把已有的子项目挂上去
          parentItem.subProjects = managedItems.filter(c => c.parentId === row.projectCode)
          managedItems.push(parentItem)
          managedProjectCodes.add(row.projectCode)
        }
      }
    }

    // 5. 过滤掉已经作为子项目显示的项目
    const filteredManagedItems = managedItems.filter(p =>
      !p.parentId || !managedProjectCodes.has(p.parentId)
    )

    const joinedProjectCodes = new Set(joinedItems.map(p => p.projectCode))
    const filteredJoinedItems = joinedItems.filter(p =>
      !p.parentId || !joinedProjectCodes.has(p.parentId)
    )

    return {
      code: 0,
      data: {
        managed: filteredManagedItems,
        joined: filteredJoinedItems
      }
    }
  } catch (err: unknown) {
    const error = err as { statusCode?: number, message?: string }
    if (error.statusCode) throw error
    console.error('Failed to get user git_projects:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to get user git_projects'
    })
  }
})
