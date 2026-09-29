export function localOidcVerification(clients, uris, callbacks) {
  const client = clients.length === 1 ? clients[0] : null
  const enterpriseClientActive = Boolean(client && client.app_code === 'enterprise' && client.client_type === 'public' && client.auth_mode === 'oidc' && client.status === 'active')
  return {
    enterpriseClientActive,
    callbacks: callbacks.map(([uriType, redirectUri]) => ({
      uriType, redirectUri,
      active: enterpriseClientActive && uris.some(uri => String(uri.client_id) === String(client.id) && uri.uri_type === uriType && uri.redirect_uri === redirectUri && uri.status === 'active')
    }))
  }
}
