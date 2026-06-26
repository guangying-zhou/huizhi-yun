import { ok, requireString } from '~~/server/utils/api'
import { runOnboardingStep } from '~~/server/utils/onboardingFlow'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const tenantCode = requireString(body.tenantCode, 'tenantCode')
  const stepCode = requireString(body.stepCode, 'stepCode')
  const result = await runOnboardingStep({
    tenantCode,
    stepCode,
    environment: body.environment as string | null | undefined,
    platformBaseUrl: body.platformBaseUrl as string | null | undefined,
    rotateRuntimeToken: body.rotateRuntimeToken === true,
    runtimeTokenExpiresAt: body.runtimeTokenExpiresAt as string | null | undefined,
    forceBundle: body.forceBundle === true
  })

  return ok(result)
})
