// Uses only the local test Console. Never logs credentials or signed URLs.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createDecipheriv, createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import mysql from 'mysql2/promise'
const require = createRequire(new URL('../../aims/package.json', import.meta.url))
const OSS = require('ali-oss')
const root = '/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime'
try {
  const runtime = JSON.parse(readFileSync(root + '/config.json', 'utf8'))
  const config = runtime.apps.console.db
  if (runtime.tenant !== 'C000001' || config.database !== 'hzy_console_test_local_20260910') throw Error('TARGET_MISMATCH')
  const db = await mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database })
  let row
  try {
    const [rows] = await db.query("SELECT i.config_json,v.ciphertext_blob FROM integrations i JOIN integration_credentials c ON c.id=i.current_credential_id JOIN vault_secrets s ON s.id=c.secret_id JOIN vault_secret_versions v ON v.id=COALESCE(c.secret_version_id,s.current_version_id) WHERE i.integration_code='oss.default' AND i.status='active' AND c.status='active' AND s.status='active' AND v.status='active'")
    if (rows.length !== 1) throw Error('STORAGE_UNAVAILABLE')
    row = rows[0]
  } finally { await db.end() }
  const keyPath = execFileSync('plutil', ['-extract', 'EnvironmentVariables.HZY_CONSOLE_VAULT_MASTER_KEY_FILE', 'raw', '/Users/gavinzhou/Library/LaunchAgents/cn.wiztek.hzy-test-runtime.plist'], { encoding: 'utf8' }).trim()
  const raw = readFileSync(keyPath, 'utf8').trim()
  const base64 = Buffer.from(raw, 'base64'), hex = Buffer.from(raw, 'hex')
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(raw) && base64.length >= 32 ? base64.subarray(0, 32)
    : /^[0-9a-f]+$/i.test(raw) && hex.length >= 32 ? hex.subarray(0, 32) : createHash('sha256').update(raw).digest()
  const blob = JSON.parse(row.ciphertext_blob.toString())
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64url'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64url')), decipher.final()]).toString('utf8')
  let secret
  try { secret = JSON.parse(plaintext) } catch { secret = { accessKeySecret: plaintext } }
  const storage = typeof row.config_json === 'string' ? JSON.parse(row.config_json) : row.config_json
  const client = new OSS({ endpoint: storage.projectsEndpoint || storage.endpoint, bucket: storage.projectsBucketName || storage.bucketName,
    region: storage.region, accessKeyId: secret.accessKeyId || storage.accessKeyId, accessKeySecret: secret.accessKeySecret, secure: true, timeout: 15000 })
  const path = `codocs/test/C000001/document-chain-probe/${randomUUID()}.md`
  const content = Buffer.from('# Document chain isolated storage probe\n')
  let uploaded = false
  try {
    await client.put(path, content, { headers: { 'x-oss-forbid-overwrite': 'true' } })
    uploaded = true
    const read = await client.get(path)
    if (!Buffer.from(read.content).equals(content)) throw Error('CONTENT_MISMATCH')
    console.log(JSON.stringify({ projectStoragePutGet: true, isolatedTestPrefix: true }))
  } finally {
    if (uploaded) {
      await client.delete(path)
      console.log(JSON.stringify({ ownProbeRemoved: true, existingDocumentsTouched: false }))
    }
  }
} catch (error) {
  console.error(JSON.stringify({ storageProbeFailed: true, code: /^[A-Za-z_]+$/.test(error.code || error.message) ? error.code || error.message : 'STORAGE_PROBE_FAILED' }))
  process.exitCode = 1
}
