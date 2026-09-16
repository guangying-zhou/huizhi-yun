import { readBody, setHeader } from 'h3'
import { redeemConsoleDirectoryConnectorEnrollment } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  setHeader(event, 'Cache-Control', 'no-store')
  const response = await redeemConsoleDirectoryConnectorEnrollment(event, {
    enrollmentToken: body.enrollmentToken,
    publicKeyPem: body.publicKeyPem,
    version: body.version,
    capabilities: body.capabilities
  })
  return response.data
})
