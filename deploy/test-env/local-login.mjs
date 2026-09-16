// Only upstream identity is shared. Tenant/runtime/deployment bindings stay test-only.
const bindings = new Map([
  ['https://sso.wiztek.cn/realms/hzy-test', 'hzy-test-console'],
  ['https://sso.wiztek.cn/realms/wiztek', 'hzy_local_console']
])
const value = input => String(input || '').trim()

export function validateLocalLogin(input) {
  const issuer = value(input?.issuer), clientId = value(input?.clientId)
  const clientSecret = value(input?.clientSecret)
  if (!bindings.has(issuer) || bindings.get(issuer) !== clientId || !clientSecret) {
    throw Error('Local SSO requires an approved issuer/client pair and its own client secret; values suppressed.')
  }
  return { issuer, clientId, clientSecret }
}

export function resolveLocalLogin(env, remoteLogin) {
  const issuer = value(env.SSO_OIDC_ISSUER), clientId = value(env.SSO_OIDC_CLIENT_ID)
  const clientSecret = value(env.SSO_OIDC_CLIENT_SECRET)
  if (env.SSO_OIDC_ENABLE !== undefined && env.SSO_OIDC_ENABLE !== 'true') {
    throw Error('Local SSO must remain enabled.')
  }
  if (!issuer && !clientId && !clientSecret) return validateLocalLogin(remoteLogin)
  if (!issuer || !clientId) throw Error('Configure both SSO_OIDC_ISSUER and SSO_OIDC_CLIENT_ID.')
  if (clientSecret) return validateLocalLogin({ issuer, clientId, clientSecret })
  if (remoteLogin?.issuer !== issuer || remoteLogin?.clientId !== clientId) {
    throw Error('Local SSO secret source does not match the configured issuer/client; update the protected remote login configuration or provide SSO_OIDC_CLIENT_SECRET. Values suppressed.')
  }
  return validateLocalLogin(remoteLogin)
}
