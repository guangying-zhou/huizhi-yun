export type PlatformAction = string

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH'])
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function resolveOpsPermission(path: string, method: string): { resourceCode: string, requiredAction: PlatformAction } {
  const normalizedMethod = String(method || 'GET').toUpperCase()
  const normalizedPath = path.replace('/api/platform/admin/', '/api/platform/ops/')
  const requiredAction: PlatformAction = READ_METHODS.has(normalizedMethod)
    ? 'view'
    : WRITE_METHODS.has(normalizedMethod)
      ? 'edit'
      : 'admin'

  const segment = normalizedPath.startsWith('/api/platform/ops/')
    ? normalizedPath.slice('/api/platform/ops/'.length).split('/')[0]
    : ''

  switch (segment) {
    case 'tenants':
    case 'onboarding':
      return { resourceCode: 'ops.tenants', requiredAction }
    case 'applications':
    case 'app-manifest-imports':
      return { resourceCode: 'ops.applications', requiredAction }
    case 'subscriptions':
      if (
        normalizedMethod === 'POST'
        && /^\/api\/platform\/ops\/subscriptions\/orders\/[^/]+\/confirm$/.test(normalizedPath)
      ) {
        return { resourceCode: 'ops.subscriptions', requiredAction: 'confirm' }
      }
      return { resourceCode: 'ops.subscriptions', requiredAction }
    case 'deployments':
      if (READ_METHODS.has(normalizedMethod)) return { resourceCode: 'ops.deployments', requiredAction: 'view' }
      if (normalizedMethod === 'DELETE') return { resourceCode: 'ops.deployments', requiredAction: 'admin' }
      return { resourceCode: 'ops.deployments', requiredAction: 'deploy' }
    case 'licenses':
      return { resourceCode: 'ops.licenses', requiredAction }
    case 'users':
    case 'subjects':
    case 'subject-identities':
      return { resourceCode: 'ops.identities', requiredAction }
    case 'roles':
    case 'resources':
      return { resourceCode: 'ops.roles', requiredAction }
    case 'templates':
    case 'template-bindings':
    case 'template-overrides':
      return { resourceCode: 'ops.templates', requiredAction }
    default:
      return { resourceCode: 'ops.console', requiredAction }
  }
}
