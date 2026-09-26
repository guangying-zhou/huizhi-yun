// Read-only collector; source/provider schemas come only from the protected local Runtime config.
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import mysql from '../../../platform/node_modules/mysql2/promise.js'
import { collectProviderReceipts } from './provider-receipts.mjs'
import { observeTestConsumers } from './consumer-observations.mjs'
const [planPath, outputPath] = process.argv.slice(2)
if (!planPath || !outputPath) throw Error('Usage: provider-receipts-cli.mjs reviewed-plan.json report.json')
let connection
try {
  const cfg=JSON.parse(await readFile(resolve(homedir(),'Library/Application Support/HuizhiYun/test-runtime/config.json'),'utf8'))
  const plan=JSON.parse(await readFile(planPath,'utf8'))
  const source=cfg.apps.aims.db
  if(cfg.tenant!=='C000001'||plan.Config.Tenant!==cfg.tenant||!['localhost','127.0.0.1'].includes(source.host)||plan.Config.SourceAims!==source.database||plan.Config.SourceAssets!==cfg.apps.assets.db.database)throw Error('Reviewed local identity mismatch')
  const bindings=[], unconfiguredProviders=[]
  for(const app of ['aims','assets','finance','altoc','codocs','people','console']) {
    const database=cfg.apps[app]?.db
    if(!database||database.host!==source.host||database.port!==source.port||!cfg.deploymentBindings[app]) { if(['aims','assets'].includes(app)) throw Error('Source binding missing'); unconfiguredProviders.push(app); continue }
    bindings.push({app,schema:database.database,deployment:cfg.deploymentBindings[app]})
  }
  const observations=await observeTestConsumers(cfg)
  connection=await mysql.createConnection({host:source.host,port:source.port,user:source.user,password:source.password,timezone:'Z',dateStrings:true,supportBigNumbers:true,bigNumberStrings:true})
  await connection.query('SET TRANSACTION READ ONLY');await connection.beginTransaction()
  const report=await collectProviderReceipts(connection,{tenant:cfg.tenant,environment:'test',runtimeDeployment:cfg.deployment,instanceId:plan.Config.InstanceID,observations,unconfiguredProviders,sources:bindings.filter(value=>['aims','assets'].includes(value.app)),providers:bindings.filter(value=>!['aims','assets'].includes(value.app)).concat(bindings.filter(value=>['aims','assets'].includes(value.app)))})
  await connection.rollback()
  await writeFile(outputPath,JSON.stringify(report,null,2)+'\n',{mode:0o600})
  console.log(JSON.stringify({readOnly:true,ready:false,automatic:report.automaticCount,manual:report.manualCount,blocked:report.blockedCount}))
} catch(error) { console.error(`Receipt collection unavailable: ${String(error.code||'identity-or-schema-check-failed')}`);process.exitCode=1 } finally {await connection?.end()}
