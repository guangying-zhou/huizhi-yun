// Downloads the exact active Worker version; no rebuild, upload or deployment.
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve,dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { drainArtifactHash } from './build-config.mjs'
const output=process.argv[2]
if(!output)throw Error('Explicit new output directory required')
const root=resolve(output)
await mkdir(dirname(root),{recursive:true,mode:0o700})
await mkdir(root,{mode:0o700})
const config=await readFile(resolve(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8')
const token=config.match(/^oauth_token\s*=\s*"([^"\r\n]+)"/m)?.[1]
if(!token)throw Error('Existing Wrangler login required')
async function request(path){const response=await fetch(`https://api.cloudflare.com/client/v4${path}`,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`Read-only Cloudflare export HTTP ${response.status}`);return response}
async function api(path){const body=await(await request(path)).json();if(!body.success)throw Error('Cloudflare read unavailable');return body.result}
const accounts=await api('/accounts?per_page=50')
if(accounts.length!==1)throw Error('Exact existing account required')
const account=accounts[0].id
const boundary=await readFile(new URL('./worker-boundary.mjs',import.meta.url),'utf8')
const manifest={schemaVersion:'test-drain-wrappers.v1',observedAt:new Date().toISOString(),tenant:'C000001',environment:'test',deployed:false,apps:[]}
for(const app of ['aims','assets']) {
 const base=`/accounts/${account}/workers/scripts/hzy-test-${app}`
 const current=await api(`${base}/deployments`)
 const deployment=[...current.deployments].sort((a,b)=>String(b.created_on).localeCompare(String(a.created_on)))[0]
 if(!deployment||deployment.versions.length!==1||deployment.versions[0].percentage!==100)throw Error('Single active Worker version required')
 const versionId=deployment.versions[0].version_id
 const version=await api(`${base}/versions/${versionId}`)
 const details=version.resources
 if(!details.bindings.some(binding=>binding.name==='HZY_PLATFORM_TENANT_CODE'&&binding.text==='C000001')||!details.bindings.some(binding=>binding.name==='HZY_PLATFORM_ENVIRONMENT'&&binding.text==='test')||!details.bindings.some(binding=>binding.name==='HZY_TENANT_GATEWAY_INTERNAL_TOKEN'&&binding.type==='secret_text'))throw Error('Actual source tenant/control binding mismatch')
 const content=await request(`${base}/content/v2?version=${versionId}`)
 const entry=content.headers.get('cf-entrypoint')
 if(!entry||!content.headers.get('content-type')?.startsWith('multipart/form-data'))throw Error('Version-specific module export required')
 const parts=await content.formData()
 const directory=resolve(root,app),original=resolve(directory,'original')
 await mkdir(original,{recursive:true,mode:0o700})
 const modules=[],rules=[]
 const types={'application/javascript+module':'ESModule','application/javascript':'CommonJS','application/wasm':'CompiledWasm','text/plain':'Text','application/octet-stream':'Data','application/json':'Data','application/source-map':'Data'}
 for(const [name,file]of parts.entries()){
  if(typeof file==='string'||name.startsWith('/')||name.split('/').some(part=>part==='..')||!types[file.type])throw Error('Unsupported exported module')
  const path=resolve(original,name);await mkdir(dirname(path),{recursive:true,mode:0o700})
  const bytes=Buffer.from(await file.arrayBuffer());await writeFile(path,bytes,{mode:0o600})
  modules.push({name,type:file.type,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
  rules.push({type:types[file.type],globs:[`original/${name}`],fallthrough:true})
 }
 if(!modules.some(module=>module.name===entry))throw Error('Exported entrypoint missing')
 const actor={app,deployment:`C000001-test-${app}`,artifactSha256:await drainArtifactHash(original,boundary)}
 await writeFile(resolve(directory,'worker-boundary.mjs'),boundary,{mode:0o600})
 await writeFile(resolve(directory,'drain-entry.mjs'),`import worker from ${JSON.stringify('./original/'+entry)}\nexport * from ${JSON.stringify('./original/'+entry)}\nimport { withTestDrainBoundary } from './worker-boundary.mjs'\nexport default withTestDrainBoundary(worker,${JSON.stringify(actor)})\n`,{mode:0o600})
 const wrangler={name:`hzy-test-${app}`,main:'./drain-entry.mjs',workers_dev:false,no_bundle:true,find_additional_modules:true,compatibility_date:details.script_runtime.compatibility_date,compatibility_flags:details.script_runtime.compatibility_flags,rules:[{type:'ESModule',globs:['drain-entry.mjs','worker-boundary.mjs'],fallthrough:true},...rules],services:[{binding:'HZY_DRAIN_COORDINATOR',service:'hzy-test-drain-coordinator'}],unsafe:{bindings:details.bindings.filter(binding=>!['secret_text','secret_key'].includes(binding.type)&&binding.name!=='HZY_DRAIN_COORDINATOR').map(binding=>({name:binding.name,type:'inherit'})),metadata:{keep_assets:true,keep_bindings:['secret_text','secret_key']}}}
 await writeFile(resolve(directory,'wrangler.json'),JSON.stringify(wrangler,null,2)+'\n',{mode:0o600})
 await writeFile(resolve(directory,'actor.json'),JSON.stringify(actor,null,2)+'\n',{mode:0o600})
 const after=await api(`${base}/deployments`)
 if(JSON.stringify(after.deployments)!==JSON.stringify(current.deployments))throw Error('Source deployment changed during export')
 manifest.apps.push({app,originalVersionId:versionId,originalDeploymentId:deployment.id,actor,modules,config:resolve(directory,'wrangler.json')})
}
await writeFile(resolve(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600})
await writeFile(resolve(root,'register.json'),JSON.stringify({tenant:'C000001',environment:'test',requestId:`drain-register-${Date.now()}`,actors:manifest.apps.map(app=>app.actor)},null,2)+'\n',{mode:0o600})
await writeFile(resolve(root,'open.json'),JSON.stringify({tenant:'C000001',environment:'test',requestId:`drain-open-${Date.now()}`,expectedRevision:1},null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({prepared:true,deployed:false,directory:root,apps:manifest.apps.map(({app,originalVersionId,actor})=>({app,originalVersionId,actor}))}))
