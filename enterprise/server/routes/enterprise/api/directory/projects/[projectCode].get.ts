import { defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleDirectoryProject } from '@hzy/foundation/app/types/consoleDirectory'
import { consoleDirectoryReadParam, consoleDirectoryReadQuery } from '../../../../../utils/consoleDirectoryRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  consoleDirectoryReadQuery(event, {})
  const projectCode = consoleDirectoryReadParam(event, 'projectCode')
  const data = await fetchConsoleUserApi<ConsoleDirectoryProject>(event, 'directory.projects.read', { params: { projectCode } })
  return { code: 0, data }
})
