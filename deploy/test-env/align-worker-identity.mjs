// Remote test host only: preserve old callbacks and back up all changed state.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const origin = 'https://hzy0.isme.dev'
try {
  if (process.argv[2] !== '--execute' || execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('Host')
  const path = '/wiztek/hzy-test/runtime/config.json'
  const config = JSON.parse(fs.readFileSync(path))
  if (config.tenant !== 'C000001' || config.deployment !== 'c000001-test-tenant-runtime'
    || config.apps.people.db.database !== 'hzy_people_test_20260905'
    || config.control.platformUrl !== 'https://hzy.wiztek.cn'
    || !['http://127.0.0.1:3000/console', origin].includes(config.auth.jwt.issuer)) throw Error('Test binding')
  const backup = `/wiztek/hzy-test/backups/worker-identity-${Date.now()}`
  fs.mkdirSync(backup, { mode: 0o700 })
  const container = JSON.parse(execFileSync('docker', ['inspect', 'keycloak'], { stdio: 'pipe' }))[0]
  const env = Object.fromEntries(container.Config.Env.map(v => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]))
  const base = 'http://127.0.0.1:18080'
  const response = await fetch(`${base}/realms/master/protocol/openid-connect/token`, { method: 'POST',
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: env.KEYCLOAK_ADMIN, password: env.KEYCLOAK_ADMIN_PASSWORD }) })
  if (!response.ok) throw Error('Admin login')
  const token = (await response.json()).access_token
  const api = async (path, method = 'GET', body) => {
    const r = await fetch(`${base}/admin/realms/wiztek/${path}`, { method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    if (!r.ok) throw Error('Client configuration')
    return r.status === 204 ? null : r.json()
  }
  const clients = await api('clients?clientId=hzy_local_console')
  if (clients.length !== 1 || clients[0].clientId !== 'hzy_local_console' || clients[0].publicClient) throw Error('Local client')
  const client = await api(`clients/${clients[0].id}`)
  fs.writeFileSync(`${backup}/keycloak-client.json`, JSON.stringify(client), { mode: 0o600 })
  fs.writeFileSync(`${backup}/runtime-config.json`, fs.readFileSync(path), { mode: 0o600 })
  client.redirectUris = [...new Set([...client.redirectUris, `${origin}/api/auth/oidc-callback`])]
  client.webOrigins = [...new Set([...client.webOrigins, origin])]
  client.attributes ||= {}
  client.attributes['post.logout.redirect.uris'] = [...new Set([
    ...(client.attributes['post.logout.redirect.uris'] || '').split('##').filter(Boolean), `${origin}/api/auth/oidc-post-logout`
  ])].join('##')
  await api(`clients/${client.id}`, 'PUT', client)
  config.auth.jwt.issuer = origin
  fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
  execFileSync('systemctl', ['restart', 'hzy-test-data-runtime'], { stdio: 'pipe' })
  console.log(`Test Runtime issuer and local SSO callbacks aligned. Backup: ${backup}`)
} catch {
  console.error('Test identity alignment failed; credential-bearing diagnostics suppressed. Inspect protected backups before retrying.')
  process.exitCode = 1
}
