import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'

export async function authorize(event: unknown, uid: string) {
  return loadScopedAuthorizationFromConsoleRuntime(event, uid, 'aims', {
    resourceCode: 'projects',
    action: 'edit'
  })
}
