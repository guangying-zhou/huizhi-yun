import { readBody, setHeader } from 'h3'
import { redeemConnectorRuntimeEnrollment } from '~~/server/utils/connectorRuntimeEnrollment'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  setHeader(event, 'Cache-Control', 'no-store')
  return await redeemConnectorRuntimeEnrollment(event, body)
})
