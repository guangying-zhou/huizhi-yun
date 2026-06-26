import { requirePermission } from '~~/server/utils/checkPermission'
import { getDirectoryMeta, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'console_overview', 'view')
  return ok(await getDirectoryMeta())
})
