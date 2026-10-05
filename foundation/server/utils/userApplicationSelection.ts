export interface ConsoleUserApplicationCandidate {
  appCode?: unknown
}

export interface ConsoleUserApplicationSelectionOptions {
  authorizationEvaluated?: boolean
}

function appCode(value: unknown) {
  return String(value || '').trim()
}

export function shouldUseConsoleUserApplications(
  apps: ConsoleUserApplicationCandidate[],
  options: ConsoleUserApplicationSelectionOptions = {}
) {
  if (options.authorizationEvaluated) return true

  return apps.some((app) => {
    const code = appCode(app.appCode)
    return Boolean(code && code !== 'workspace' && code !== 'console')
  })
}
