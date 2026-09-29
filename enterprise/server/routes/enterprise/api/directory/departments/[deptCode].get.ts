import { defineEventHandler, setHeader } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleDirectoryDepartment } from '@hzy/foundation/app/types/consoleDirectory'
import { consoleDirectoryReadParam, consoleDirectoryReadQuery } from '../../../../../utils/consoleDirectoryRead'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  consoleDirectoryReadQuery(event, {})
  const deptCode = consoleDirectoryReadParam(event, 'deptCode')
  const data = await fetchConsoleUserApi<ConsoleDirectoryDepartment>(event, 'directory.departments.read', { params: { deptCode } })
  return { code: 0, data }
})
