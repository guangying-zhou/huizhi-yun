import { defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleDirectoryCommitteeMember } from '@hzy/foundation/app/types/consoleDirectory'
import { consoleDirectoryReadQuery, consoleDirectoryReadParam } from '../../../../../../utils/consoleDirectoryRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const committeeCode = consoleDirectoryReadParam(event, 'committeeCode')
  const query = consoleDirectoryReadQuery(event, { page: 'page', pageSize: 'pageSize', search: 'search', role: ['leader', 'manager', 'member', 'observer'] })
  const data = await fetchConsoleUserApi<{ items: ConsoleDirectoryCommitteeMember[], total: number }>(event, 'directory.committees.members.list', { params: { committeeCode }, query })
  return { code: 0, data }
})
