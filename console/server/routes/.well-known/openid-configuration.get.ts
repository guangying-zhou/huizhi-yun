import { defineEventHandler } from 'h3'
import { getOidcIssuer } from '~~/server/utils/oidc'
import { resolveLocalConsoleFacade } from '@hzy/foundation/server/utils/localConsoleFacade'

export default defineEventHandler((event) => {
  const issuer = getOidcIssuer(event)
  const facade = resolveLocalConsoleFacade(event)
  const endpoint = facade?.publicEndpointBaseUrl || issuer

  return {
    issuer,
    authorization_endpoint: `${endpoint}/oauth/authorize`,
    token_endpoint: `${endpoint}/oauth/token`,
    userinfo_endpoint: `${endpoint}/oauth/userinfo`,
    jwks_uri: `${endpoint}/.well-known/jwks.json`,
    ...(!facade && {
      revocation_endpoint: `${endpoint}/oauth/revoke`,
      introspection_endpoint: `${endpoint}/oauth/introspect`
    }),
    end_session_endpoint: `${endpoint}/oauth/logout`,
    response_types_supported: ['code'],
    grant_types_supported: facade ? ['authorization_code', 'refresh_token'] : ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['EdDSA'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce', 'sid', 'tenant', 'deployment', 'policy_ver', 'caps', 'token_use', 'hzy']
  }
})
