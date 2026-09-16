export type PolicyRuntimeActivationMode = 'standalone' | 'managed-cloud-multitenant'

interface PolicyBundleRequestContext {
  activationMode: PolicyRuntimeActivationMode
  environment: string
  deploymentCode: string
}

interface PolicyBundleDeploymentContext {
  activationMode: PolicyRuntimeActivationMode
  runtimeDeploymentCode: string
  bundleDeploymentCode: string
}

export function policyBundleRequestQuery(input: PolicyBundleRequestContext) {
  if (input.activationMode === 'managed-cloud-multitenant') {
    return { environment: input.environment }
  }
  return {
    environment: input.environment,
    ...(input.deploymentCode ? { deploymentCode: input.deploymentCode } : {})
  }
}

export function policyBundleDeploymentMatchesRuntime(input: PolicyBundleDeploymentContext) {
  if (input.activationMode === 'managed-cloud-multitenant') return true
  return !input.runtimeDeploymentCode
    || input.bundleDeploymentCode === input.runtimeDeploymentCode
}
