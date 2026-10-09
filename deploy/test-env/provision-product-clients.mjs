// Explicitly authorized C000001 test provisioning. Never print credential material.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'

try {
  const run = (cmd, args, input) => execFileSync(cmd, args, { input, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
  if (process.argv[2] !== '--execute' || run('hostname', []) !== 'iZcqwiqyhp9u8rZ') throw Error('Invocation')
  const config = JSON.parse(fs.readFileSync('/wiztek/hzy-test/runtime/config.json'))
  if (config.tenant !== 'C000001' || config.apps.console.db.database !== 'hzy_console_test_20260905'
    || config.deployment !== 'c000001-test-tenant-runtime' || config.auth.mode !== 'jwt') throw Error('Test binding')
  const apps = ['aims', 'assets', 'finance', 'codocs', 'altoc']
  const sql = input => run('docker', ['exec', '-i', 'hzy-test-mysql', 'sh', '-c',
    'MYSQL_PWD="$(cat /run/secrets/mysql-root)" exec mysql -uroot --batch --skip-column-names hzy_console_test_20260905'], input)
  const file = '/wiztek/hzy-test/secrets/product-runtime-clients.json'
  if (fs.existsSync(file)) throw Error('Provisioning receipt exists; inspect before retrying')
  for (const app of apps) {
    if (sql(`SELECT COUNT(*) FROM service_clients WHERE client_code='${app}.runtime';`) !== '0') throw Error('Existing client requires verification')
  }
  const secrets = Object.fromEntries(apps.map(app => [app, randomBytes(32).toString('hex')]))
  fs.writeFileSync(file, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' })
  const statements = apps.map(app => {
    const hash = createHash('sha256').update(secrets[app]).digest('hex')
    return `INSERT INTO vault_secrets(secret_code,secret_ref,secret_name,secret_type,usage_type,storage_backend,reveal_policy)
      VALUES('test.product.${app}.runtime','hzybase://vault/test.product.${app}.runtime','Test ${app} runtime credential','client_secret','service','db_encrypted','deny');
      SET @sid=LAST_INSERT_ID();
      INSERT INTO vault_secret_versions(secret_id,version_no,ciphertext_blob,content_hash,encryption_scheme)
      VALUES(@sid,1,0x00,'sha256_${hash}','sha256-only');
      UPDATE vault_secrets SET current_version_id=LAST_INSERT_ID() WHERE id=@sid;
      INSERT INTO service_clients(client_code,client_name,client_type,app_code) VALUES('${app}.runtime','C000001 test ${app} runtime','app','${app}');
      SET @scid=LAST_INSERT_ID();
      INSERT INTO service_client_credentials(service_client_id,client_id,version_no,secret_id) VALUES(@scid,'${app}.runtime',1,@sid);
      UPDATE service_clients SET current_credential_id=LAST_INSERT_ID() WHERE id=@scid;
      INSERT INTO service_client_grants(service_client_id,resource_code,action,scope_json)
      VALUES ${['data-runtime', 'tenant-runtime'].flatMap(aud => ['read', 'write'].map(action =>
        `(@scid,'${aud}:${app}','${action}',JSON_OBJECT('audience','${aud}','tenantCode','C000001','deploymentCode','C000001-test-${app}','source','test-product-runtime-provision'))`)).join(',')};`
  })
  sql(`START TRANSACTION;${statements.join('\n')}COMMIT;`)
  console.log('Five isolated test runtime clients created; credentials retained only in the protected server secret file.')
} catch {
  console.error('Test client provisioning stopped; inspect protected state before retrying. Secret diagnostics suppressed.')
  process.exitCode = 1
}
