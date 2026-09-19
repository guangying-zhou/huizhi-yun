const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
export async function verifyActivationEnvelope(envelope, env) {
  if (!env.HZY_PLATFORM_SIGNING_PUBLIC_KEY || !env.HZY_PLATFORM_SIGNING_KID || !envelope || envelope.kid !== env.HZY_PLATFORM_SIGNING_KID || envelope.alg !== 'Ed25519' || typeof envelope.payload !== 'string') throw Error('Pinned activation signature required')
  const pem = env.HZY_PLATFORM_SIGNING_PUBLIC_KEY.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
  const key = await crypto.subtle.importKey('spki', decode(pem), { name: 'Ed25519' }, false, ['verify'])
  if (!await crypto.subtle.verify('Ed25519', key, decode(envelope.signature), new TextEncoder().encode(envelope.payload))) throw Error('Invalid activation signature')
  const value = JSON.parse(envelope.payload)
  const expiry = Date.parse(value.expiresAt)
  if (value.type !== 'enterprise-drain-release.v1' || value.tenant !== 'C000001' || value.environment !== 'test' || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 30000 || !/^[1-9][0-9]{0,19}$/.test(value.generation) || BigInt(value.generation) > 18446744073709551615n) throw Error('Invalid activation envelope')
  if (!['reviewHash','evidenceHash','externalApprovalSha256'].every(field => /^[a-f0-9]{64}$/.test(value[field])) || typeof value.runtimeCode !== 'string' || !value.runtimeCode) throw Error('Approved external evidence binding required')
  return value
}
