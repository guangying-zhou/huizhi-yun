#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const CHECKS = [
  {
    file: 'platform/server/plugins/ensureSigningKey.ts',
    description: 'production Platform fails startup when signing key is not usable',
    required: [
      "import { ensurePlatformSigningKey } from '~~/server/utils/platformSigning'",
      "const isProduction = process.env.NODE_ENV === 'production'",
      'allowGenerateDevKey: !isProduction',
      'if (isProduction) {',
      'throw error',
      '[platform] signing key initialization skipped:'
    ]
  },
  {
    file: 'platform/server/utils/platformSigning.ts',
    description: 'active signing key validation requires matching private key',
    required: [
      'async function resolveValidPrivateKeyPem(activeKey: PlatformSigningKey)',
      'const validation = validatePrivateKeyPem(resolved.value',
      'if (!samePublicKey(activeKey.publicKey, validation.publicKeyPem))',
      'platform signing private key does not match active public key',
      'message: \'active platform signing key is required\'',
      'message: \'active platform signing key is not configured\''
    ]
  },
  {
    file: 'platform/server/api/platform/diagnostics.get.ts',
    description: 'Platform diagnostics exposes non-secret signing readiness',
    required: [
      'privateKeyUsable',
      'publicKeyFingerprint',
      'privateKeyRefType',
      'platform signing private key does not match active public key'
    ],
    forbiddenPatterns: [
      '\\n\\s*privateKey\\s*:',
      '\\n\\s*privateKeyPem\\s*:',
      '\\n\\s*privateKeyMaterial\\s*:'
    ]
  },
  {
    file: 'scripts/probe-platform-runtime.mjs',
    description: 'Platform runtime probe fails when signing private key is unusable',
    required: [
      'active signing key is missing',
      'active signing private key is not usable',
      'prod/dev Platform signing public key fingerprints must be different'
    ]
  }
]

function usage() {
  return `
Usage:
  pnpm run validate:platform-signing-readiness

Checks that Platform production startup and runtime probes still require a
usable Ed25519 root signing key. Bundle/license generation depends on this key;
weakening these checks tends to surface later as opaque 503 responses when a
tenant generates a policy bundle.
`
}

function fail(message) {
  console.error(`[platform-signing-readiness] ${message}`)
  process.exit(1)
}

function readSource(file) {
  if (!existsSync(file)) {
    fail(`${file} is missing`)
  }
  return readFileSync(file, 'utf8')
}

function assertCheck(check) {
  const source = readSource(check.file)
  for (const required of check.required || []) {
    if (!source.includes(required)) {
      fail(`${check.description} in ${check.file} must include ${required}`)
    }
  }
  for (const forbidden of check.forbidden || []) {
    if (source.includes(forbidden)) {
      fail(`${check.description} in ${check.file} must not expose ${forbidden}`)
    }
  }
  for (const forbiddenPattern of check.forbiddenPatterns || []) {
    if (new RegExp(forbiddenPattern).test(source)) {
      fail(`${check.description} in ${check.file} must not match ${forbiddenPattern}`)
    }
  }
  console.info(`[platform-signing-readiness] ${check.description} passed`)
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.info(usage().trim())
    return
  }

  for (const check of CHECKS) {
    assertCheck(check)
  }

  console.info('[platform-signing-readiness] passed')
}

try {
  main()
} catch (error) {
  console.error(`[platform-signing-readiness] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
