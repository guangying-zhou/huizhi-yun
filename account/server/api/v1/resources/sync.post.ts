/**
 * 应用资源同步接口
 * POST /api/v1/resources/sync
 *
 * 应用启动时调用此接口，将 manifest 中定义的资源同步到 Account
 * 支持：新增、更新、标记废弃（不自动删除）
 */
import { verifyApiKey } from '~~/server/utils/api-auth'
import { queryRows, getConnection } from '~~/server/utils/db'
import type { RowDataPacket } from 'mysql2/promise'

defineRouteMeta({
  openAPI: {
    tags: ['资源同步'],
    summary: '同步应用资源定义',
    description: '应用启动时调用，将自身资源清单同步到 Account（支持新增、更新、标记废弃）。需要 API Key 认证。',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['appCode', 'resources'],
            properties: {
              appCode: { type: 'string', description: '应用编码' },
              resources: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['code', 'name'],
                  properties: {
                    code: { type: 'string', description: '资源编码（小写字母/数字/下划线）' },
                    name: { type: 'string', description: '资源名称' },
                    description: { type: 'string' },
                    sortOrder: { type: 'integer' }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
})

interface SyncResource {
  code: string
  name: string
  description?: string
  sortOrder?: number
}

interface SyncBody {
  appCode: string
  resources: SyncResource[]
}

interface AppRow extends RowDataPacket {
  id: number
  app_code: string
}

interface ResourceRow extends RowDataPacket {
  id: number
  resource_code: string
  resource_name: string
  description: string | null
  sort_order: number
  status: number
}

export default defineEventHandler(async (event) => {
  await verifyApiKey(event)

  const body = await readBody<SyncBody>(event)

  if (!body.appCode) {
    throw createError({ statusCode: 400, message: 'appCode is required' })
  }
  if (!body.resources || !Array.isArray(body.resources) || body.resources.length === 0) {
    throw createError({ statusCode: 400, message: 'resources array is required' })
  }

  // Validate resource codes
  for (const res of body.resources) {
    if (!res.code || !res.name) {
      throw createError({ statusCode: 400, message: 'Each resource must have code and name' })
    }
    if (!/^[a-z][a-z0-9_]*$/.test(res.code)) {
      throw createError({
        statusCode: 400,
        message: `Invalid resource code "${res.code}": must start with lowercase letter, only lowercase letters, digits, underscores`
      })
    }
  }

  // Find the application
  const apps = await queryRows<AppRow[]>(
    'SELECT id, app_code FROM applications WHERE app_code = ?',
    [body.appCode]
  )
  if (apps.length === 0) {
    throw createError({ statusCode: 404, message: `Application "${body.appCode}" not found` })
  }
  const appId = apps[0]!.id

  // Get existing resources for this app
  const existing = await queryRows<ResourceRow[]>(
    'SELECT id, resource_code, resource_name, description, sort_order, status FROM resources WHERE app_id = ?',
    [appId]
  )
  const existingMap = new Map(existing.map(r => [r.resource_code, r]))

  // Determine changes
  const incomingCodes = new Set(body.resources.map(r => r.code))
  const toInsert: SyncResource[] = []
  const toUpdate: { id: number, resource: SyncResource }[] = []
  const toDeprecate: ResourceRow[] = []

  for (const res of body.resources) {
    const ex = existingMap.get(res.code)
    if (!ex) {
      toInsert.push(res)
    } else {
      // Check if anything changed
      const nameChanged = ex.resource_name !== res.name
      const descChanged = (ex.description || '') !== (res.description || '')
      const sortChanged = ex.sort_order !== (res.sortOrder ?? 0)
      const wasDeprecated = ex.status === 0

      if (nameChanged || descChanged || sortChanged || wasDeprecated) {
        toUpdate.push({ id: ex.id, resource: res })
      }
    }
  }

  // Resources in DB but not in manifest -> mark as deprecated (status=0)
  for (const ex of existing) {
    if (!incomingCodes.has(ex.resource_code) && ex.status === 1) {
      toDeprecate.push(ex)
    }
  }

  // Execute changes in transaction
  const connection = await getConnection()
  try {
    await connection.beginTransaction()

    for (const res of toInsert) {
      await connection.execute(
        'INSERT INTO resources (app_id, resource_code, resource_name, description, sort_order, status) VALUES (?, ?, ?, ?, ?, 1)',
        [appId, res.code, res.name, res.description || null, res.sortOrder ?? 0]
      )
    }

    for (const { id, resource: res } of toUpdate) {
      await connection.execute(
        'UPDATE resources SET resource_name = ?, description = ?, sort_order = ?, status = 1 WHERE id = ?',
        [res.name, res.description || null, res.sortOrder ?? 0, id]
      )
    }

    for (const res of toDeprecate) {
      await connection.execute(
        'UPDATE resources SET status = 0 WHERE id = ?',
        [res.id]
      )
    }

    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  return {
    success: true,
    message: '资源同步完成',
    data: {
      appCode: body.appCode,
      inserted: toInsert.length,
      updated: toUpdate.length,
      deprecated: toDeprecate.length
    }
  }
})
