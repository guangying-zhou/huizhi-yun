import { defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleDirectoryProject } from '@hzy/foundation/app/types/consoleDirectory'
import { consoleDirectoryEditPermission } from '../../../../../utils/consoleDirectoryPermissions'
import { consoleDirectoryReadQuery } from '../../../../../utils/consoleDirectoryRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = consoleDirectoryReadQuery(event, { page: 'page', pageSize: 'pageSize', search: 'search', deptCode: 'segment', leaderUid: 'segment', status: ['active', 'inactive', 'archived', 'deleted', 'all'] })
  const canEdit = await consoleDirectoryEditPermission(event, 'directory_projects')
  const data = await fetchConsoleUserApi<{ items: ConsoleDirectoryProject[], flat: ConsoleDirectoryProject[], total: number }>(event, 'directory.projects.list', { query })
  return { code: 0, data, canEdit }
})
