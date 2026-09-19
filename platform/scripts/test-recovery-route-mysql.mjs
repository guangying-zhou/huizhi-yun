import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { createServer } from 'node:http'
import { createApp, toNodeListener } from 'h3'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { registerEnterpriseNuxtTestHost } from './support/enterprise-nuxt-test-host.mjs'
const rootDir=resolve(import.meta.dirname,'../..')
const plan=await buildTemporaryMySqlPlan({rootDir})
await withTemporaryMySql(plan,async context=>{
 const pool=mysql.createPool({...context.connection('console'),multipleStatements:true})
 const hooks=registerEnterpriseNuxtTestHost(rootDir)
 const directoryHook=registerHooks({resolve(specifier,context,nextResolve){const result=nextResolve(specifier,context);if(result.url.startsWith('file:')){const path=fileURLToPath(result.url);if(statSync(path).isDirectory()){const entry=['index.ts','index.js'].map(name=>resolve(path,name)).find(existsSync);if(entry)return {...result,url:pathToFileURL(entry).href}}}return result}})
 let httpServer, signingDb
 const previousConfig=globalThis.useRuntimeConfig
 const key=generateKeyPairSync('ed25519')
 const oldKey=process.env.RECOVERY_ROUTE_FIXTURE_KEY
 process.env.RECOVERY_ROUTE_FIXTURE_KEY=key.privateKey.export({type:'pkcs8',format:'pem'})
 globalThis.useRuntimeConfig=()=>({db:{...context.connection('console'),name:context.connection('console').database}})
 try{
  await pool.query("CREATE TABLE tenants(tenant_code VARCHAR(64) PRIMARY KEY); INSERT INTO tenants VALUES('T1'); CREATE TABLE tenant_runtime_instances(id INT,tenant_code VARCHAR(64),environment VARCHAR(32),runtime_code VARCHAR(128),status VARCHAR(32),runtime_endpoint VARCHAR(255),control_token_hash CHAR(64)); INSERT INTO tenant_runtime_instances VALUES(1,'T1','test','runtime-1','ready','https://fixture.invalid',SHA2('temporary-control-token',256)); CREATE TABLE deployments(tenant_code VARCHAR(64),environment VARCHAR(32),app_code VARCHAR(32),deployment_code VARCHAR(128),status VARCHAR(32),api_base VARCHAR(255),runtime_endpoint VARCHAR(255),base_path VARCHAR(32)); INSERT INTO deployments VALUES('T1','test','aims','worker-1','active','https://fixture.invalid/aims',NULL,'/aims'),('T1','test','assets','assets-1','active','https://fixture.invalid/assets',NULL,'/assets')")
  for (const name of ['20260913-tenant-scheduler-ownership.sql','20260913-enterprise-recovery-route.sql']) await pool.query(readFileSync(resolve(rootDir,'platform/docs/sql/migrations',name),'utf8'))
  await pool.query("INSERT INTO tenant_scheduler_ownership VALUES('T1','test','aims','disabled','runtime-1','worker-1','aims.runtime',7,2,'fixture',REPEAT('a',64),'operator','disabled',UTC_TIMESTAMP(6))")
  await pool.query("CREATE TABLE platform_signing_keys(id BIGINT PRIMARY KEY,kid VARCHAR(128),alg VARCHAR(32),public_key TEXT,private_key_ref VARCHAR(255),status VARCHAR(32),activated_at DATETIME,rotated_at DATETIME NULL,revoked_at DATETIME NULL)")
  await pool.execute("INSERT INTO platform_signing_keys VALUES(1,'recovery-fixture','Ed25519',?,'env:RECOVERY_ROUTE_FIXTURE_KEY','active',UTC_TIMESTAMP(),NULL,NULL)",[key.publicKey.export({type:'spki',format:'pem'})])
  const {sign}=await import('../server/utils/platformSigning.ts')
  const {useDbPool}=await import('../server/utils/db.ts');signingDb=useDbPool()
  const {prepareRecoveryRoute,publishRecoveryRoute,signedRecoveryRoutePreparation}=await import('../server/utils/enterpriseRecoveryRoute.ts')
  const transaction=async fn=>{const db=await pool.getConnection();try{await db.beginTransaction();const result=await fn({queryRow:async(sql,args)=>(await db.query(sql,args))[0][0]||null,queryRows:async(sql,args)=>(await db.query(sql,args))[0],execute:async(sql,args)=>(await db.query(sql,args))[0]});await db.commit();return result}catch(error){await db.rollback();throw error}finally{db.release()}}
  const input={tenantCode:'T1',environment:'test',recoveryKey:'recovery-1',recoveryReviewHash:'a'.repeat(64),runtimeCode:'runtime-1',workerDeployment:'worker-1',workerClient:'aims.runtime',generation:'8',aimsSchema:'recovery_aims',assetsSchema:'recovery_assets',instanceId:'fixture-instance',databaseUser:'fixture-owner',databaseHost:'localhost',expectedRevision:0,requestId:'prepare-1',actorUid:'operator'}
  assert.equal((await prepareRecoveryRoute(input,false,transaction)).applied,false)
  assert.equal((await pool.query('SELECT * FROM enterprise_recovery_routes'))[0].length,0)
  const prepared=await prepareRecoveryRoute(input,true,transaction)
  assert.equal((await prepareRecoveryRoute(input,true,transaction)).replayed,true)
  const activation={tenantCode:'T1',environment:'test',recoveryKey:'recovery-1',preparationSha256:prepared.payloadSha256,activationSha256:'b'.repeat(64),runtimeCode:'runtime-1',generation:'8'}
  await assert.rejects(()=>publishRecoveryRoute(activation,'wrong-token',transaction),/authentication_failed/)
  await pool.query("UPDATE deployments SET base_path='/drift' WHERE app_code='aims'")
  await assert.rejects(()=>publishRecoveryRoute(activation,'temporary-control-token',transaction),/route_drift/)
  await pool.query("UPDATE deployments SET base_path='/aims' WHERE app_code='aims'")
  await pool.query("CREATE TRIGGER recovery_publish_audit_failure BEFORE INSERT ON enterprise_recovery_route_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture audit failure'")
  await assert.rejects(()=>publishRecoveryRoute(activation,'temporary-control-token',transaction))
  assert.equal((await pool.query('SELECT storage_mode FROM tenant_scheduler_ownership'))[0][0].storage_mode,'disabled')
  assert.equal((await pool.query('SELECT state FROM enterprise_recovery_routes'))[0][0].state,'prepared')
  await pool.query('DROP TRIGGER recovery_publish_audit_failure')
  const signedPreparation=await signedRecoveryRoutePreparation(input,true)
  const preparationBytes=signedPreparation.signed.payload
  const signed=signedPreparation.signed
  assert.equal(verify(null,Buffer.from(preparationBytes),key.publicKey,Buffer.from(signed.signature,'base64url')),true)
  const handler=(await import('../server/api/v1/runtime/recovery-route.post.ts')).default
  httpServer=createServer(toNodeListener(createApp().use('/api/v1/runtime/recovery-route',handler)))
  await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve))
  const endpoint=`http://127.0.0.1:${httpServer.address().port}/api/v1/runtime/recovery-route`
  const send=token=>fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(activation)})
  assert.equal((await send('wrong-control')).status,401)
  const response=await send('temporary-control-token');assert.equal(response.status,200);assert.equal((await response.json()).data.published,true)
  assert.equal((await publishRecoveryRoute(activation,'temporary-control-token',transaction)).replayed,true)
  await assert.rejects(()=>publishRecoveryRoute({...activation,activationSha256:'c'.repeat(64)},'temporary-control-token',transaction),/activation_conflict/)
  assert.equal((await pool.query('SELECT storage_mode FROM tenant_scheduler_ownership'))[0][0].storage_mode,'recovered')
  await pool.query("UPDATE deployments SET runtime_endpoint='https://drift.invalid' WHERE app_code='assets'")
  await assert.rejects(()=>publishRecoveryRoute(activation,'temporary-control-token',transaction),/published_route_drift/)
  console.log('Recovery route real MySQL dry-run, immutable preparation, exact runtime authentication, drift CAS, atomic publication and replay passed')
 }finally{if(httpServer)await new Promise(resolve=>httpServer.close(resolve));if(signingDb)await signingDb.end();globalThis.useRuntimeConfig=previousConfig;if(oldKey===undefined)delete process.env.RECOVERY_ROUTE_FIXTURE_KEY;else process.env.RECOVERY_ROUTE_FIXTURE_KEY=oldKey;directoryHook.deregister();hooks.deregister();await pool.end()}
},{execute:true,confirm:plan.confirmationSha256})
