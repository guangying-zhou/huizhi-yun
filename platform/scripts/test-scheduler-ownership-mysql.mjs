import assert from 'node:assert/strict'
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
 try{
  await pool.query("CREATE TABLE tenants(tenant_code VARCHAR(64) PRIMARY KEY); INSERT INTO tenants VALUES('T1'); CREATE TABLE tenant_runtime_instances(tenant_code VARCHAR(64),environment VARCHAR(32),runtime_code VARCHAR(128),status VARCHAR(32)); INSERT INTO tenant_runtime_instances VALUES('T1','test','runtime-1','ready'); CREATE TABLE deployments(tenant_code VARCHAR(64),environment VARCHAR(32),app_code VARCHAR(32),deployment_code VARCHAR(128),status VARCHAR(32)); INSERT INTO deployments VALUES('T1','test','aims','worker-1','active')")
  await pool.query(readFileSync(resolve(rootDir,'platform/docs/sql/migrations/20260913-tenant-scheduler-ownership.sql'),'utf8'))
  const {registerSchedulerOwnership,schedulerOwnershipSelection}=await import('../server/utils/tenantSchedulerOwnership.ts')
  const transaction=async fn=>{const db=await pool.getConnection();try{await db.beginTransaction();const result=await fn({queryRow:async(sql,args)=>(await db.query(sql,args))[0][0]||null,queryRows:async(sql,args)=>(await db.query(sql,args))[0],execute:async(sql,args)=>(await db.query(sql,args))[0]});await db.commit();return result}catch(error){await db.rollback();throw error}finally{db.release()}}
  const input={storage:'unified',tenantCode:'T1',environment:'test',runtimeCode:'runtime-1',workerDeployment:'worker-1',workerClient:'aims.runtime',generation:'7',expectedRevision:0,requestId:'first',verificationReference:'fixture signed report reviewed by operator',verificationSha256:'a'.repeat(64),verificationMethod:'operator-attested',actorUid:'operator'}
  for (const generation of ['0','07','18446744073709551616',7]) await assert.rejects(()=>registerSchedulerOwnership({...input,generation},false,transaction),/generation_invalid/)
  await assert.rejects(()=>registerSchedulerOwnership({...input,workerDeployment:'other'},true,transaction),/binding_conflict/)
  assert.equal((await registerSchedulerOwnership(input,false,transaction)).applied,false)
  assert.equal((await pool.query('SELECT * FROM tenant_scheduler_ownership'))[0].length,0)
  assert.equal((await registerSchedulerOwnership(input,true,transaction)).revision,1)
  assert.equal((await registerSchedulerOwnership(input,true,transaction)).replayed,true)
  await assert.rejects(()=>registerSchedulerOwnership({...input,generation:'8',requestId:'stale-cas'},true,transaction),/revision_conflict/)
  await assert.rejects(()=>registerSchedulerOwnership({...input,generation:'8'},true,transaction),/replay_conflict/)
  const row=()=>pool.query('SELECT *,CAST(generation AS CHAR) AS generation FROM tenant_scheduler_ownership').then(([rows])=>rows[0])
  assert.deepEqual(schedulerOwnershipSelection(await row(),{runtime_code:'runtime-1',status:'ready'},'worker-1'),{storage:'unified',generation:'7'})
  assert.deepEqual(schedulerOwnershipSelection(await row(),{runtime_code:'different',status:'ready'},'worker-1'),{storage:'disabled',generation:'7'})
  assert.equal(schedulerOwnershipSelection(null,null,undefined),null)
  await registerSchedulerOwnership({...input,storage:'disabled',expectedRevision:1,requestId:'disable'},true,transaction)
  assert.equal(schedulerOwnershipSelection(await row(),{runtime_code:'runtime-1',status:'ready'},'worker-1').storage,'disabled')
  await assert.rejects(()=>registerSchedulerOwnership({...input,expectedRevision:2,requestId:'no-renew-generation'},true,transaction),/generation_must_increase/)
  await pool.query("CREATE TRIGGER receipt_failure BEFORE INSERT ON tenant_scheduler_ownership_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture audit unavailable'")
  await assert.rejects(()=>registerSchedulerOwnership({...input,generation:'8',expectedRevision:2,requestId:'rollback'},true,transaction))
  assert.equal((await row()).storage_mode,'disabled');assert.equal(Number((await row()).revision),2)
  console.log('Scheduler ownership real MySQL: dry-run, exact binding, audit replay/CAS, disabled drift, monotonic generation and audit rollback passed')
 }finally{directoryHook.deregister();hooks.deregister();await pool.end()}
},{execute:true,confirm:plan.confirmationSha256})
