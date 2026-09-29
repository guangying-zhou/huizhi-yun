#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectObservations, protectedFileCollector } from './collectors.mjs'
import { buildLocalPackage, canonicalJson, parseCanonicalJson, validateInputManifest } from './evidence.mjs'
import { localName, readCredential, readProtectedFile, writeProtectedNew } from './protected-files.mjs'

function fail(code) { throw new Error(code) }
function argsOf(argv) {
  if (argv[0] !== 'build' || argv.length !== 7 || argv[1] !== '--manifest' || argv[3] !== '--out' || argv[5] !== '--mode') fail('EVIDENCE_USAGE')
  if (!['draft', 'validated'].includes(argv[6])) fail('EVIDENCE_USAGE')
  return { manifest: resolve(argv[2]), output: localName(argv[4]), mode: argv[6] }
}

export async function runCli(argv, options = {}) {
  const { manifest, output, mode } = argsOf(argv)
  const directory = dirname(manifest)
  const manifestRaw = readProtectedFile(manifest)
  const input = parseCanonicalJson(manifestRaw)
  const binding = validateInputManifest(input) // Reject duplicate/missing kinds before any collector runs.
  const collected = await collectObservations(options.collector || protectedFileCollector(directory), binding, input.files, { initialBytes: manifestRaw.length })
  let credential
  try {
    if (mode === 'validated') credential = readCredential(options.credentialDirectory)
    const body = buildLocalPackage(input, collected.map(item => item.value), options.nowMs ?? Date.now(), credential)
    const bytes = Buffer.from(canonicalJson(body))
    writeProtectedNew(join(directory, output), bytes)
    return { status: body.status, phase: body.phase, packageSha256: createHash('sha256').update(bytes).digest('hex'), manifestSha256: body.manifestSha256 }
  } finally { credential?.fill(0) }
}

export function safeErrorCode(error) {
  return /^EVIDENCE_[A-Z_]+$/.test(error?.message || '') ? error.message : 'EVIDENCE_IO_FAILURE'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).then(result => process.stdout.write(`${canonicalJson(result)}`)).catch(error => {
    process.stderr.write(`${safeErrorCode(error)}\n`)
    process.exitCode = 1
  })
}
