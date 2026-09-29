import { defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleDirectoryCommittee } from '@hzy/foundation/app/types/consoleDirectory'
import { consoleDirectoryEditPermission } from '../../../../../utils/consoleDirectoryPermissions'
import { consoleDirectoryReadQuery } from '../../../../../utils/consoleDirectoryRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = consoleDirectoryReadQuery(event, { page: 'page', pageSize: 'pageSize', search: 'search', status: ['active', 'inactive', 'deleted', 'all'] })
  const canEdit = await consoleDirectoryEditPermission(event, 'directory_departments')
  const data = await fetchConsoleUserApi<{ items: ConsoleDirectoryCommittee[], total: number }>(event, 'directory.committees.list', { query })
  return { code: 0, data, canEdit }
})
