#!/usr/bin/env node
// Maintenance: remove abandoned Codocs department-copy staging objects.
// Default is a read-only dry run. Deleting requires `--apply --confirm-delete-copy-staging`.
// Credentials are never read or printed here: `--client-module` must default-export an
// async factory returning an OSS client (listV2 + delete) built by the existing
// Codocs runtime OSS client / integration resolution. Integration resolution only works
// inside a running Nuxt server, so operators supply the factory module in a controlled
// environment; see cleanup-codocs-copy-staging.client.example.mjs. Nothing is hardcoded.
// The application never deletes staging on success (so same-key replays within 24h reuse
// the first bytes and stay idempotent); this script is the only cleanup, at >= 24h.
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const STAGING_PREFIX = 'codocs/copy-staging/'
export const DEFAULT_MIN_AGE_HOURS = 24
export const CONFIRM_FLAG = '--confirm-delete-copy-staging'

export function parseArgs(argv) {
  const opts = { apply: false, confirmed: false, prefix: STAGING_PREFIX, minAgeHours: DEFAULT_MIN_AGE_HOURS, clientModule: '' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') opts.apply = true
    else if (arg === CONFIRM_FLAG) opts.confirmed = true
    else if (arg === '--prefix') opts.prefix = argv[++i] ?? ''
    else if (arg === '--min-age-hours') opts.minAgeHours = Number(argv[++i])
    else if (arg === '--client-module') opts.clientModule = argv[++i] ?? ''
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return opts
}

export async function cleanupCopyStaging(client, options = {}) {
  const { apply = false, confirmed = false, prefix = STAGING_PREFIX, minAgeHours = DEFAULT_MIN_AGE_HOURS, now = Date.now() } = options
  if (prefix !== STAGING_PREFIX) throw new Error(`Refusing prefix other than exactly ${STAGING_PREFIX}`)
  if (!Number.isFinite(minAgeHours) || minAgeHours < DEFAULT_MIN_AGE_HOURS) throw new Error(`--min-age-hours must be a number >= ${DEFAULT_MIN_AGE_HOURS}`)
  if (apply && !confirmed) throw new Error(`--apply requires ${CONFIRM_FLAG}`)
  const cutoff = now - minAgeHours * 3600_000
  const summary = { mode: apply ? 'apply' : 'dry-run', prefix, scanned: 0, candidates: 0, deleted: 0, failed: 0, kept: 0 }
  let token = null
  do {
    const result = await client.listV2({ 'prefix': prefix, 'max-keys': 100, ...(token ? { 'continuation-token': token } : {}) })
    for (const object of result.objects || []) {
      summary.scanned++
      const modified = Date.parse(object.lastModified)
      // Defense in depth: never touch keys outside the prefix or with unknown age.
      if (!object.name?.startsWith(STAGING_PREFIX) || !Number.isFinite(modified) || modified > cutoff) {
        summary.kept++
        continue
      }
      summary.candidates++
      if (!apply) continue
      try {
        await client.delete(object.name)
        summary.deleted++
      } catch {
        summary.failed++
      }
    }
    token = result.isTruncated ? (result.nextContinuationToken || null) : null
  } while (token)
  return summary
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.prefix !== STAGING_PREFIX) throw new Error(`Refusing prefix other than exactly ${STAGING_PREFIX}`)
  if (!opts.clientModule) throw new Error('--client-module <file> is required (default export: async () => OSS client)')
  const factory = (await import(pathToFileURL(resolve(opts.clientModule)).href)).default
  const client = await factory()
  const summary = await cleanupCopyStaging(client, opts)
  console.log(JSON.stringify(summary))
  if (summary.failed) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`cleanup-codocs-copy-staging: ${error.message}`)
    process.exitCode = 1
  })
}
