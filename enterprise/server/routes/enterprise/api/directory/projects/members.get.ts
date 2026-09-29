import { createError, defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleDirectoryProjectMember } from '@hzy/foundation/app/types/consoleDirectory'
import { consoleDirectoryReadQuery } from '../../../../../utils/consoleDirectoryRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const query = consoleDirectoryReadQuery(event, { page: 'page', pageSize: 'pageSize', search: 'search', projectCode: 'segment', status: ['active', 'inactive', 'archived', 'deleted', 'all'] })
  if (!query.projectCode) throw createError({ statusCode: 400, statusMessage: 'projectCode is required' })
  const data = await fetchConsoleUserApi<{ items: ConsoleDirectoryProjectMember[], total: number }>(event, 'directory.projects.members.list', { query })
  return { code: 0, data }
})
