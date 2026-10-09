import { defineEventHandler, setHeader } from 'h3'
import { requireEnterpriseUser, callEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireEnterpriseUser(event)
  const response = await callEnterpriseRuntime<{ code: number, data: { shortName: string, displayName: string } }>(event, 'console.org-brand-view', {})
  return { code: response.code, data: { shortName: response.data.shortName, displayName: response.data.displayName } }
})
