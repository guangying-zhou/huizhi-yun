export async function verifyPolicyStorageIssuance(
  issue: (audience: string, scope: string) => Promise<string>,
  context: { tenant: string, deployment: string, issuer: string }
) {
  const results = []
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    for (const scope of ['console:policy-bundle:read', 'console:policy-bundle:write', 'console:policy-bundle:read console:policy-bundle:write']) {
      // Token is received over the authenticated Runtime transport, never returned
      // to callers or logs. Runtime owns signing and active-grant enforcement.
      const token = await issue(audience, scope)
      if (token.split('.').length !== 3 || !token.split('.')[2]) throw new Error('invalid issued token')
      const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
      const now = Math.floor(Date.now() / 1000)
      if (claims.iss !== context.issuer || claims.aud !== audience || claims.tenant !== context.tenant
        || claims.deployment !== context.deployment || claims.scope !== scope || claims.token_use !== 'service'
        || claims.source_app !== 'console' || claims.target_app !== audience || !claims.client_id
        || !claims.hzy?.credentialId || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)
        || claims.iat > now || claims.exp <= now) throw new Error('issued policy token binding invalid')
      results.push({ audience, scope, issued: true })
    }
  }
  return results
}
