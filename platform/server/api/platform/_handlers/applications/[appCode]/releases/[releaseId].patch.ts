import type { H3Event } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import { withTransaction } from '~~/server/utils/db'
import { mapReleaseRow, queryAppReleaseRow } from '~~/server/utils/appReleases'

const ALLOWED_RELEASE_STATUSES = new Set(['draft', 'permissions_pending', 'ready', 'released', 'deprecated'])

function requireReleaseId(event: H3Event) {
  const raw = getRouterParam(event, 'releaseId')
  const id = Number(raw)
  if (!raw || Number.isNaN(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'releaseId is invalid'
    })
  }
  return id
}

function requireReleaseStatus(value: unknown) {
  const status = normalizeNullableString(value)
  if (!status || !ALLOWED_RELEASE_STATUSES.has(status)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `status must be one of: ${Array.from(ALLOWED_RELEASE_STATUSES).join(', ')}`
    })
  }
  return status
}

export default defineEventHandler(async (event) => {
  const appCode = requireString(getRouterParam(event, 'appCode'), 'appCode')
  const releaseId = requireReleaseId(event)
  const body = await readBody<Record<string, unknown>>(event)
  const status = requireReleaseStatus(body.status)

  const release = await withTransaction(async (tx) => {
    const existing = await tx.queryRow<RowDataPacket & { id: number, app_code: string }>(
      `SELECT id, app_code
       FROM platform_app_releases
       WHERE id = ?
         AND app_code = ?
       LIMIT 1
       FOR UPDATE`,
      [releaseId, appCode]
    )

    if (!existing) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        message: `release not found: appCode=${appCode}, releaseId=${releaseId}`
      })
    }

    await tx.execute<ResultSetHeader>(
      `UPDATE platform_app_releases
       SET status = ?,
           released_at = CASE
             WHEN ? = 'released' THEN COALESCE(released_at, NOW())
             ELSE released_at
           END,
           updated_at = NOW()
       WHERE id = ?`,
      [status, status, releaseId]
    )

    if (status === 'released') {
      await tx.execute<ResultSetHeader>(
        `UPDATE platform_applications
         SET latest_release_id = ?,
             last_released_at = NOW(),
             updated_at = NOW()
         WHERE app_code = ?`,
        [releaseId, appCode]
      )
    }

    const updated = await queryAppReleaseRow(tx, appCode, releaseId)
    if (!updated) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Internal Server Error',
        message: 'failed to load updated release'
      })
    }

    return updated
  })

  return ok(mapReleaseRow(release))
})
