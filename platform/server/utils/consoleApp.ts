import type { RowDataPacket } from 'mysql2/promise'

export const CONSOLE_APP_CODE = 'console'

type QueryExecutor = {
  queryRow: <T extends RowDataPacket>(sql: string, params?: unknown[]) => Promise<T | null>
}

interface ConsoleApplicationRow extends RowDataPacket {
  id: number
  status: string
  latest_manifest_id: number | null
  latest_registration_id: number | null
}

export async function requireConsoleApplicationRegistered(executor: QueryExecutor) {
  const application = await executor.queryRow<ConsoleApplicationRow>(
    `SELECT id, status, latest_manifest_id, latest_registration_id
     FROM platform_applications
     WHERE app_code = ?
     LIMIT 1`,
    [CONSOLE_APP_CODE]
  )

  if (!application) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'console application is not registered; import console app.manifest.json from GitLab release before onboarding'
    })
  }

  if (application.status !== 'active') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: `console application is not active: status=${application.status}`
    })
  }

  if (!application.latest_manifest_id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'console application manifest is not registered; import console app.manifest.json from GitLab release before onboarding'
    })
  }

  if (!application.latest_registration_id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message: 'console application manifest was created by legacy seed; re-import console app.manifest.json from GitLab release before onboarding'
    })
  }

  return application
}
