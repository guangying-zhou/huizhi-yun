import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRow, withTransaction } from '~~/server/utils/db'

interface ApplicationRow extends RowDataPacket {
  app_code: string
}

interface CountRow extends RowDataPacket {
  total: number
}

interface MySqlError extends Error {
  code?: string
  errno?: number
}

function requireId(event: H3Event) {
  const raw = getRouterParam(event, 'id')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'id is invalid' })
  }
  return id
}

async function countRows(sql: string, params: unknown[]) {
  const row = await queryRow<CountRow>(sql, params)
  return Number(row?.total || 0)
}

function conflictMessage(blockers: Array<{ label: string, count: number }>) {
  return blockers
    .filter(item => item.count > 0)
    .map(item => `${item.label} ${item.count} 条`)
    .join('，')
}

function isForeignKeyConstraintError(error: unknown) {
  const mysqlError = error as MySqlError
  return mysqlError.code === 'ER_ROW_IS_REFERENCED_2' || mysqlError.errno === 1451
}

export default defineEventHandler(async (event) => {
  const id = requireId(event)

  const application = await queryRow<ApplicationRow>(
    'SELECT app_code FROM platform_applications WHERE id = ? LIMIT 1',
    [id]
  )

  if (!application) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `application not found: id=${id}` })
  }

  const appCode = application.app_code
  const [planAppCount, subscriptionCount, deploymentCount] = await Promise.all([
    countRows('SELECT COUNT(*) AS total FROM platform_plan_apps WHERE app_code = ?', [appCode]),
    countRows('SELECT COUNT(*) AS total FROM subscriptions WHERE app_code = ?', [appCode]),
    countRows('SELECT COUNT(*) AS total FROM deployments WHERE app_code = ?', [appCode])
  ])

  const blockers = [
    { label: '套餐绑定', count: planAppCount },
    { label: '租户订阅', count: subscriptionCount },
    { label: '部署实例', count: deploymentCount }
  ].filter(item => item.count > 0)

  if (blockers.length) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `应用仍有关联数据：${conflictMessage(blockers)}。请先解除套餐、订阅与部署关联，或改为暂停应用。`,
      data: {
        blockers
      }
    })
  }

  try {
    await withTransaction(async (tx) => {
      await tx.execute<ResultSetHeader>(
        `UPDATE platform_applications
         SET latest_manifest_id = NULL,
             latest_registration_id = NULL,
             latest_release_id = NULL,
             last_manifest_registered_at = NULL,
             last_manifest_review_status = NULL,
             last_released_at = NULL
         WHERE id = ?`,
        [id]
      )

      await tx.execute<ResultSetHeader>('DELETE FROM platform_app_role_scopes WHERE app_code = ?', [appCode])
      await tx.execute<ResultSetHeader>('DELETE FROM platform_app_role_permissions WHERE app_code = ?', [appCode])
      await tx.execute<ResultSetHeader>('DELETE FROM platform_app_releases WHERE app_code = ?', [appCode])
      await tx.execute<ResultSetHeader>('DELETE FROM platform_app_manifest_registrations WHERE app_code = ?', [appCode])
      await tx.execute<ResultSetHeader>('DELETE FROM platform_app_manifest_resource_actions WHERE app_code = ?', [appCode])
      await tx.execute<ResultSetHeader>('DELETE FROM platform_app_manifest_resources WHERE app_code = ?', [appCode])
      await tx.execute<ResultSetHeader>('DELETE FROM platform_app_manifests WHERE app_code = ?', [appCode])

      const result = await tx.execute<ResultSetHeader>(
        'DELETE FROM platform_applications WHERE id = ?',
        [id]
      )

      if (!result.affectedRows) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found', message: `application not found: id=${id}` })
      }
    })
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message: '应用仍被其他数据引用，无法直接删除。请先解除相关引用，或改为暂停应用。'
      })
    }
    throw error
  }

  return ok({
    id,
    appCode
  })
})
