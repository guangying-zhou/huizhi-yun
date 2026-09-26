#!/usr/bin/env node
// Read-only ingress/Dev transport probe. No user cookies, credentials, writes,
// Runtime calls or business acceptance claims. HMR token stays in memory.
import { request } from 'node:http'
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { readProfile } from './config.mjs'

const { values } = parseArgs({ options: { profile: { type:'string' } } })
if (!values.profile) throw Error('--profile is required')
const { value: profile, issues } = await readProfile(values.profile)
if (issues.length) throw Error('Profile is not approved')
const listener = profile.listeners.gatewayIngress
const base = { host:listener.host, port:listener.port, headers:{host:'hzy0.isme.dev'} }
const results = []
for (const [path, expected] of [['/enterprise/',302],['/enterprise',200],['/enterprise/login',200],['/enterprise/api/navigation',401],['/enterprise/api/internal/probe',404]]) {
  const response = await get(path)
  // Internal paths may fail closed as 503 before route resolution.
  results.push({ path,status:response.status,passed:response.status===expected || (expected===404 && response.status===503) })
}
const client = await get('/enterprise/_nuxt/@vite/client')
const iconPath = '/api/_nuxt_icon/lucide.json?icons=menu,search'
const iconResponse = await get(iconPath)
let iconPayload
try { iconPayload = JSON.parse(iconResponse.body) } catch {}
results.push({ path: iconPath, status: iconResponse.status, passed: iconResponse.status === 200 && iconPayload?.prefix === 'lucide' && typeof iconPayload?.icons?.menu?.body === 'string' && typeof iconPayload?.icons?.search?.body === 'string' })
const configured = client.status===200 && /const hmrPort = 443;/.test(client.body) && /const socketProtocol = "wss"/.test(client.body)
const token = client.body.match(/const wsToken = "([^"]+)"/)?.[1]
const handshake = token ? await upgrade(token) : 0
results.push({ path:'/enterprise/_nuxt/@vite/client',status:client.status,explicitPublicHmr:configured,handshake,passed:configured&&handshake===101 })
console.log(JSON.stringify({ scope:'unauthenticated local ingress; not browser/business acceptance', results },null,2))
if (results.some(result=>!result.passed)) process.exitCode=1

function get(path) {
  return new Promise((resolve,reject)=>{
    const req=request({...base,path},res=>{
      let body=''
      res.on('data',chunk=>{body+=chunk;if(body.length>1024*1024)req.destroy(Error('Probe response too large'))})
      res.on('end',()=>resolve({status:res.statusCode,body}))
      res.on('error',()=>reject(Error('Probe response interrupted')))
    })
    req.setTimeout(20000,()=>req.destroy(Error('Probe timed out')))
    req.on('error',()=>reject(Error('Probe transport failed')))
    req.end()
  })
}
function upgrade(token) {
  return new Promise(resolve=>{
    const req=request({...base,path:'/enterprise/_nuxt/?token='+encodeURIComponent(token),headers:{...base.headers,origin:profile.publicOrigin,connection:'Upgrade',upgrade:'websocket','sec-websocket-version':'13','sec-websocket-key':randomBytes(16).toString('base64'),'sec-websocket-protocol':'vite-hmr'}})
    req.on('upgrade',(res,socket)=>{socket.destroy();resolve(res.statusCode)})
    req.on('response',res=>{res.resume();resolve(res.statusCode)})
    req.on('error',()=>resolve(0))
    req.setTimeout(8000,()=>req.destroy())
    req.end()
  })
}
