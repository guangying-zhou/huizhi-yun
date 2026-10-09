import { contractOk } from '~~/server/utils/controlPlaneV1'
import { revokePlatformSession } from '~~/server/utils/platformAuth'

export default defineEventHandler(async (event) => {
  await revokePlatformSession(event)

  return contractOk({
    revoked: true
  })
})
