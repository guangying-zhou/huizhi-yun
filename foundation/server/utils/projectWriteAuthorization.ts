import { createError, type H3Event } from 'h3'
import type { FoundationObjectContext } from './scopeEvaluator'
import { loadScopedAuthorizationFromConsoleRuntime } from './platformBundleAuthorization'
import { enterpriseRuntimePermitExpiresAt } from './enterpriseRuntimeClient'

// A denied static decision is not a relationship verdict. Only the owning
// Runtime may satisfy this alternative, using current rows under its write lock.
// Console failure still propagates; it must never become a relationship fallback.
export async function loadProjectWriteAuthorization(
  event: H3Event,
  user: { uid: string, tenant: string, deployment: string },
  projectId: string,
  object: FoundationObjectContext,
  target: { resource: 'projects', action: 'edit' } | { resource: 'project-members', action: 'add' | 'role' | 'remove' }
) {
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, user.uid, 'aims', {
    resourceCode: 'projects', action: 'edit', object
  })
  if (typeof scoped.decision?.allowed !== 'boolean') throw createError({ statusCode: 503, message: '项目授权判定不完整' })
  return {
    actorUid: user.uid, tenant: user.tenant, deployment: user.deployment,
    ...target, projectId, mode: 'static-or-project-manager' as const,
    allowed: scoped.decision?.allowed === true,
    expiresAt: enterpriseRuntimePermitExpiresAt()
  }
}

// Discovery only, from a current Runtime project response. Mutations always
// recheck this relationship in the owning transaction.
export function projectWriteDiscoveryAllows(staticAllowed: boolean, runtimeRole: unknown) {
  return staticAllowed === true || runtimeRole === 'manager'
}
