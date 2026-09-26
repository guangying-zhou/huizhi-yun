// Authorized C000001 document-storage migration only. Production is read-only;
// secrets travel through SSH pipes and are re-encrypted under the test Vault key.
// No plaintext credential or master key is written to disk or reported.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import mysql from 'mysql2/promise'

const apply = process.argv.includes('--apply')
const root = '/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime'
const runtimeKeyPath = spawnSync('plutil', ['-extract', 'EnvironmentVariables.HZY_CONSOLE_VAULT_MASTER_KEY_FILE', 'raw', '/Users/gavinzhou/Library/LaunchAgents/cn.wiztek.hzy-test-runtime.plist'], { encoding: 'utf8' }).stdout.trim()
function normalizeKey(raw) {
  const value = raw.trim()
  const base64 = Buffer.from(value, 'base64')
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && base64.length >= 32) return base64.subarray(0, 32)
  const hex = Buffer.from(value, 'hex')
  if (/^[0-9a-f]+$/i.test(value) && hex.length >= 32) return hex.subarray(0, 32)
  return createHash('sha256').update(value).digest()
}
async function main() {
  const config = JSON.parse(readFileSync(root + '/config.json', 'utf8'))
  if (config.tenant !== 'C000001' || config.apps.console.db.database !== 'hzy_console_test_local_20260910') throw Error('TEST_TARGET_MISMATCH')
  const remote = `
    const fs = require('fs'), cp = require('child_process'), crypto = require('crypto');
    const normalizeKey = ${normalizeKey.toString().replaceAll("createHash(", "crypto.createHash(")};
    (async () => {
      const pid = cp.execFileSync('systemctl',['show','hzy-data-runtime','-p','MainPID','--value'],{encoding:'utf8'}).trim();
      const env = Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\\0').filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
      const query = "SELECT JSON_OBJECT('integration',JSON_OBJECT('integration_type',i.integration_type,'category',i.category,'provider_code',i.provider_code,'base_url',i.base_url,'config_json',i.config_json),'cipher',CAST(v.ciphertext_blob AS CHAR)) FROM integrations i JOIN integration_credentials c ON c.id=i.current_credential_id AND c.integration_id=i.id JOIN vault_secrets s ON s.id=c.secret_id JOIN vault_secret_versions v ON v.id=COALESCE(c.secret_version_id,s.current_version_id) WHERE i.integration_code='oss.default' AND i.status='active' AND c.status='active' AND s.status='active' AND v.status='active' AND s.storage_backend='db_encrypted'";
      const out=cp.spawnSync('mysql',['--host='+env.HZY_CONSOLE_DB_HOST,'--port='+(env.HZY_CONSOLE_DB_PORT||3306),'--user='+env.HZY_CONSOLE_DB_USER,'--batch','--skip-column-names','--raw','hzy_console','-e',query],{env:{...process.env,MYSQL_PWD:env.HZY_CONSOLE_DB_PASSWORD},encoding:'utf8',maxBuffer:1048576});
      if(out.status!==0 || !out.stdout.trim())throw Error('SOURCE_CREDENTIAL_UNAVAILABLE');
      const {integration,cipher}=JSON.parse(out.stdout);
      const blob=JSON.parse(cipher);
      if(blob.v!==1 || blob.alg!=='aes-256-gcm')throw Error('SOURCE_CIPHER_UNSUPPORTED');
      const key=normalizeKey(env.HZY_CONSOLE_VAULT_MASTER_KEY || fs.readFileSync(env.HZY_CONSOLE_VAULT_MASTER_KEY_FILE||'/etc/hzy-data-runtime/console-vault-master-key','utf8'));
      const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(blob.iv,'base64url'));
      decipher.setAuthTag(Buffer.from(blob.tag,'base64url'));
      const secret=Buffer.concat([decipher.update(Buffer.from(blob.data,'base64url')),decipher.final()]).toString('utf8');
      process.stdout.write(JSON.stringify({integration,secret}));
    })().catch(()=>{process.stderr.write('SOURCE_STORAGE_READ_FAILED');process.exitCode=1});
  `
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'root@oa.wiztek.cn', 'node'], { input: remote, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 45000 })
  if (result.status !== 0) throw Error('SOURCE_STORAGE_READ_FAILED')
  const source = JSON.parse(result.stdout)
  const sourceConfig = typeof source.integration.config_json === 'string' ? JSON.parse(source.integration.config_json) : source.integration.config_json
  const dbConfig = config.apps.console.db
  const db = await mysql.createConnection({ host: dbConfig.host, port: dbConfig.port, user: dbConfig.user, password: dbConfig.password, database: dbConfig.database })
  try {
    let credentialMatches = false
    let targetConfigSnapshot
    const [existing] = await db.query("SELECT id,current_credential_id,status FROM integrations WHERE integration_code='oss.default'")
    if (existing[0]?.current_credential_id) {
      const [rows] = await db.query("SELECT i.config_json,v.ciphertext_blob FROM integrations i JOIN integration_credentials c ON c.id=i.current_credential_id JOIN vault_secrets s ON s.id=c.secret_id JOIN vault_secret_versions v ON v.id=COALESCE(c.secret_version_id,s.current_version_id) WHERE i.id=? AND c.status='active' AND s.status='active' AND v.status='active'",[existing[0].id])
      if (rows.length === 1) {
        const key = normalizeKey(readFileSync(runtimeKeyPath || config.apps.console.vaultMasterKeyFile || root + '/console-vault-master-key','utf8'))
        try {
          const blob = JSON.parse(rows[0].ciphertext_blob.toString())
          const decipher = createDecipheriv('aes-256-gcm',key,Buffer.from(blob.iv,'base64url'))
          decipher.setAuthTag(Buffer.from(blob.tag,'base64url'))
          const plaintext = Buffer.concat([decipher.update(Buffer.from(blob.data,'base64url')),decipher.final()]).toString('utf8')
          const targetConfig = typeof rows[0].config_json === 'string' ? JSON.parse(rows[0].config_json) : rows[0].config_json
          credentialMatches = plaintext === source.secret
          targetConfigSnapshot = targetConfig
          console.log(JSON.stringify({ testVaultDecrypts: true, credentialMatchesProduction: plaintext === source.secret,
            configMatchesProduction: JSON.stringify(targetConfig) === JSON.stringify(sourceConfig),
            targetConfigKeys: Object.keys(targetConfig || {}) }))
        } catch { console.log(JSON.stringify({ testVaultDecrypts: false })) }
      }
    }
    console.log(JSON.stringify({ source: 'oa.wiztek.cn/hzy_console', target: dbConfig.database, integration: 'oss.default',
      configKeys: Object.keys(sourceConfig || {}), credentialAvailable: Boolean(source.secret), existing: existing.length ? existing[0] : null, apply }))
    if (!apply) return
    if (existing[0]?.current_credential_id && credentialMatches && targetConfigSnapshot) {
      // Fill missing document-storage parameters only; preserve test overrides
      // and its existing encrypted credential. Compare-and-swap avoids drift.
      const additions = Object.fromEntries(Object.entries(sourceConfig).filter(([key]) =>
        ['region', 'recycleDays', 'bucketDomain', 'projectsEndpoint', 'projectsBucketName', 'projectsBucketDomain'].includes(key)
        && targetConfigSnapshot[key] === undefined))
      if (!Object.keys(additions).length) {
        console.log(JSON.stringify({ configurationAlreadyComplete: true, credentialPreserved: true }))
        return
      }
      const [updated] = await db.query('UPDATE integrations SET config_json=? WHERE id=? AND current_credential_id=? AND config_json=CAST(? AS JSON)',
        [JSON.stringify({ ...targetConfigSnapshot, ...additions }), existing[0].id, existing[0].current_credential_id, JSON.stringify(targetConfigSnapshot)])
      if (updated.affectedRows !== 1) throw Error('TEST_CONFIGURATION_CHANGED')
      console.log(JSON.stringify({ configurationCompleted: true, addedKeys: Object.keys(additions), credentialPreserved: true, sourceReadOnly: true }))
      return
    }
    // An active target credential is never silently replaced.
    if (existing[0]?.current_credential_id) throw Error('TARGET_ALREADY_HAS_CREDENTIAL')
    const keyPath = runtimeKeyPath || config.apps.console.vaultMasterKeyFile || root + '/console-vault-master-key'
    const key = normalizeKey(readFileSync(keyPath, 'utf8'))
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(source.secret, 'utf8'), cipher.final()])
    const payload = JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: encrypted.toString('base64url') })
    const secretCode = 'test-document-storage-20260919'
    await db.beginTransaction()
    try {
      const [secret] = await db.query("INSERT INTO vault_secrets(secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,owner_key,storage_backend,reveal_policy,status,created_by) VALUES(?,?,?,'json','integration','integration','oss.default','db_encrypted','never','active','codex-storage-migration')",
        [secretCode, 'hzybase://vault/' + secretCode, 'C000001 测试文档存储'])
      const [version] = await db.query("INSERT INTO vault_secret_versions(secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme,key_fingerprint,status,created_by) VALUES(?,1,?,?,'aes256-gcm',?,'active','codex-storage-migration')",
        [secret.insertId, payload, createHash('sha256').update(source.secret).digest('hex'), createHash('sha256').update(key).digest('hex').slice(0,32)])
      await db.query('UPDATE vault_secrets SET current_version_id=? WHERE id=?', [version.insertId, secret.insertId])
      let integrationId = existing[0]?.id
      if (!integrationId) {
        const [created] = await db.query("INSERT INTO integrations(integration_code,integration_type,integration_name,category,provider_code,base_url,config_json,status,created_by) VALUES('oss.default',?,?,?,?,?,?,'active','codex-storage-migration')",
          [source.integration.integration_type, '测试文档存储', source.integration.category, source.integration.provider_code, source.integration.base_url, JSON.stringify(sourceConfig)])
        integrationId = created.insertId
      } else {
        await db.query("UPDATE integrations SET config_json=?,base_url=?,provider_code=?,status='active' WHERE id=? AND current_credential_id IS NULL",
          [JSON.stringify(sourceConfig),source.integration.base_url,source.integration.provider_code,integrationId])
      }
      const [credential] = await db.query("INSERT INTO integration_credentials(integration_id,credential_name,credential_role,version_no,secret_id,secret_version_id,status) VALUES(?,'primary','primary',1,?,?,'active')", [integrationId,secret.insertId,version.insertId])
      await db.query('UPDATE integrations SET current_credential_id=? WHERE id=?', [credential.insertId,integrationId])
      await db.commit()
      console.log(JSON.stringify({ migrated: true, integrationId, credentialId: credential.insertId, sourceReadOnly: true, testVaultReencrypted: true }))
    } catch (error) { await db.rollback(); throw error }
  } finally { await db.end() }
}
main().catch(error => { console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'STORAGE_MIGRATION_FAILED'); process.exitCode = 1 })
