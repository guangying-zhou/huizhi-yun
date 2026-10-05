import { redeemTenantRuntimeEnrollment } from '~~/server/utils/tenantRuntimeEnrollment'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const body = await readBody<Record<string, unknown>>(event)
  const code = String(body.code || '').trim()
  const runtimeCode = String(body.runtimeCode || '').trim()
  const runtimeVersion = String(body.runtimeVersion || '').trim()
  const releaseSigningKeyId = String(body.releaseSigningKeyId || '').trim()
  const runtimeEndpoint = String(body.runtimeEndpoint || '').trim() || null
  if (!code.startsWith('hzy_enr_') || !runtimeCode || !runtimeVersion || !releaseSigningKeyId) {
    throw createError({ statusCode: 400, message: 'code, runtimeCode, runtimeVersion and releaseSigningKeyId are required' })
  }
  return {
    data: await redeemTenantRuntimeEnrollment({ code, runtimeCode, runtimeVersion, releaseSigningKeyId, runtimeEndpoint })
  }
})
