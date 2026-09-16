#!/usr/bin/env node
// Creates only an isolated Keycloak realm and synthetic records in hzy-test-mysql.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
process.on('uncaughtException', () => {
  console.error('Test identity provisioning failed. Inspect the protected host state before retrying; subprocess details suppressed to protect credentials.')
  process.exit(1)
})
const root = '/wiztek/hzy-test'
const realm = 'hzy-test'
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Unexpected host')
if (process.argv[2] !== '--execute' || !fs.existsSync(`${root}/provisioned.json`)) throw new Error('Provision isolated data first, then pass --execute')
if (fs.existsSync(`${root}/identity.json`)) throw new Error('Test identity already provisioned')
const inspect = JSON.parse(execFileSync('docker', ['inspect', 'keycloak'], { encoding: 'utf8' }))[0]
const env = Object.fromEntries(inspect.Config.Env.map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]))
const base = 'http://127.0.0.1:18080'
const tokenResponse = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
  method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli',
    username: env.KEYCLOAK_ADMIN, password: env.KEYCLOAK_ADMIN_PASSWORD })
})
if (!tokenResponse.ok) throw new Error(`Keycloak administrative login failed: HTTP ${tokenResponse.status}`)
const token = (await tokenResponse.json()).access_token
const api = async (path, method = 'GET', body) => {
  const r = await fetch(`${base}/admin/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!r.ok) throw new Error(`Keycloak ${method} ${path}: HTTP ${r.status}`)
  return r.status === 204 || r.status === 201 ? null : r.json()
}
const realms = await api('realms')
if (realms.some(r => r.realm === realm)) throw new Error('Realm already exists; refusing to overwrite it')
const clientSecret = randomBytes(32).toString('hex')
const password = randomBytes(24).toString('base64url')
await api('realms', 'POST', { realm, enabled: true, displayName: '汇智云独立测试环境', registrationAllowed: false,
  resetPasswordAllowed: false, bruteForceProtected: true, sslRequired: 'external',
  clients: [{ clientId: 'hzy-test-console', name: 'Local and staging Console', enabled: true, protocol: 'openid-connect',
    publicClient: false, secret: clientSecret, standardFlowEnabled: true, directAccessGrantsEnabled: false,
    redirectUris: ['http://127.0.0.1:3000/console/api/auth/oidc-callback', 'http://localhost:3180/console/api/auth/oidc-callback', 'https://hzy-test.huizhi.yun/console/api/auth/oidc-callback'],
    webOrigins: ['http://127.0.0.1:3000', 'http://localhost:3180', 'https://hzy-test.huizhi.yun'],
    attributes: { 'post.logout.redirect.uris': 'http://127.0.0.1:3000/console/api/auth/oidc-post-logout##http://localhost:3180/console/api/auth/oidc-post-logout##https://hzy-test.huizhi.yun/console/api/auth/oidc-post-logout' }
  }], users: [{ username: 'hzy-tester', firstName: '合成', lastName: '测试员', email: 'tester@hzy-test.invalid', emailVerified: true, enabled: true,
    credentials: [{ type: 'password', value: password, temporary: false }] }] })
const users = await api(`realms/${realm}/users?username=hzy-tester&exact=true`)
if (users.length !== 1) throw new Error('Synthetic user was not created uniquely')
const q = value => `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`
const sql = input => execFileSync('docker', ['exec', '-i', 'hzy-test-mysql', 'sh', '-c', 'MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysql -uroot --default-character-set=utf8mb4 --batch --skip-column-names'], { input, stdio: ['pipe', 'pipe', 'pipe'] })
sql(`USE hzy_console;
INSERT INTO directory_departments(dept_code,dept_name,dept_path) VALUES('TEST-RD','合成研发部','/TEST-RD/');
INSERT INTO directory_users(uid,username,display_name,email,primary_dept_code,source_provider,external_ref) VALUES('test-user-001','hzy-tester','合成测试员','tester@hzy-test.invalid','TEST-RD','oidc',${q(users[0].id)});
INSERT INTO directory_user_departments(uid,dept_code,is_primary) VALUES('test-user-001','TEST-RD',1);
INSERT INTO auth_clients(client_id,app_code,client_name,client_type,home_url,source) VALUES('people','people','People Local Test','public','http://127.0.0.1:3007/people/','local');
SET @cid=LAST_INSERT_ID();
INSERT INTO auth_client_redirect_uris(client_id,redirect_uri,source) VALUES(@cid,'http://127.0.0.1:3007/people/api/auth/oidc-callback','local');
INSERT INTO hzy_people.people_employees(employee_uid,employee_no,display_name,login_name,dept_code,dept_name) VALUES('test-user-001','001','合成测试员','hzy-tester','TEST-RD','合成研发部');`)
const peopleSecret = randomBytes(32).toString('hex')
sql(`USE hzy_console;
INSERT INTO vault_secrets(secret_code,secret_ref,secret_name,secret_type,usage_type,storage_backend,reveal_policy) VALUES('test.people.runtime','hzybase://vault/test.people.runtime','Test People service credential','client_secret','service','db_encrypted','deny');
SET @sid=LAST_INSERT_ID();
INSERT INTO vault_secret_versions(secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme) VALUES(@sid,1,0x00,'sha256_${createHash('sha256').update(peopleSecret).digest('hex')}','sha256-only');
UPDATE vault_secrets SET current_version_id=LAST_INSERT_ID() WHERE id=@sid;
INSERT INTO service_clients(client_code,client_name,client_type,app_code) VALUES('people.runtime','Test People runtime','app','people');
SET @scid=LAST_INSERT_ID();
INSERT INTO service_client_credentials(service_client_id,client_id,version_no,secret_id) VALUES(@scid,'people.runtime',1,@sid);
UPDATE service_clients SET current_credential_id=LAST_INSERT_ID() WHERE id=@scid;
INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json)
VALUES ${['data-runtime', 'tenant-runtime'].flatMap(audience => ['read', 'write'].map(action => `(@scid,'${audience}:people','${action}',JSON_OBJECT('audience','${audience}','tenantCode','HTEST001','deploymentCode','HTEST001-people'))`)).join(',')};`)
fs.writeFileSync(`${root}/secrets/test-login.json`, JSON.stringify({ username: 'hzy-tester', password, issuer: 'https://sso.wiztek.cn/realms/hzy-test', clientId: 'hzy-test-console', clientSecret, peopleClientId: 'people.runtime', peopleClientSecret: peopleSecret }, null, 2), { mode: 0o600, flag: 'wx' })
fs.writeFileSync(`${root}/identity.json`, JSON.stringify({ realm, uid: 'test-user-001', initializedAt: new Date().toISOString() }), { mode: 0o600, flag: 'wx' })
console.log('Dedicated test realm, OIDC client, synthetic user and People service identity created. Credentials saved only in the protected test secrets directory.')
