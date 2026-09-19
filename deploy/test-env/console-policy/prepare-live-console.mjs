// Read-only exact active version export. No build/upload/deployment or secret export.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
const output = process.argv[2]
if (!output) throw Error('NEW_OUTPUT_DIRECTORY_REQUIRED')
const directory = resolve(output)
await mkdir(dirname(directory), { recursive: true, mode: 0o700 })
await mkdir(directory, { mode: 0o700 })
const config = await readFile(resolve(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8')
const token = config.match(/^oauth_token\s*=\s*"([^"\r\n]+)"/m)?.[1]
if (!token) throw Error('EXISTING_LOGIN_REQUIRED')
async function request(path) {
 const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) })
 if (!response.ok) throw Error(`READ_ONLY_EXPORT_HTTP_${response.status}`)
 return response
}
async function api(path) { const body = await (await request(path)).json(); if (!body.success) throw Error('READ_ONLY_EXPORT_FAILED'); return body.result }
const accounts = await api('/accounts?per_page=50')
if (accounts.length !== 1) throw Error('EXACT_ACCOUNT_REQUIRED')
const account = accounts[0].id, name = 'hzy-test-console', base = `/accounts/${account}/workers/scripts/${name}`
const current = await api(`${base}/deployments`)
const deployment = [...current.deployments].sort((a,b) => String(b.created_on).localeCompare(String(a.created_on)))[0]
if (!deployment || deployment.versions.length !== 1 || deployment.versions[0].percentage !== 100) throw Error('SINGLE_ACTIVE_VERSION_REQUIRED')
const versionId = deployment.versions[0].version_id
const versions = await api(`${base}/versions`)
if (versions.items?.[0]?.id !== versionId) throw Error('ACTIVE_VERSION_MUST_ALSO_BE_LATEST_FOR_INHERIT')
const version = await api(`${base}/versions/${versionId}`), settings = await api(`${base}/settings`)
const details = version.resources, binding = name => details.bindings.find(value => value.name === name)
if (binding('HZY_PLATFORM_TENANT_CODE')?.text !== 'C000001' || binding('HZY_PLATFORM_ENVIRONMENT')?.text !== 'test' || binding('HZY_PLATFORM_BUNDLE_CACHE_BACKEND')?.text !== 'memory' || binding('HZY_TENANT_GATEWAY_INTERNAL_TOKEN')?.type !== 'secret_text') throw Error('SOURCE_BINDING_MISMATCH')
const content = await request(`${base}/content/v2?version=${versionId}`), entry = content.headers.get('cf-entrypoint')
if (!entry || !content.headers.get('content-type')?.startsWith('multipart/form-data')) throw Error('EXACT_MODULE_EXPORT_REQUIRED')
const original = resolve(directory, 'original'); await mkdir(original, { mode: 0o700 })
const parts = await content.formData(), modules = [], rules = []
const types = {'application/javascript+module':'ESModule','application/javascript':'CommonJS','application/wasm':'CompiledWasm','text/plain':'Text','application/octet-stream':'Data','application/json':'Data','application/source-map':'Data'}
const markers = Object.fromEntries(['HZY_PLATFORM_BUNDLE_CACHE_BACKEND','/v1/console/policy-bundle','console:policy-bundle:read','console:policy-bundle:write','policy_bundle_snapshots','etagMatches','enterprise bundle rollback rejected'].map(value => [value, []]))
for (const [name,file] of parts.entries()) {
 if (typeof file === 'string' || name.startsWith('/') || name.split('/').some(part => part === '..') || !types[file.type]) throw Error('UNSUPPORTED_MODULE')
 const path = resolve(original,name); await mkdir(dirname(path), { recursive:true, mode:0o700 })
 const bytes = Buffer.from(await file.arrayBuffer()); await writeFile(path,bytes,{mode:0o600})
 modules.push({name,type:file.type,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
 rules.push({type:types[file.type],globs:[`original/${name}`],fallthrough:true})
 for (const marker of Object.keys(markers)) if(bytes.includes(Buffer.from(marker))) markers[marker].push(name)
}
if (!modules.some(module => module.name === entry)) throw Error('ENTRYPOINT_MISSING')
const inherited = details.bindings.filter(binding => !['secret_text','secret_key'].includes(binding.type) && binding.name !== 'HZY_PLATFORM_BUNDLE_CACHE_BACKEND').map(binding => ({name:binding.name,type:'inherit'}))
const metadata = {keep_assets:true,keep_bindings:['secret_text','secret_key']}
for(const key of ['usage_model','placement','tags','tail_consumers','logpush','observability','limits'])if(settings[key]!==undefined)metadata[key]=settings[key]
const wrangler = {name,account_id:account,main:`./original/${entry}`,no_bundle:true,find_additional_modules:true,compatibility_date:details.script_runtime.compatibility_date,compatibility_flags:details.script_runtime.compatibility_flags,rules,vars:{HZY_PLATFORM_BUNDLE_CACHE_BACKEND:'runtime'},unsafe:{bindings:inherited,metadata}}
await writeFile(resolve(directory,'wrangler.json'),JSON.stringify(wrangler,null,2)+'\n',{mode:0o600})
await writeFile(resolve(directory,'original-metadata.json'),JSON.stringify({version,settings},null,2)+'\n',{mode:0o600})
const after = await api(`${base}/deployments`)
if(JSON.stringify(after.deployments)!==JSON.stringify(current.deployments))throw Error('DEPLOYMENT_CHANGED_DURING_EXPORT')
const manifest = {schemaVersion:'console-policy-config-candidate.v1',observedAt:new Date().toISOString(),worker:name,tenant:'C000001',environment:'test',originalVersionId:versionId,originalDeploymentId:deployment.id,uploaded:false,deployed:false,changes:[{name:'HZY_PLATFORM_BUNDLE_CACHE_BACKEND',from:'memory',to:'runtime'}],modules,markers,preserved:{nonSecretBindings:inherited.length,secrets:details.bindings.filter(binding=>['secret_text','secret_key'].includes(binding.type)).map(binding=>binding.name),assets:true,compatibility:true},rollback:{versionId,percentage:100},hold:true,configurationOnlyReady:!!markers['/v1/console/policy-bundle'].length && !!markers['console:policy-bundle:write'].length,adr018ConsumerReady:false,remainingChecks:['live Console token and Runtime read/write probe','review old consumer versus ADR018 enterprise entitlement implementation','recheck latest uploaded version equals active version before inheriting bindings']}
await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({prepared:true,uploaded:false,deployed:false,directory,versionId,modules:modules.length,bytes:modules.reduce((n,m)=>n+m.bytes,0),markerPresence:Object.fromEntries(Object.entries(markers).map(([k,v])=>[k,!!v.length])),hold:manifest.hold}))
