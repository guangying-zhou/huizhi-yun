import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { RowDataPacket } from 'mysql2/promise'

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  parent_id: string | null
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

interface MemberRow extends RowDataPacket {
  uid: string
  role: string
  real_name: string | null
  avatar: string | null
  project_code?: string
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Failed to get project detail'
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const projectCode = decodeURIComponent(getRouterParam(event, 'projectCode') || '')
  const query = getQuery(event)
  const includeSubProjects = query.include_sub_projects !== 'false'
  const includeTemplate = query.include_template !== 'false'
  const pool = useDbPool()

  try {
    // 1. Fetch Project
    const [projectRows] = await pool.query<ProjectRow[]>(
      `SELECT id, project_code, parent_code as parent_id, name, dept_code, leader_uid, description, status,
              repo_url, is_group, is_template, docs_synced_at, docs_committed_at
       FROM git_projects
       WHERE project_code = ?`,
      [projectCode]
    )

    if (projectRows.length === 0 || !projectRows[0]) {
      throw createError({
        statusCode: 404,
        message: 'Project not found'
      })
    }

    const project = projectRows[0]

    // 2. Fetch Members
    const [memberRows] = await pool.query<MemberRow[]>(
      `SELECT pm.uid, pm.role, u.real_name, u.avatar
       FROM git_project_members pm
       LEFT JOIN system_users u ON pm.uid = u.uid
       WHERE pm.project_code = ?
       ORDER BY pm.joined_at ASC`,
      [projectCode]
    )

    // 3. Fetch Sub-git_projects (if requested)
    let subProjects: ProjectRow[] = []
    if (includeSubProjects) {
      let subSql = `SELECT id, project_code, parent_code as parent_id, name, dept_code, leader_uid, description, status,
                repo_url, is_group, is_template, docs_synced_at, docs_committed_at
         FROM git_projects
         WHERE parent_code = ? AND status = 1`

      if (!includeTemplate) {
        subSql += ' AND is_template = 0'
      }

      subSql += ' ORDER BY created_at'

      const [rows] = await pool.query<ProjectRow[]>(subSql, [projectCode])
      subProjects = rows
    }

    // 4. Fetch Members for Sub-git_projects
    const subProjectMembersMap = new Map<string, unknown[]>()
    if (subProjects.length > 0) {
      const subProjectCodes = subProjects.map(p => p.project_code)
      const placeholders = subProjectCodes.map(() => '?').join(',')

      const [subMemberRows] = await pool.query<MemberRow[]>(
        `SELECT pm.project_code, pm.uid, pm.role, u.real_name, u.avatar
         FROM git_project_members pm
         LEFT JOIN system_users u ON pm.uid = u.uid
         WHERE pm.project_code IN (${placeholders})
         ORDER BY pm.joined_at ASC`,
        subProjectCodes
      )

      subMemberRows.forEach((m) => {
        if (!subProjectMembersMap.has(m.project_code as string)) {
          subProjectMembersMap.set(m.project_code as string, [])
        }
        subProjectMembersMap.get(m.project_code as string)!.push({
          uid: m.uid,
          role: m.role,
          realName: m.real_name,
          avatar: normalizeAvatarOutput(m.avatar)
        })
      })
    }

    const members = memberRows.map(m => ({
      uid: m.uid,
      role: m.role,
      realName: m.real_name,
      avatar: normalizeAvatarOutput(m.avatar)
    }))

    return {
      code: 0,
      data: {
        id: project.id,
        projectCode: project.project_code,
        parentId: project.parent_id,
        name: project.name,
        deptCode: project.dept_code,
        leaderUid: project.leader_uid,
        description: project.description,
        status: project.status,
        repoUrl: project.repo_url,
        isGroup: project.is_group,
        isTemplate: project.is_template,
        docsSyncedAt: project.docs_synced_at,
        docsCommittedAt: project.docs_committed_at,
        members,
        subProjects: subProjects.map(p => ({
          id: p.id,
          projectCode: p.project_code,
          parentId: p.parent_id,
          name: p.name,
          deptCode: p.dept_code,
          leaderUid: p.leader_uid,
          description: p.description,
          status: p.status,
          repoUrl: p.repo_url,
          isGroup: p.is_group,
          isTemplate: p.is_template,
          docsSyncedAt: p.docs_synced_at,
          docsCommittedAt: p.docs_committed_at,
          members: subProjectMembersMap.get(p.project_code) || []
        }))

      }
    }
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'statusCode' in err) throw err
    console.error('Failed to get project detail:', err)
    throw createError({
      statusCode: 500,
      message: getErrorMessage(err)
    })
  }
})
