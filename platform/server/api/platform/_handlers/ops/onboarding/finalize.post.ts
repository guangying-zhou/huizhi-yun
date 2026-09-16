import { ok, requireString } from '~~/server/utils/api'
import { finalizeOnboarding } from '~~/server/utils/onboardingFlow'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const result = await finalizeOnboarding({
    tenantCode,
    environment: body.environment as string | null | undefined,
    platformBaseUrl: body.platformBaseUrl as string | null | undefined,
    rotateRuntimeToken: body.rotateRuntimeToken === true,
    runtimeTokenExpiresAt: body.runtimeTokenExpiresAt as string | null | undefined,
    forceBundle: body.forceBundle === true
  })

  return ok(result)
})
