import { generateKeyPair, exportJWK } from 'jose'
import { randomBytes } from 'node:crypto'

function sqlString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, '\'\'')}'`
}

const kid = process.env.CONSOLE_AUTH_SIGNING_KID
  || `csk_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}_${randomBytes(6).toString('base64url')}`
const privateEnvName = process.env.CONSOLE_AUTH_SIGNING_PRIVATE_ENV || 'CONSOLE_AUTH_SIGNING_PRIVATE_JWK'

const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true })
const publicJwk = {
  ...(await exportJWK(publicKey)),
  kid,
  alg: 'EdDSA',
  use: 'sig'
}
const privateJwk = {
  ...(await exportJWK(privateKey)),
  kid,
  alg: 'EdDSA',
  use: 'sig'
}

const privateKeyRef = `env:${privateEnvName}`
const publicJwkJson = JSON.stringify(publicJwk)
const privateJwkJson = JSON.stringify(privateJwk)

const sql = [
  'START TRANSACTION;',
  'UPDATE auth_signing_keys SET status = \'retired\', updated_at = UTC_TIMESTAMP() WHERE status = \'current\';',
  [
    'INSERT INTO auth_signing_keys (',
    'kid, alg, use_type, public_jwk_json, private_key_ref, not_before, status',
    ') VALUES (',
    [
      sqlString(kid),
      sqlString('EdDSA'),
      sqlString('sig'),
      `CAST(${sqlString(publicJwkJson)} AS JSON)`,
      sqlString(privateKeyRef),
      'UTC_TIMESTAMP()',
      sqlString('current')
    ].join(', '),
    ');'
  ].join(' '),
  'COMMIT;'
].join('\n')

console.log(JSON.stringify({
  kid,
  privateEnvName,
  privateKeyRef,
  privateJwk: privateJwkJson,
  sql
}, null, 2))
