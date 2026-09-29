import { defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleDirectoryDepartment } from '@hzy/foundation/app/types/consoleDirectory'
import { consoleDirectoryReadQuery } from '../../../../../utils/consoleDirectoryRead'

import { consoleDirectoryEditPermission } from '../../../../../utils/consoleDirectoryPermissions'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = consoleDirectoryReadQuery(event, {})
  const canEdit = await consoleDirectoryEditPermission(event, 'directory_departments')
  const data = await fetchConsoleUserApi<{ tree: ConsoleDirectoryDepartment[], flat: ConsoleDirectoryDepartment[] }>(event, 'directory.departments.list', { query })
  return { code: 0, data, canEdit }
})
