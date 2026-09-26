#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localOidcVerification } from './local-enterprise/oidc-verification.mjs'

const origin = 'https://hzy0.isme.dev'
const callbacks = [
  ['redirect', `${origin}/enterprise/api/auth/oidc-callback`],
  ['post_logout', `${origin}/enterprise/login`]
]
const mode = process.argv[2] || '--verify'
if (!['--verify', '--apply'].includes(mode)) throw Error('Use --verify or --apply')

const config = JSON.parse(readFileSync(resolve(homedir(), 'Library/Application Support/HuizhiYun/test-runtime/config.json'), 'utf8'))
const database = config.apps?.console?.db
if (config.tenant !== 'C000001' || config.deployment !== 'c000001-test-tenant-runtime'
  || config.deploymentBindings?.console !== 'wiztek-test-console'
  || database?.host !== '127.0.0.1' || database?.database !== 'hzy_console_test_local_20260910') {
  throw Error('TARGET_MISMATCH')
}
const mysql = createRequire(new URL('../../platform/package.json', import.meta.url))('mysql2/promise')
const db = await mysql.createConnection({
  host: database.host, port: database.port, user: database.user, password: database.password, database: database.database
})
try {
  const [[identity]] = await db.query('SELECT DATABASE() AS name, @@server_uuid AS uuid')
  if (identity.name !== 'hzy_console_test_local_20260910' || identity.uuid !== '37d8994e-4c12-11ee-afad-8cb2da2e572b') throw Error('INSTANCE_MISMATCH')
  if (mode === '--apply') await registerCallbacks(db)
  const verification = await verifyCallbacks(db)
  console.log(JSON.stringify(verification, null, 2))
  if (!verification.enterpriseClientActive || verification.callbacks.some(callback => !callback.active)) process.exitCode = 1
} catch {
  console.error('LOCAL_ENTERPRISE_OIDC_REGISTRATION_FAILED (details suppressed)')
  process.exitCode = 1
} finally {
  await db.end()
}

async function registerCallbacks(db) {
  await db.beginTransaction()
  try {
    const [clients] = await db.query("SELECT id, app_code, client_type, auth_mode, status FROM auth_clients WHERE client_id='enterprise' FOR UPDATE")
    if (clients.length !== 1 || clients[0].app_code !== 'enterprise' || clients[0].client_type !== 'public'
      || clients[0].auth_mode !== 'oidc' || clients[0].status !== 'active') throw Error('ENTERPRISE_CLIENT_CONFLICT')
    for (const [uriType, redirectUri] of callbacks) {
      const [existing] = await db.query(
        'SELECT status FROM auth_client_redirect_uris WHERE client_id=? AND uri_type=? AND redirect_uri=? FOR UPDATE',
        [clients[0].id, uriType, redirectUri]
      )
      if (existing.some(row => row.status !== 'active')) throw Error('OIDC_URI_REVOKED')
      if (!existing.length) {
        await db.query(
          "INSERT INTO auth_client_redirect_uris(client_id, uri_type, redirect_uri, source, status) VALUES(?, ?, ?, 'local-enterprise-hzy0', 'active')",
          [clients[0].id, uriType, redirectUri]
        )
      }
    }
    await db.commit()
  } catch (error) {
    await db.rollback()
    throw error
  }
}

async function verifyCallbacks(db) {
  const [clients] = await db.query("SELECT id, app_code, client_type, auth_mode, status FROM auth_clients WHERE client_id='enterprise'")
  const [uris] = await db.query(
    "SELECT client_id, uri_type, redirect_uri, status FROM auth_client_redirect_uris WHERE client_id = ? AND redirect_uri IN (?, ?)",
    [clients.length === 1 ? clients[0].id : -1, ...callbacks.map(([, uri]) => uri)]
  )
  return {
    target: { tenant: 'C000001', runtimeDeployment: 'c000001-test-tenant-runtime', consoleDeployment: 'wiztek-test-console' },
    ...localOidcVerification(clients, uris, callbacks),
    configurationMutated: mode === '--apply'
  }
}
