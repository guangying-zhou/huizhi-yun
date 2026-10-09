// Local byte/metadata comparison only. No network or deployment.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
const directory = resolve(process.argv[2] || '')
if (!process.argv[2]) throw Error('CANDIDATE_DIRECTORY_REQUIRED')
const json = async name => JSON.parse(await readFile(resolve(directory,name),'utf8'))
const [source,config,manifest] = await Promise.all(['original-metadata.json','wrangler.json','manifest.json'].map(json))
assert.deepEqual(Object.keys(config).sort(),['name','account_id','main','no_bundle','find_additional_modules','compatibility_date','compatibility_flags','rules','vars','unsafe'].sort())
assert.equal(config.name,'hzy-test-console')
assert.equal(config.no_bundle,true)
assert.deepEqual(config.vars,{HZY_PLATFORM_BUNDLE_CACHE_BACKEND:'runtime'})
assert.equal(source.version.id,manifest.originalVersionId)
const original = source.version.resources
assert.equal(original.bindings.find(b=>b.name==='HZY_PLATFORM_BUNDLE_CACHE_BACKEND')?.text,'memory')
const inherited = original.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)&&b.name!=='HZY_PLATFORM_BUNDLE_CACHE_BACKEND').map(b=>({name:b.name,type:'inherit'}))
assert.deepEqual(config.unsafe.bindings,inherited)
assert.deepEqual(Object.keys(config.unsafe).sort(),['bindings','metadata'])
assert.deepEqual(Object.keys(config.unsafe.metadata).sort(),['keep_assets','keep_bindings',...['usage_model','placement','tags','tail_consumers','logpush','observability','limits'].filter(k=>source.settings[k]!==undefined)].sort())
assert.equal(config.unsafe.metadata.keep_assets,true)
assert.deepEqual(config.unsafe.metadata.keep_bindings,['secret_text','secret_key'])
assert.equal(config.compatibility_date,original.script_runtime.compatibility_date)
assert.deepEqual(config.compatibility_flags,original.script_runtime.compatibility_flags)
for(const key of ['usage_model','placement','tags','tail_consumers','logpush','observability','limits'])assert.deepEqual(config.unsafe.metadata[key],source.settings[key])
assert.equal(config.routes,undefined)
assert.equal(config.workers_dev,undefined)
const hash = data=>createHash('sha256').update(data).digest('hex')
for(const module of manifest.modules){
 if(module.name.startsWith('/')||module.name.split('/').includes('..'))throw Error('UNSAFE_MODULE_NAME')
 const bytes=await readFile(resolve(directory,'original',module.name))
 assert.equal(bytes.length,module.bytes);assert.equal(hash(bytes),module.sha256)
}
const reviewHash=hash(JSON.stringify({source,config,manifest}))
console.log(JSON.stringify({verified:true,deployed:false,uploaded:false,reviewHash,originalVersionId:manifest.originalVersionId,moduleCount:manifest.modules.length,preservedNonSecretBindings:inherited.length,preservedSecrets:manifest.preserved.secrets.length,hold:manifest.hold}))
