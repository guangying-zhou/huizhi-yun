import { useDbPool } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

interface ProjectRow extends RowDataPacket {
  id: number
  project_code: string
  parent_code: string | null
  name: string
  dept_code: string
  leader_uid: string | null
  description: string | null
  start_date: Date | null
  end_date: Date | null
  repo_url: string | null
  is_group: number
  is_template: number
  status: number
  docs_synced_at: Date | null
  docs_committed_at: Date | null
  created_at: Date
  updated_at: Date
}

export default defineEventHandler(async (event) => {
  const pool = useDbPool()
  const query = getQuery(event)

  const search = (query.search as string) || ''
  const deptCode = query.dept_code as string
  const status = query.status !== undefined ? Number(query.status) : undefined

  try {
    let sql = `
      SELECT id, project_code, parent_code, name, dept_code, leader_uid, description,
             start_date, end_date, repo_url, is_group, is_template, status,
             docs_synced_at, docs_committed_at, created_at, updated_at
      FROM git_projects
      WHERE 1=1
    `
    const params: (string | number)[] = []

    if (search) {
      sql += ' AND (project_code LIKE ? OR name LIKE ?)'
      params.push(`%${search}%`, `%${search}%`)
    }

    if (deptCode) {
      sql += ' AND dept_code = ?'
      params.push(deptCode)
    }

    if (status !== undefined) {
      sql += ' AND status = ?'
      params.push(status)
    }

    const isTemplate = query.is_template !== undefined ? Number(query.is_template) : undefined
    if (isTemplate !== undefined) {
      sql += ' AND is_template = ?'
      params.push(isTemplate)
    }

    sql += ' ORDER BY created_at DESC'

    const [rows] = await pool.query<ProjectRow[]>(sql, params)

    return {
      success: true,
      data: rows.map(row => ({
        id: row.id,
        projectCode: row.project_code,
        parentId: row.parent_code,
        name: row.name,
        deptCode: row.dept_code,
        leaderUid: row.leader_uid,
        description: row.description,
        startDate: row.start_date,
        endDate: row.end_date,
        repoUrl: row.repo_url,
        isGroup: row.is_group,
        isTemplate: row.is_template,
        status: row.status,
        docsSyncedAt: row.docs_synced_at,
        docsCommittedAt: row.docs_committed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      total: rows.length
    }
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('Failed to get git_projects:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to get git_projects'
    })
  }
})
