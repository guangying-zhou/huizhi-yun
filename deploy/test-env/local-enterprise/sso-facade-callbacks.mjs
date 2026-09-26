// Run on the existing SSO host via SSH stdin. No issuer, secret, role, origin,
// Runtime or flow changes. --execute requires the user's exact callback approval.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { pathToFileURL } from 'node:url'

export const loginCallback = 'https://hzy0.isme.dev/console/api/auth/oidc-callback'
export const logoutCallback = 'https://hzy0.isme.dev/console/api/auth/oidc-post-logout'
export function sameClient(left, right) {
  return isDeepStrictEqual({ ...left, redirectUris: [...left.redirectUris].sort() },
    { ...right, redirectUris: [...right.redirectUris].sort() })
}
export function callbackPatch(client) {
  if (client?.clientId !== 'hzy_local_console' || client.protocol !== 'openid-connect'
    || client.publicClient !== false || !client.enabled || !client.standardFlowEnabled
    || !Array.isArray(client.redirectUris)) throw Error('Unexpected SSO client')
  return {
    redirectUris: [...new Set([...client.redirectUris, loginCallback])],
    attributes: { ...client.attributes, 'post.logout.redirect.uris': [...new Set([
      ...(client.attributes?.['post.logout.redirect.uris'] || '').split('##').filter(Boolean), logoutCallback
    ])].join('##') }
  }
}

async function main() {
  if (!['--check', '--execute', '--verify', '--restore-frontchannel'].includes(process.argv[2])
    || execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('Wrong host or mode')
  const container = JSON.parse(execFileSync('docker', ['inspect', 'keycloak'], { stdio: 'pipe' }))[0]
  const env = Object.fromEntries(container.Config.Env.map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]))
  const base = 'http://127.0.0.1:18080'
  const auth = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: env.KEYCLOAK_ADMIN, password: env.KEYCLOAK_ADMIN_PASSWORD })
  })
  if (!auth.ok) throw Error('SSO administration unavailable')
  const token = (await auth.json()).access_token
  const api = async (path, body) => {
    const response = await fetch(`${base}/admin/realms/wiztek/${path}`, {
      method: body ? 'PUT' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    })
    if (!response.ok) throw Error('SSO client request failed')
    return response.status === 204 ? null : response.json()
  }
  const matches = await api('clients?clientId=hzy_local_console')
  if (matches.length !== 1 || matches[0].clientId !== 'hzy_local_console') throw Error('Ambiguous SSO client')
  const path = `clients/${matches[0].id}`
  const before = await api(path), patch = callbackPatch(before)
  if (['--verify', '--restore-frontchannel'].includes(process.argv[2])) {
    const names = readdirSync('/wiztek/hzy-test/backups').filter(name => /^hzy0-facade-callbacks-\d+$/.test(name)).sort()
    if (!names.length) throw Error('No protected callback backup')
    const backup = `/wiztek/hzy-test/backups/${names.at(-1)}`
    const saved = JSON.parse(readFileSync(`${backup}/client.json`, 'utf8'))
    const expected = { ...saved, ...callbackPatch(saved) }
    if (process.argv[2] === '--restore-frontchannel') {
      // Repair only the server's omitted-field reset from the initial partial
      // PUT. Refuse if anything else drifted; retain all current other values.
      const restored = { ...before, frontchannelLogout: saved.frontchannelLogout }
      if (!sameClient(restored, expected)) throw Error('Unrelated SSO change; repair refused')
      if (!sameClient(before, await api(path))) throw Error('Concurrent SSO change')
      await api(path, restored)
      if (!sameClient(await api(path), expected)) throw Error('Repair verification failed')
      console.log(JSON.stringify({ verified: true, repairedField: 'frontchannelLogout', backup }))
      return
    }
    const differences = [...new Set([...Object.keys(expected), ...Object.keys(before)])]
      .filter(key => !isDeepStrictEqual(key === 'redirectUris' ? [...expected[key]].sort() : expected[key],
        key === 'redirectUris' ? [...before[key]].sort() : before[key]))
    console.log(JSON.stringify({ backup, verified: differences.length === 0, differentFields: differences,
      attributeDifferences: differences.includes('attributes') ? [...new Set([...Object.keys(expected.attributes || {}), ...Object.keys(before.attributes || {})])]
        .filter(key => !isDeepStrictEqual(expected.attributes?.[key], before.attributes?.[key])) : [] }))
    return
  }
  const changed = !isDeepStrictEqual(before.redirectUris, patch.redirectUris) || !isDeepStrictEqual(before.attributes, patch.attributes)
  if (process.argv[2] === '--check' || !changed) {
    console.log(JSON.stringify({ mode: process.argv[2], changed, clientId: before.clientId,
      loginRegistered: before.redirectUris.includes(loginCallback),
      logoutRegistered: (before.attributes?.['post.logout.redirect.uris'] || '').split('##').includes(logoutCallback) }))
    return
  }
  const backup = `/wiztek/hzy-test/backups/hzy0-facade-callbacks-${Date.now()}`
  mkdirSync(backup, { mode: 0o700 })
  writeFileSync(`${backup}/client.json`, JSON.stringify(before), { mode: 0o600, flag: 'wx' })
  if (!isDeepStrictEqual(before, await api(path))) throw Error('Concurrent SSO change; stopped')
  // Keycloak resets some omitted booleans even on a partial representation.
  await api(path, { ...before, ...patch })
  const after = await api(path)
  if (!sameClient(after, { ...before, ...patch })) throw Error('SSO readback mismatch; inspect protected backup')
  console.log(JSON.stringify({ changed: true, verified: true, clientId: before.clientId, loginCallback, logoutCallback, backup }))
}
if (process.argv[1] === '-' || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)) {
  main().catch(() => { console.error('SSO callback operation failed; sensitive diagnostics suppressed.'); process.exitCode = 1 })
}
