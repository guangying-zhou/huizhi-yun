export interface ConsoleRuntimeSummary {
  version: string | null
  status: 'healthy' | 'degraded' | 'unavailable' | 'unknown'
  healthy: boolean
  available: boolean
  lastSeenAt: string | null
  checkedAt: string
  failureCategory: 'runtime-unavailable' | 'runtime-unhealthy' | 'applications-unavailable' | 'applications-degraded' | null
}
