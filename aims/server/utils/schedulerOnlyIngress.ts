export function isAimsSchedulerOnlyWake(method: string, pathname: string): boolean {
  return method === 'POST'
    && (pathname === '/api/internal/integration-operations/drain'
      || pathname === '/aims/api/internal/integration-operations/drain')
}
