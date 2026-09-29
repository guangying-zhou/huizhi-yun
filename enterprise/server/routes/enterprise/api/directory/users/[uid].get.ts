import { defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleDirectoryUser } from '@hzy/foundation/app/types/consoleDirectory'
import { consoleDirectoryReadParam, consoleDirectoryReadQuery } from '../../../../../utils/consoleDirectoryRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  consoleDirectoryReadQuery(event, {})
  const uid = consoleDirectoryReadParam(event, 'uid')
  const data = await fetchConsoleUserApi<ConsoleDirectoryUser>(event, 'directory.users.read', { params: { uid } })
  return { code: 0, data }
})
