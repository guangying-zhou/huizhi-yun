// Only the disposable /tmp MySQL harness; never loads an environment config.
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from './test/support/temporary-mysql-harness.mjs'
import { mutateGatewayKey, exportGatewayWorkerIdentity, parseGatewayKeyCommand, signedGatewayKeyset, GATEWAY_KEYSET_SCHEMA } from '../platform/server/utils/gatewayServiceKeys.ts'

const rootDir = resolve(import.meta.dirname, '..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  assert.match(context.socketPath, /^\/tmp\/hzy-test-mysql-/)
  const db = await mysql.createConnection({ socketPath: context.socketPath, user: 'root', multipleStatements: true })
  try {
    await db.query('CREATE DATABASE gateway_keyset_fixture; USE gateway_keyset_fixture')
    await db.query(`CREATE TABLE deployment_sites (id BIGINT UNSIGNED PRIMARY KEY, site_code VARCHAR(128) NOT NULL UNIQUE, tenant_code VARCHAR(64) NOT NULL, environment VARCHAR(32) NOT NULL, status VARCHAR(32) NOT NULL,public_url VARCHAR(512) NOT NULL) ENGINE=InnoDB;
      INSERT INTO deployment_sites VALUES (1,'test-gateway','T-TEST','test','active','https://tenant.test');
      CREATE TABLE tenant_runtime_instances(runtime_code VARCHAR(128), tenant_code VARCHAR(64), environment VARCHAR(32), status VARCHAR(32), control_token_hash VARCHAR(128));
      CREATE TABLE platform_audit_logs(operator_account_id BIGINT, target_type VARCHAR(64),target_id VARCHAR(128),target_tenant_code VARCHAR(64),action VARCHAR(128),before_json JSON,after_json JSON,source VARCHAR(32),ip VARCHAR(64),user_agent TEXT,created_at DATETIME) ENGINE=InnoDB`)
    await db.query('INSERT INTO tenant_runtime_instances VALUES(?,?,?,?,?)', ['test-runtime','T-TEST','test','ready',createHash('sha256').update('hzy_ctl_fixture').digest('hex')])
    await db.query(await readFile(resolve(rootDir,'platform/docs/sql/migrations/20260926-gateway-service-keys.sql'),'utf8'))
    let failAudit = false
    const tx = {
      queryRow: async (sql, p) => (await db.query(sql, p))[0][0] ?? null,
      queryRows: async (sql, p) => (await db.query(sql, p))[0],
      execute: async (sql, p) => { if(failAudit && sql.includes('platform_audit_logs')) throw new Error('fixture audit failure'); return (await db.execute(sql, p))[0] }
    }
    const transaction = async (fn) => {await db.beginTransaction();try{const result = await fn(tx);await db.commit();return result}catch(e){await db.rollback();throw e}}
    const staff = {uid:'fixture-staff',accountId:1}
    const cmd = (n,rev) => parseGatewayKeyCommand({action:'register',expectedRevision:rev,publicKey:Buffer.alloc(32,n).toString('base64url'),notBefore:1000,notAfter:5000},1000)
    const mutate = (command) => transaction(t => mutateGatewayKey(t,'test-gateway',command,staff,1000))
    failAudit = true
    await assert.rejects(mutate(cmd(1,0)),/fixture audit failure/)
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM platform_gateway_keysets'))[0][0].n,0)
    failAudit = false
    const first = await mutate(cmd(1,0))
    assert.equal((await transaction(t => exportGatewayWorkerIdentity(t,'test-gateway','tenant.test'))).deploymentCode,'test-gateway')
    await assert.rejects(transaction(t => exportGatewayWorkerIdentity(t,'test-gateway','other.test')), /host_mismatch/)
    await db.query("UPDATE deployment_sites SET status='inactive' WHERE id=1")
    await assert.rejects(mutate(cmd(2,1)), /unavailable/)
    await db.query("UPDATE deployment_sites SET status='active' WHERE id=1")
    assert.equal(first.revision,1)
    await mutate({action:'activate',kid:first.kid,expectedRevision:1})
    await mutate(cmd(2,2))
    await assert.rejects(mutate(cmd(3,3)),/slots_full/)
    await assert.rejects(mutate(cmd(3,1)),/revision_conflict/)
    await mutate({action:'revoke',kid:first.kid,expectedRevision:3})
    await assert.rejects(mutate(cmd(1,4)),/key_revoked/)
    await mutate(cmd(3,4))
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM platform_audit_logs'))[0][0].n,5)
    const {privateKey,publicKey}=generateKeyPairSync('ed25519')
    const signer=async data=>({kid:'fixture-root',alg:'Ed25519',signature:sign(null,Buffer.from(data),privateKey).toString('base64url')})
    const envelope=await transaction(t=>signedGatewayKeyset(t,'test-runtime','test-gateway','hzy_ctl_fixture',1000,signer))
    assert.ok(verify(null,Buffer.from(`${GATEWAY_KEYSET_SCHEMA}\n${envelope.body}`),publicKey,Buffer.from(envelope.signature,'base64url')))
    assert.equal(JSON.parse(envelope.body).revision,5)
    const second = await mysql.createConnection({socketPath:context.socketPath,user:'root',database:'gateway_keyset_fixture'})
    try {
      const tx2={queryRow:async(sql,p)=>(await second.query(sql,p))[0][0]??null,queryRows:async(sql,p)=>(await second.query(sql,p))[0],execute:async(sql,p)=>(await second.execute(sql,p))[0]}
      const concurrent=await Promise.allSettled([
        mutate({action:'revoke',kid:createHash('sha256').update(Buffer.alloc(32,2)).digest('hex'),expectedRevision:5}),
        (async()=>{await second.beginTransaction();try{const r=await mutateGatewayKey(tx2,'test-gateway',{action:'revoke',kid:createHash('sha256').update(Buffer.alloc(32,3)).digest('hex'),expectedRevision:5},staff,1000);await second.commit();return r}catch(e){await second.rollback();throw e}})()
      ])
      assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1)
      assert.equal(concurrent.filter(r=>r.status==='rejected' && /revision_conflict/.test(r.reason.message)).length,1)
      assert.equal((await db.query('SELECT revision FROM platform_gateway_keysets'))[0][0].revision,6)
    } finally {await second.end()}
    await db.query("UPDATE deployment_sites SET environment='dev' WHERE id=1")
    await assert.rejects(mutate({action:'revoke',kid:first.kid,expectedRevision:5}),/binding_changed/)
    await assert.rejects(transaction(t=>signedGatewayKeyset(t,'test-runtime','test-gateway','hzy_ctl_fixture',1000,signer)),/binding_changed/)
    console.log('PASS disposable MySQL: atomic audit rollback, slots, revision, revocation, signed keyset and frozen site binding and exact identity host')
  } finally {await db.end()}
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
