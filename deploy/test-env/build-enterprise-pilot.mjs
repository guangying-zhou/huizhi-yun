// Local artifact only. No dotenv, deployment, enrollment or registry mutation.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { root } from './worker-config.mjs'
import { enterprisePilotConfig } from './enterprise-pilot-config.mjs'
const plan=enterprisePilotConfig()
for(const key of Object.keys(process.env)) if(/^(?:HZY_|NUXT_|SSO_|OIDC_|DB_|MYSQL_|ALIYUN_|CLOUDFLARE_|CF_|NITRO_)/.test(key)) delete process.env[key]
Object.assign(process.env,plan.host.vars,plan.buildEnvironment)
const dir=resolve(root,'deploy/test-env/.cloudflare-workers/enterprise')
const output=resolve(dir,'output')
await mkdir(dir,{recursive:true,mode:0o700})
const { loadNuxt,buildNuxt }=await import('@nuxt/kit')
const nuxt=await loadNuxt({cwd:resolve(root,'enterprise'),dev:false,dotenv:false,overrides:{buildDir:resolve(dir,'nuxt'),nitro:{preset:'cloudflare_module',output:{dir:output,serverDir:resolve(output,'server'),publicDir:resolve(output,'public')}}}})
try{await buildNuxt(nuxt)}finally{await nuxt.close()}
const config={...plan.host,main:resolve(output,'server/index.mjs'),assets:{...plan.host.assets,directory:resolve(output,'public')}}
await writeFile(resolve(dir,'wrangler.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600})
console.log('Enterprise pilot local artifact and Wrangler configuration built; not deployed.')
