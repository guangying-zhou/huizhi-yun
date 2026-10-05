-- S4 B13c: register the aidcp.wiztek.cn OIDC callback / post-logout URIs for the five Console OIDC clients that run on the new host.
-- Console materialises URIs from the Platform policy bundle only when HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE=true; the installed env keeps it false, so they are written here.
-- Run AFTER the G-7 apply (it creates the `enterprise` client) and BEFORE the Console starts. Executor: mysql client, one session.
--   Plan  (read-only, lists old URI -> new URI per row):  mysql ... -e "SET @apply=0; source b13-oidc-redirect-uris.sql"
--   Apply (one transaction):                              mysql ... -e "SET @apply=1; source b13-oidc-redirect-uris.sql"
-- Rows come from two sources, shown in the plan's `basis` column:
--   derived  active rows of the console/aims/workflow clients under https://wiztek.huizhi.yun/ (old canonical), domain replaced by
--            https://aidcp.wiztek.cn/. The old Console lived at the domain root, the self-hosted Console lives under /console/, so the console
--            client also gets the /console prefix (old .../api/auth/oidc-callback -> .../console/api/auth/oidc-callback).
--   explicit codocs and enterprise have no row under the old canonical domain; their URIs follow the route layout (Foundation
--            server/api/auth/oidc-callback.get.ts and oidc-post-logout.get.ts under the app base path; the enterprise Host uses its build-time
--            HZY_ENTERPRISE_OIDC_REDIRECT_URI / HZY_ENTERPRISE_LOGOUT_REDIRECT_URI from deploy/self-hosted/build.mjs).
-- Guards (apply inserts nothing unless all hold): five clients active; derived row count = @expect_derived; no aidcp.wiztek.cn URI exists yet.
SET @old_origin = 'https://wiztek.huizhi.yun/';
SET @new_origin = 'https://aidcp.wiztek.cn/';
SET @expect_derived = 6;
SET @apply = IFNULL(@apply, 0);
DROP TEMPORARY TABLE IF EXISTS b13_uri_plan;
CREATE TEMPORARY TABLE b13_uri_plan (
  client_pk BIGINT UNSIGNED NOT NULL, client_id VARCHAR(64) NOT NULL, uri_type VARCHAR(32) NOT NULL,
  old_uri VARCHAR(512) NULL, new_uri VARCHAR(512) NOT NULL, basis VARCHAR(16) NOT NULL
);
INSERT INTO b13_uri_plan
SELECT c.id, c.client_id, r.uri_type, r.redirect_uri,
  IF(c.client_id = 'console', REPLACE(r.redirect_uri, @old_origin, CONCAT(@new_origin, 'console/')), REPLACE(r.redirect_uri, @old_origin, @new_origin)),
  'derived'
FROM auth_client_redirect_uris r JOIN auth_clients c ON c.id = r.client_id
WHERE c.client_id IN ('console','aims','workflow') AND c.status = 'active' AND r.status = 'active' AND LEFT(r.redirect_uri, CHAR_LENGTH(@old_origin)) = @old_origin;
INSERT INTO b13_uri_plan
SELECT c.id, c.client_id, u.uri_type, NULL, u.new_uri, 'explicit'
FROM auth_clients c JOIN (
  SELECT 'codocs' AS client_id, 'redirect' AS uri_type, 'https://aidcp.wiztek.cn/codocs/api/auth/oidc-callback' AS new_uri
  UNION ALL SELECT 'codocs',     'post_logout', 'https://aidcp.wiztek.cn/codocs/api/auth/oidc-post-logout'
  UNION ALL SELECT 'enterprise', 'redirect',    'https://aidcp.wiztek.cn/enterprise/api/auth/oidc-callback'
  UNION ALL SELECT 'enterprise', 'post_logout', 'https://aidcp.wiztek.cn/enterprise/login'
) u ON u.client_id = c.client_id
WHERE c.status = 'active';
SET @clients = (SELECT COUNT(*) FROM auth_clients WHERE client_id IN ('console','aims','workflow','codocs','enterprise') AND status = 'active');
SET @derived = (SELECT COUNT(*) FROM b13_uri_plan WHERE basis = 'derived');
SET @explicit = (SELECT COUNT(*) FROM b13_uri_plan WHERE basis = 'explicit');
SET @pre = (SELECT COUNT(*) FROM auth_client_redirect_uris WHERE redirect_uri LIKE 'https://aidcp.wiztek.cn/%');
SET @ok = (@clients = 5 AND @derived = @expect_derived AND @explicit = 4 AND @pre = 0);
SELECT client_id, uri_type, old_uri, new_uri, basis FROM b13_uri_plan ORDER BY client_id, uri_type;
SELECT @clients AS active_clients, @derived AS derived_rows, @expect_derived AS expect_derived, @explicit AS explicit_rows, @pre AS existing_aidcp_rows, @ok AS guards_ok, @apply AS apply_mode;
START TRANSACTION;
INSERT INTO auth_client_redirect_uris (client_id, uri_type, redirect_uri, source, status, created_at, updated_at)
SELECT client_pk, uri_type, new_uri, 'local', 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP() FROM b13_uri_plan WHERE @apply = 1 AND @ok = 1;
COMMIT;
SELECT COUNT(*) AS aidcp_rows_after FROM auth_client_redirect_uris WHERE redirect_uri LIKE 'https://aidcp.wiztek.cn/%';
DROP TEMPORARY TABLE b13_uri_plan;
