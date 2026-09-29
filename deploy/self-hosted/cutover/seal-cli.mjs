#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectObservations, protectedFileCollector } from './collectors.mjs'
import { parseCanonicalJson, validateInputManifest } from './evidence.mjs'
import { localName, readCredential, readProtectedFile, writeProtectedNew } from './protected-files.mjs'
import { buildSealedArtifacts } from './sealed.mjs'

export async function runSealCli(argv, options = {}) {
  if (argv.length !== 13 || argv[0] !== 'seal' || argv[1] !== '--manifest' || argv[3] !== '--report'
    || argv[5] !== '--profile' || argv[7] !== '--actors' || argv[9] !== '--cold-archive' || argv[11] !== '--out-prefix') throw Error('EVIDENCE_USAGE')
  const manifest = resolve(argv[2]), directory = dirname(manifest), prefix = localName(argv[12])
  const input = parseCanonicalJson(readProtectedFile(manifest))
  validateInputManifest(input)
  const collected = await collectObservations(protectedFileCollector(directory), input.binding, input.files)
  const report = parseCanonicalJson(readProtectedFile(resolve(argv[4])))
  const profile = parseCanonicalJson(readProtectedFile(resolve(argv[6])))
  const actors = parseCanonicalJson(readProtectedFile(resolve(argv[8])))
  const coldArchive = parseCanonicalJson(readProtectedFile(resolve(argv[10])))
  if (!Array.isArray(coldArchive)) throw Error('EVIDENCE_COLD_ARCHIVE_MANUAL_REQUIRED')
  for (const item of coldArchive) {
    const bytes = readProtectedFile(join(directory, localName(item.name)))
    if (createHash('sha256').update(bytes).digest('hex') !== item.evidenceSha256) throw Error('EVIDENCE_COLD_ARCHIVE_FILE_CHANGED')
  }
  const credential = readCredential(options.credentialDirectory)
  try {
    const { evidenceBytes, request } = buildSealedArtifacts({ input, observations: collected.map(item => item.value), report, profile,
      actors, coldArchive, credential, nowMs: options.nowMs ?? Date.now() })
    const requestBytes = Buffer.from(JSON.stringify(request) + '\n')
    writeProtectedNew(join(directory, `${prefix}.evidence.json`), evidenceBytes)
    writeProtectedNew(join(directory, `${prefix}.request.json`), requestBytes)
    return { status: 'sealed', evidenceSha256: createHash('sha256').update(evidenceBytes).digest('hex'),
      requestSha256: createHash('sha256').update(requestBytes).digest('hex') }
  } finally { credential.fill(0) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSealCli(process.argv.slice(2)).then(value => process.stdout.write(`${JSON.stringify(value)}\n`)).catch(error => {
    process.stderr.write(`${/^EVIDENCE_[A-Z_]+$/.test(error?.message || '') ? error.message : 'EVIDENCE_IO_FAILURE'}\n`)
    process.exitCode = 1
  })
}
