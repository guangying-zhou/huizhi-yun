import { ok } from '~~/server/utils/api'
import { startOnboarding } from '~~/server/utils/onboardingFlow'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const result = await startOnboarding({
    tenantCode: body.tenantCode as string | null | undefined,
    tenantName: String(body.tenantName || '').trim(),
    displayName: body.displayName as string | null | undefined,
    tenantType: body.tenantType as string | null | undefined,
    primaryDomain: body.primaryDomain as string | null | undefined,
    defaultAuthMode: body.defaultAuthMode as string | null | undefined,
    defaultDeploymentMode: body.defaultDeploymentMode as string | null | undefined,
    planCode: String(body.planCode || '').trim(),
    deploymentCode: body.deploymentCode as string | null | undefined,
    deploymentName: body.deploymentName as string | null | undefined,
    deploymentMode: body.deploymentMode as string | null | undefined,
    environment: body.environment as string | null | undefined,
    deploymentEnvironment: body.deploymentEnvironment as string | null | undefined,
    region: body.region as string | null | undefined,
    deploymentPublicUrl: body.deploymentPublicUrl as string | null | undefined,
    rootAppCode: body.rootAppCode as string | null | undefined,
    consoleBasePath: body.consoleBasePath as string | null | undefined,
    platformBaseUrl: body.platformBaseUrl as string | null | undefined,
    licenseExpiresAt: body.licenseExpiresAt as string | null | undefined,
    runtimeTokenExpiresAt: body.runtimeTokenExpiresAt as string | null | undefined,
    generateBundle: body.generateBundle !== false,
    forceBundle: body.forceBundle === true,
    requestedByUid: event.context.platformUid
  })

  return ok(result)
})
