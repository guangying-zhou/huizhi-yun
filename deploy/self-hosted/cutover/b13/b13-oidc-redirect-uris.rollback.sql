-- Rollback of b13-oidc-redirect-uris.sql: the forward guard required that no aidcp.wiztek.cn URI existed, so every such 'local' row of the five clients is ours.
DELETE u FROM auth_client_redirect_uris u JOIN auth_clients c ON c.id = u.client_id
WHERE u.source = 'local' AND u.redirect_uri LIKE 'https://aidcp.wiztek.cn/%' AND c.client_id IN ('console','aims','workflow','codocs','enterprise');
