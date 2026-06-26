import { defineEventHandler } from 'h3'
import { getOidcIssuer } from '~~/server/utils/oidc'

export default defineEventHandler((event) => {
  const issuer = getOidcIssuer(event)

  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    end_session_endpoint: `${issuer}/oauth/logout`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['EdDSA'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce', 'sid', 'tenant', 'deployment', 'policy_ver', 'caps', 'hzy']
  }
})
