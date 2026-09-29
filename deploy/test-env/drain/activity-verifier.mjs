const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
export async function verifyActivityResolution(envelope, env) {
  if (!env.HZY_PLATFORM_SIGNING_PUBLIC_KEY || !env.HZY_PLATFORM_SIGNING_KID || envelope?.kid !== env.HZY_PLATFORM_SIGNING_KID || envelope.alg !== 'Ed25519' || typeof envelope.payload !== 'string') throw Error('Pinned Platform signature required')
  const pem = env.HZY_PLATFORM_SIGNING_PUBLIC_KEY.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const key = await crypto.subtle.importKey('spki', decode(pem), {name:'Ed25519'}, false, ['verify'])
  if (!await crypto.subtle.verify('Ed25519', key, decode(envelope.signature), new TextEncoder().encode(envelope.payload))) throw Error('Invalid activity signature')
  const value = JSON.parse(envelope.payload), expiry = Date.parse(value.expiresAt)
  if (value.type !== 'enterprise-drain-activity-resolution.v1' || value.tenant !== 'C000001' || value.environment !== 'test' || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now()+300000 || !Number.isSafeInteger(value.closedRevision) || value.closedRevision<1 || !value.requestId || !value.actorUid || !/^[a-f0-9]{64}$/.test(value.approvalSha256)) throw Error('Invalid activity resolution')
  const activity = value.activity
  if (!activity || !['active','uncertain'].includes(activity.status) || !activity.id || !Number.isSafeInteger(activity.admitted_revision) || activity.admitted_revision<1 || !['verified-terminal','verified-not-sent'].includes(value.decision?.outcome)) throw Error('Actual terminal evidence required')
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(activity))))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
  if(hash!==value.activitySha256)throw Error('Activity row hash mismatch')
  if(activity.status==='active' && (!value.decision.executionEndedReference || !/^[a-f0-9]{64}$/.test(value.decision.executionEndedEvidenceSha256)))throw Error('Execution-ended evidence required')
  const immutable={type:value.type,tenant:value.tenant,environment:value.environment,closedRevision:value.closedRevision,actor:value.actor,activity:value.activity,activitySha256:value.activitySha256,decision:value.decision,actorUid:value.actorUid,requestId:value.requestId}
  const approvalHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(immutable))))].map(byte=>byte.toString(16).padStart(2,'0')).join('')
  if(approvalHash!==value.approvalSha256)throw Error('Immutable approval hash mismatch')
  return value
}
