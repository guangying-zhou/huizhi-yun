import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from './test/support/temporary-mysql-harness.mjs'
const rootDir=resolve(import.meta.dirname,'..')
const plan=await buildTemporaryMySqlPlan({rootDir})
await withTemporaryMySql(plan,async(context)=>{
  assert.match(context.socketPath,/^\/tmp\/hzy-test-mysql-/)
  const code=await new Promise((resolveCode,reject)=>{
    const child=spawn('go',['test','./internal/apps/console','-run','^TestGatewayExchangeMySQL$','-count=1','-v'],{cwd:resolve(rootDir,'data-runtime'),env:{PATH:process.env.PATH,HOME:process.env.HOME,GOCACHE:process.env.GOCACHE,HZY_GATEWAY_EXCHANGE_TEST_SOCKET:context.socketPath},stdio:'inherit'})
    child.on('error',reject);child.on('close',resolveCode)
  })
  assert.equal(code,0)
},{execute:true,confirm:plan.confirmationSha256,temporaryParent:'/tmp'})
