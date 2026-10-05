export type WebDevWorkspaceAction = 'execute' | 'deploy'

export interface WebDevJobPermission {
  resource: 'webdev_workspace'
  action: WebDevWorkspaceAction
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function recordValue(input: unknown, key: string) {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)[key]
    : undefined
}

function isDeployToken(value: unknown) {
  const token = stringValue(value).toLowerCase()
  return token === 'deploy'
    || token.startsWith('deploy_')
    || token.startsWith('deployment_')
    || token.includes(':deploy')
    || token.includes('deploy:')
    || token.includes('/deploy')
    || token.endsWith(':deployment')
}

export function resolveWebDevJobPermission(input: unknown): WebDevJobPermission {
  const structuredFields = [
    'type',
    'jobType',
    'job_type',
    'templateId',
    'template_id',
    'kind',
    'mode',
    'action',
    'workflow'
  ]

  const requiresDeploy = structuredFields
    .map(field => recordValue(input, field))
    .some(isDeployToken)
    || isDeployToken(recordValue(input, 'command'))

  return {
    resource: 'webdev_workspace',
    action: requiresDeploy ? 'deploy' : 'execute'
  }
}
