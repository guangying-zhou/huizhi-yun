// These two storage capabilities must be issuable with no policy bundle present.
// Runtime still checks the active Console identity, exact grants and deployment.
export function isPolicyStorageToken(audience: string, scope: string) {
  const scopes = scope.trim().split(/\s+/)
  return ['data-runtime', 'tenant-runtime'].includes(audience)
    && scopes.every(item => ['console:policy-bundle:read', 'console:policy-bundle:write'].includes(item))
}
