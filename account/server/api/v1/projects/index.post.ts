import { useDbPool } from '~~/server/utils/db'
import { verifyApiKey } from '~~/server/utils/api-auth'
import type { ResultSetHeader } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['项目管理'],
    summary: '创建项目',
    description: '创建新项目，可同时指定成员。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['projectCode', 'name', 'deptCode', 'leaderUid', 'isGroup', 'isTemplate', 'creatorUid'],
            properties: {
              projectCode: { type: 'string' },
              parentId: { type: 'string' },
              name: { type: 'string' },
              deptCode: { type: 'string' },
              leaderUid: { type: 'string' },
              description: { type: 'string' },
              isGroup: { type: 'integer', enum: [0, 1] },
              isTemplate: { type: 'integer', enum: [0, 1] },
              repoUrl: { type: 'string' },
              creatorUid: { type: 'string' },
              members: { type: 'array', items: { type: 'object' } }
            }
          }
        }
      }
    }
  }
})

interface CreateProjectBody {
  projectCode: string
  name: string
  deptCode: string
  leaderUid?: string
  description?: string
  repoUrl?: string
  isGroup?: number
  isTemplate?: number
  members?: Array<{
    uid: string
    role: 'member' | 'admin'
  }>
}

export default defineEventHandler(async (event) => {
  // Verify API key
  await verifyApiKey(event)

  const body = await readBody<CreateProjectBody>(event)
  const pool = useDbPool()

  // Validation
  if (!body.projectCode || !body.name || !body.deptCode) {
    throw createError({
      statusCode: 400,
      message: 'Missing required fields: projectCode, name, deptCode'
    })
  }

  // Validate projectCode format (lowercase letters, numbers and hyphens)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.projectCode)) {
    throw createError({
      statusCode: 400,
      message: 'Invalid projectCode format. Use lowercase letters, numbers and hyphens (e.g. proj-abc-123)'
    })
  }

  const connection = await pool.getConnection()

  try {
    await connection.beginTransaction()

    // 1. Insert Project
    const [projectResult] = await connection.query<ResultSetHeader>(
      `INSERT INTO git_projects (project_code, name, dept_code, leader_uid, description, repo_url, is_group, is_template, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        body.projectCode,
        body.name,
        body.deptCode,
        body.leaderUid || null,
        body.description || null,
        body.repoUrl || null,
        body.isGroup || 0,
        body.isTemplate || 0
      ]
    )

    // 2. Insert Members
    if (body.members && body.members.length > 0) {
      const values = body.members.map(m => [
        body.projectCode,
        m.uid,
        m.role || 'member'
      ])

      await connection.query(
        'INSERT INTO git_project_members (project_code, uid, role) VALUES ?',
        [values]
      )
    }

    await connection.commit()

    return {
      code: 0,
      message: 'success',
      data: {
        id: projectResult.insertId
      }
    }
  } catch (err: unknown) {
    const error = err as { code?: string, statusCode?: number, message?: string }
    await connection.rollback()

    // Handle duplicate key error
    if (error.code === 'ER_DUP_ENTRY') {
      throw createError({
        statusCode: 409,
        message: 'Project ID already exists'
      })
    }

    console.error('Failed to create project:', error)
    throw createError({
      statusCode: 500,
      message: error.message || 'Failed to create project'
    })
  } finally {
    connection.release()
  }
})
