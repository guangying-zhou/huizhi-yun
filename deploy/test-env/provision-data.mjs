#!/usr/bin/env node
// Run only on the approved domestic test host after copying schema files here.
// Secrets are generated on that host and are never printed or committed.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes, generateKeyPairSync, createHash, createCipheriv } from 'node:crypto'

process.on('uncaughtException', () => {
  console.error('Test provisioning failed. Inspect the protected host state before retrying; subprocess details suppressed to protect credentials.')
  process.exit(1)
})

const root = '/wiztek/hzy-test'
const name = 'hzy-test-mysql'
const marker = `${root}/provisioned.json`
if (process.argv[2] !== '--execute') throw new Error('Requires --execute on the approved test host')
if (fs.existsSync(marker)) throw new Error('Already provisioned; use migrations rather than rerunning initialization')
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw new Error('Unexpected host')
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], ...options })
const secret = (path, value) => fs.writeFileSync(path, value, { mode: 0o600, flag: 'wx' })
for (const dir of ['secrets', 'mysql', 'runtime', 'schema']) fs.mkdirSync(`${root}/${dir}`, { recursive: true, mode: 0o700 })
if (fs.existsSync(`${root}/mysql/auto.cnf`)) throw new Error('Existing MySQL data; refusing initialization')
const rootPassword = randomBytes(32).toString('hex')
const dbPassword = randomBytes(32).toString('hex')
const vaultKey = randomBytes(32)
secret(`${root}/secrets/mysql-root`, rootPassword)
secret(`${root}/secrets/runtime-db`, dbPassword)
secret(`${root}/secrets/vault-key`, vaultKey.toString('base64'))
const image = run('docker', ['image', 'inspect', 'mysql:8.0', '--format', '{{index .RepoDigests 0}}']).toString().trim()
run('docker', ['run', '-d', '--name', name, '--restart', 'unless-stopped', '--label', 'hzy.environment=test',
  '--memory', '896m', '--memory-swap', '896m', '--cpus', '0.75', '--pids-limit', '256',
  '-p', '127.0.0.1:13316:3306', '-v', `${root}/mysql:/var/lib/mysql`,
  '-v', `${root}/secrets/mysql-root:/run/secrets/mysql-root:ro`,
  '-e', 'MYSQL_ROOT_PASSWORD_FILE=/run/secrets/mysql-root', image,
  '--innodb-buffer-pool-size=256M', '--max-connections=40', '--performance-schema=OFF',
  '--innodb-redo-log-capacity=128M', '--skip-log-bin'])
const sql = input => run('docker', ['exec', '-i', name, 'sh', '-c',
  'MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysql -uroot --batch --skip-column-names'], { input }).toString()
let ready = false
for (let attempt = 0; attempt < 90; attempt++) {
  try { sql('SELECT 1;'); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 1000)) }
}
if (!ready) throw new Error('Test MySQL did not become ready; inspect its logs without rerunning initialization')
for (const app of ['console', 'people']) sql(fs.readFileSync(`${root}/schema/${app}.sql`))
sql(`CREATE USER 'hzy_test_runtime'@'%' IDENTIFIED BY '${dbPassword}';
GRANT SELECT,INSERT,UPDATE,DELETE,CREATE TEMPORARY TABLES ON hzy_console.* TO 'hzy_test_runtime'@'%';
GRANT SELECT,INSERT,UPDATE,DELETE,CREATE TEMPORARY TABLES ON hzy_people.* TO 'hzy_test_runtime'@'%';
INSERT INTO hzy_console.org_profiles(tenant_code,org_name,display_name) VALUES('HTEST001','汇智云合成测试企业','汇智云测试环境');`)
// Initialize a new customer-held OIDC key using the Runtime's Vault cipher format.
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const kid = 'hzy-test-20260905'
const pub = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' }
const priv = JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid, alg: 'EdDSA', use: 'sig' })
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', vaultKey, iv)
const data = Buffer.concat([cipher.update(priv), cipher.final()])
const blob = JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') })
const hex = text => `CONVERT(0x${Buffer.from(text).toString('hex')} USING utf8mb4)`
sql(`USE hzy_console;
INSERT INTO vault_secrets(secret_code,secret_ref,secret_name,secret_type,usage_type,storage_backend,reveal_policy)
VALUES('auth.oidc.signing.${kid}','hzybase://vault/auth.oidc.signing.${kid}','Test OIDC signing key','private_key','custody','db_encrypted','deny');
SET @sid=LAST_INSERT_ID();
INSERT INTO vault_secret_versions(secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme,key_fingerprint)
VALUES(@sid,1,${hex(blob)},'sha256_${createHash('sha256').update(priv).digest('hex')}','aes256-gcm','${createHash('sha256').update(vaultKey).digest('hex').slice(0, 32)}');
UPDATE vault_secrets SET current_version_id=LAST_INSERT_ID() WHERE id=@sid;
INSERT INTO auth_signing_keys(kid,alg,use_type,public_jwk_json,private_key_ref,status)
VALUES('${kid}','EdDSA','sig',${hex(JSON.stringify(pub))},'hzybase://vault/auth.oidc.signing.${kid}','current');`)
const db = database => ({ host: '127.0.0.1', port: 13316, user: 'hzy_test_runtime', password: dbPassword, database, connectionLimit: 3 })
const config = {
  server: { host: '127.0.0.1', port: 18084 }, tenant: 'HTEST001', deployment: 'htest001-test-tenant-runtime',
  deploymentBindings: { console: 'HTEST001-console', people: 'HTEST001-people' },
  auth: { mode: 'jwt', jwt: { audience: 'data-runtime', issuer: 'http://127.0.0.1:3000/console', jwksJson: JSON.stringify({ keys: [pub] }) } },
  apps: { console: { enabled: true, db: db('hzy_console'), vaultMasterKeyFile: `${root}/secrets/vault-key` },
    directory: { enabled: true, db: db('hzy_console') }, people: { enabled: true, db: db('hzy_people') }, finance: { enabled: false } }
}
secret(`${root}/runtime/config.json`, JSON.stringify(config, null, 2))
fs.writeFileSync(marker, JSON.stringify({ tenant: 'HTEST001', environment: 'test', mysqlImage: image, initializedAt: new Date().toISOString(), schemas: ['hzy_console', 'hzy_people'] }, null, 2), { mode: 0o600, flag: 'wx' })
console.log('Isolated MySQL initialized; Console/People schemas installed; fresh encrypted signing key; JWT required. No production data copied.')
