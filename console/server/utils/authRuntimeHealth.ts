import { getConsoleAuthRuntimeHealth } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { getBackgroundRuntimeEvent } from '~~/server/utils/backgroundRuntimeEvent'

export async function collectAuthRuntimeHealthSummary() {
  const response = await getConsoleAuthRuntimeHealth(getBackgroundRuntimeEvent())
  return response.data
}
