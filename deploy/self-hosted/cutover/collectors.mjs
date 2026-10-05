import { join } from 'node:path'
import { localName, MAX_FILE_BYTES, MAX_PACKAGE_BYTES, readProtectedFile } from './protected-files.mjs'
import { parseCanonicalJson } from './evidence.mjs'

// Narrow future collector port. A real implementation must read its source
// directly, bind the returned observation, and return the raw canonical bytes.
// This batch supplies only a protected-file adapter for synthetic fixtures.
export async function collectObservations(adapter, binding, files, { initialBytes = 0, maxBytes = MAX_PACKAGE_BYTES } = {}) {
  if (!adapter || typeof adapter.collect !== 'function') throw new Error('EVIDENCE_COLLECTOR_REQUIRED')
  if (!Number.isSafeInteger(initialBytes) || !Number.isSafeInteger(maxBytes) || initialBytes < 0 || maxBytes < 0 || initialBytes > maxBytes) throw new Error('EVIDENCE_PACKAGE_TOO_LARGE')
  const results = []
  let total = initialBytes
  for (const file of files) {
    const raw = await adapter.collect(file.kind, binding, file.name)
    if (!(Buffer.isBuffer(raw) || raw instanceof Uint8Array) || raw.byteLength > MAX_FILE_BYTES || raw.byteLength > maxBytes - total) throw new Error('EVIDENCE_PACKAGE_TOO_LARGE')
    total += raw.byteLength
    results.push({ byteLength: raw.byteLength, value: parseCanonicalJson(raw) })
  }
  return results
}

export function protectedFileCollector(directory) {
  return Object.freeze({
    collect(_kind, _binding, name) { return readProtectedFile(join(directory, localName(name))) }
  })
}
