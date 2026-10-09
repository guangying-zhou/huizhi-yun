import { chmodSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readCollabClientSecret } from './collab-credentials.mjs'

const capabilities = ['codocs:collaboration-snapshots:read', 'codocs:collaboration-snapshots:publish']
const machineCode = value => typeof value === 'string' && /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : null

// Diagnostic decoding only; this does not replace Runtime's signature/JWKS verification.
export function inspectCollabToken(status, body, scope, now = Date.now() / 1000) {
  let claims = {}
  let decoded = false
  try {
    const parts = body?.access_token?.split('.')
    if (parts?.length === 3) { claims = JSON.parse(Buffer.from(parts[1], 'base64url')); decoded = !!claims && typeof claims === 'object' && !Array.isArray(claims) }
  } catch { /* Never include the token, response or parser error in evidence. */ }
  const checks = {
    http: status === 200,
    access_token: typeof body?.access_token === 'string' && !!body.access_token,
    token_type: body?.token_type === 'Bearer',
    decoded,
    token_use: claims?.token_use === 'service',
    aud: claims?.aud === 'data-runtime',
    target_app: claims?.target_app === 'data-runtime',
    source_app: claims?.source_app === 'collab',
    tenant: claims?.tenant === 'C000001',
    deployment: claims?.deployment === 'C000001-test-collab',
    scope: typeof claims?.scope === 'string' && claims.scope === scope,
    exp: typeof claims?.exp === 'number' && claims.exp > now,
    iat: typeof claims?.iat === 'number' && claims.iat <= now + 60,
    iss: typeof claims?.iss === 'string' && !!claims.iss
  }
  return { scope, httpStatus: status, errorCode: machineCode(body?.error?.code) || machineCode(body?.code), checks,
    failedChecks: Object.keys(checks).filter(key => !checks[key]), ok: Object.values(checks).every(Boolean) }
}

export function saveCollabEvidence(directory, evidence) {
  const path = resolve(directory)
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('COLLAB_EVIDENCE_DIRECTORY_UNSAFE')
  const filename = resolve(path, `token-probe-${Date.now()}-${process.pid}.json`)
  writeFileSync(filename, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  chmodSync(filename, 0o600)
  return filename
}

export async function probeCollabTokens({ profilePath, gatewayPort, evidenceDirectory, fetchImpl = fetch }) {
  const evidence = { startedAt: new Date().toISOString(), probes: [], ok: false }
  try {
    const secret = readCollabClientSecret(profilePath)
    for (const scope of capabilities) {
      try {
        const response = await fetchImpl(`http://127.0.0.1:${gatewayPort}/__hzy0/collab-token`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error',
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({ grant_type: 'client_credentials', client_id: 'collab.runtime', client_secret: secret,
            audience: 'data-runtime', scope, source_binding: 'service-client-policy' })
        })
        let body
        try { body = await response.json() } catch { body = {} }
        evidence.probes.push(inspectCollabToken(response.status, body, scope))
      } catch { evidence.probes.push({ scope, httpStatus: null, errorCode: 'probe_transport_failed', failedChecks: ['transport'], ok: false }) }
    }
    evidence.ok = evidence.probes.every(probe => probe.ok)
  } catch { evidence.errorCode = 'probe_credential_unavailable' }
  // Persist on both success and failure, before callers decide whether to roll back.
  saveCollabEvidence(evidenceDirectory, evidence)
  return evidence
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [profilePath, gatewayPort, evidenceDirectory] = process.argv.slice(2)
  if (!profilePath || !evidenceDirectory || !/^\d+$/.test(gatewayPort || '') || Number(gatewayPort) > 65535 || Number(gatewayPort) < 1) {
    console.error('Usage: probe-collab-token.mjs <profile-path> <gateway-port> <private-evidence-directory>')
    process.exitCode = 1
  } else {
    try {
      const evidence = await probeCollabTokens({ profilePath, gatewayPort: Number(gatewayPort), evidenceDirectory })
      console.log(JSON.stringify(evidence, null, 2))
      if (!evidence.ok) process.exitCode = 1
    } catch { console.error('COLLAB_EVIDENCE_WRITE_FAILED'); process.exitCode = 1 }
  }
}
