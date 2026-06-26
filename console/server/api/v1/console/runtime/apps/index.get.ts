import { requirePermission } from '~~/server/utils/checkPermission'
import { listRuntimeApps, runtimeAppControlContext } from '~~/server/utils/runtimeApps'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'system_settings', 'admin')

  return {
    code: 0,
    data: {
      context: runtimeAppControlContext(),
      items: await listRuntimeApps()
    }
  }
})
