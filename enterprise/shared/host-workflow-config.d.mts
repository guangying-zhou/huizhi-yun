export const HOST_WORKFLOW_ENABLED_ENV: 'HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED'
export const HOST_WORKFLOW_ORIGIN_ENV: 'HZY_ENTERPRISE_WORKFLOW_ORIGIN'
export const HOST_WORKFLOW_BASE_PATH: '/workflow'
export class HostWorkflowConfigError extends Error {}
export type EnterpriseHostWorkflowConfig
  = | { mode: 'discovery' | 'disabled' }
    | { mode: 'loopback', origin: string, apiBaseUrl: string }
export function parseLoopbackHttpOrigin(value: unknown, name?: string): string
export function resolveEnterpriseHostWorkflowConfig(env?: Record<string, string | undefined>): EnterpriseHostWorkflowConfig
