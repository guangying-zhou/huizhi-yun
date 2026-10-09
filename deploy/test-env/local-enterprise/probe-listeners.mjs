#!/usr/bin/env node
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import { readProfile, validateProfile } from './config.mjs'

export function expectedListeners(profile) {
  const keys = ['gatewayIngress', 'gatewayInternal', 'enterprise', 'codocsEditor']
  if (profile.identity.consoleFacadeMode === 'local-canonical-facade') keys.push('console')
  if (profile.features?.workflowLocal === true) keys.push('workflow', ...(profile.features?.aimsRetired === true ? [] : ['aims']))
  if (profile.features?.codocsCollaborationV2 === true) keys.push('collab')
  return keys.map(name => ({ name, ...(name === 'console' ? {host:'127.0.0.1',port:23100} : profile.listeners[name]) }))
}
export function listens({host, port}) {
  return new Promise(resolve => {
    const socket = createConnection({host,port})
    const finish = listening => {socket.destroy();resolve(listening)}
    socket.setTimeout(3000,()=>finish(false))
    socket.once('error',()=>finish(false))
    socket.once('connect',()=>finish(true))
  })
}
export async function probeListeners(profile, connect = listens, fetchImpl = fetch) {
  const listeners = await Promise.all(expectedListeners(profile).map(async item => ({...item,listening:await connect(item)})))
  let publicStatus = 0
  try {publicStatus=(await fetchImpl(`${profile.publicOrigin}/enterprise/`,{redirect:'manual',signal:AbortSignal.timeout(15000),cache:'no-store'})).status} catch { /* recorded as unavailable */ }
  return {healthy:listeners.every(item=>item.listening) && [200,302].includes(publicStatus),listeners,publicStatus}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  try {
    if(process.argv.length!==3) throw Error('Use probe-listeners.mjs /absolute/profile.json')
    const {value,issues}=await readProfile(process.argv[2])
    if(issues.length || validateProfile(value).length) throw Error('Unapproved profile')
    const result=await probeListeners(value)
    console.log(JSON.stringify(result));process.exitCode=result.healthy?0:1
  } catch {console.error('Listener/public entry probe failed');process.exitCode=1}
}
