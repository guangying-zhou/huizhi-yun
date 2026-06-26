import { requirePermission } from '~~/server/utils/checkPermission'
import { listSubjectExports, ok } from '~~/server/utils/directoryRuntime'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'directory_sync', 'view')
  return ok(await listSubjectExports(getQuery(event)))
})
