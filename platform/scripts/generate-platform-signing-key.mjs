#!/usr/bin/env node
import { createHash, generateKeyPairSync } from 'node:crypto'
import process from 'node:process'

function usage() {
  return `
Usage:
  pnpm run signing:key
  pnpm run signing:key -- --label prod
  pnpm run signing:key -- --label dev

Generates a fresh Ed25519 Platform signing key pair and prints env snippets.
The script does not write key material to disk. Store the private value only in
the matching Platform env or secret manager, and copy the public kid/pubkey to
the matching Console env.
`
}

function parseArgs(argv) {
  const args = { label: 'platform' }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]
    if (name === 'label') {
      if (!value || value.startsWith('--')) {
        throw new Error('missing value for --label')
      }
      args.label = value
      if (equalsIndex < 0) index += 1
      continue
    }

    throw new Error(`unknown option: --${name}`)
  }

  return args
}

function buildKid(publicKeyPem) {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const digest = createHash('sha256').update(publicKeyPem).digest('base64url').slice(0, 12)
  return `psk_${date}_${digest}`
}

function escapeEnvDoubleQuoted(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

function publicKeyFingerprint(publicKeyPem) {
  return `sha256:${createHash('sha256').update(publicKeyPem).digest('hex')}`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const kid = buildKid(publicKeyPem)
  const privateKeyBase64 = Buffer.from(privateKeyPem, 'utf8').toString('base64')

  console.info(`# ${args.label} Platform signing key`)
  console.info('# Private value: put only in the matching Platform env or secret manager.')
  console.info(`HZY_PLATFORM_SIGNING_PRIVATE_KEY=base64:${privateKeyBase64}`)
  console.info('')
  console.info('# Public values: put in the matching Console env.')
  console.info(`HZY_PLATFORM_SIGNING_KID=${kid}`)
  console.info(`HZY_PLATFORM_SIGNING_PUBKEY="${escapeEnvDoubleQuoted(publicKeyPem)}"`)
  console.info('')
  console.info('# Non-secret fingerprint for deployment notes.')
  console.info(`HZY_PLATFORM_SIGNING_PUBLIC_FINGERPRINT=${publicKeyFingerprint(publicKeyPem)}`)
}

try {
  main()
} catch (error) {
  console.error(`[platform-signing-key] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
