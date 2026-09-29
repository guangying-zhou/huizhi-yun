import { defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleDirectoryUser } from '@hzy/foundation/app/types/consoleDirectory'
import { consoleDirectoryReadQuery } from '../../../../../utils/consoleDirectoryRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = consoleDirectoryReadQuery(event, { page: 'page', pageSize: 'pageSize', search: 'search', deptCode: 'segment', status: ['active', 'inactive', 'pending', 'deleted', 'all'] })
  const data = await fetchConsoleUserApi<{ items: ConsoleDirectoryUser[], total: number }>(event, 'directory.users.list', { query })
  return { code: 0, data }
})
