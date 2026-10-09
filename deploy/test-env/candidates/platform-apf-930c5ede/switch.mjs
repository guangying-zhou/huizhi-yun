// Execute only after database backup/restore rehearsal and provenance migration.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const run = args => execFileSync('pm2', args, {encoding:'utf8',stdio:['ignore','pipe','pipe']})
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const save = (file,data) => fs.writeFileSync(file,JSON.stringify(data,null,2),{mode:0o600,flag:'wx'})
const attempt = process.env.ATTEMPT
const source = process.env.SOURCE
const name = 'hzy-platform-dev'
const list = () => JSON.parse(run(['jlist']))
const health = async () => {for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:3011/api/health',{signal:AbortSignal.timeout(3000),redirect:'error'});await r.body?.cancel();if(r.status===200)return true}catch{}await new Promise(r=>setTimeout(r,1000))}return false}
try {
 if(process.env.APF_RELEASE_APPROVAL!=='platform-930c5ede-C000001-test'||execFileSync('hostname',{encoding:'utf8'}).trim()!=='iZcqwiqyhp9u8rZ')throw Error('guard')
 if(!attempt||!source||(fs.statSync(attempt).mode&0o777)!==0o700||!fs.existsSync(path.join(attempt,'migrated')))throw Error('guard')
 const entry=path.join(source,'platform/.output/server/index.mjs')
 const all=list(),live=all.find(p=>p.name===name)
 // The maintenance fence stopped this exact process after its approved snapshot was taken.
 const before=JSON.parse(fs.readFileSync(path.join(attempt,'pm2-before.json')))
 const old=before.find(p=>p.name===name)
 if(!old?.pid||!live||live.pm2_env.status!=='stopped'||old.pm2_env.exec_mode!=='fork_mode'||old.pm2_env.watch!==false)throw Error('binding')
 const oldConfig=JSON.parse(fs.readFileSync(path.join(attempt,'rollback.config.json')))
 const app=oldConfig.apps[0]
 if(app.name!==name||app.env.DB_NAME!=='hzy_platform_dev'||String(app.env.PORT)!=='3011'||app.cwd!==old.pm2_env.pm_cwd||app.script!==old.pm2_env.pm_exec_path)throw Error('binding')
 const manifest=JSON.parse(fs.readFileSync(process.env.CANDIDATE_ARTIFACT_MANIFEST))
 if(manifest.commit!=='930c5ede7083664353acf871b3e8ef4173c45afd')throw Error('artifact commit')
 const output=path.join(source,'platform/.output')
 const files=fs.readdirSync(output,{recursive:true,withFileTypes:true}).filter(f=>f.isFile()).map(f=>path.relative(output,path.join(f.parentPath,f.name))).sort()
 if(JSON.stringify(files)!==JSON.stringify(Object.keys(manifest.files).sort()))throw Error('artifact tree')
 for(const file of files)if(sha(path.join(output,file))!==manifest.files[file])throw Error('artifact hash')
 const others=all.filter(p=>p.name!==name).map(p=>[p.name,p.pid,p.pm2_env.status])
 save(path.join(attempt,'candidate.config.json'),{apps:[{...app,cwd:path.join(source,'platform'),script:entry,watch:false}]})
 try {
  run(['delete',name]);run(['start',path.join(attempt,'candidate.config.json'),'--only',name])
  if(!await health())throw Error('health')
  if(JSON.stringify(others)!==JSON.stringify(list().filter(p=>p.name!==name).map(p=>[p.name,p.pid,p.pm2_env.status])))throw Error('isolation')
  save(path.join(attempt,'switch-receipt.json'),{entry,sha256:sha(entry),othersUnchanged:true,persisted:false})
  console.log('switch: PASS (PM2 not persisted)')
 }catch{
  try{run(['delete',name])}catch{}
  run(['start',path.join(attempt,'rollback.config.json'),'--only',name])
  if(!await health())throw Error('rollback health')
  throw Error('switch failed; previous process restored')
 }
}catch{console.error('switch stopped; inspect private attempt and verify previous process before continuing');process.exitCode=1}
