#!/usr/bin/env node
// Proves (or refutes) that "provider version ID" and "write-once" hold TOGETHER on
// the production Codocs snapshot bucket. Not executed by the repository tests
// against any real bucket; see docs/Go-Live-Self-Hosted-Snapshot-Bucket-Test-Plan.md.
//
//   default        read-only: bucket versioning + lifecycle + a bounded LIST of the
//                  test prefix. No object is created, changed or deleted.
//   --plan         prints the exact request plan and its hash; no network at all.
//   --write-proof --confirm <planHash>
//                  creates a handful of small random objects ONLY under the dedicated
//                  test prefix `_write-once-proof/<runId>/`, never under codocs/.
//   --overwrite-control   (with --write-proof) also shows that an unprotected PUT can
//                  overwrite, so a "write-once holds" result is meaningful.
//   --cleanup      (with --write-proof) deletes exactly the objects/versions this run
//                  created, then checks they are gone.
//
// Credentials come only from a 0600 JSON file (a dedicated key limited to the test
// prefix is expected); they are never printed, logged or put in argv.
import assert from 'node:assert/strict'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const PROOF_PREFIX = '_write-once-proof/'
const CONCURRENCY = 8
const BODY_BYTES = 64
const MAX_LIST = 20

export function validateProofConfig(config) {
  assert.match(config?.bucket || '', /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'PROOF_BUCKET_INVALID')
  assert.match(config?.endpoint || '', /^[a-z0-9][a-z0-9.-]{3,120}$/, 'PROOF_ENDPOINT_INVALID (host only, no scheme or path)')
  assert.ok(config.accessKeyId && config.accessKeySecret, 'PROOF_CREDENTIALS_MISSING')
  const prefix = config.testPrefix ?? PROOF_PREFIX
  assert.ok(prefix.startsWith(PROOF_PREFIX) && /^[A-Za-z0-9_./-]+\/$/.test(prefix) && !prefix.includes('..') && !prefix.includes('//'), 'PROOF_PREFIX_NOT_DEDICATED')
  assert.ok(!/^\/?(codocs|recycle\.bin)\b/.test(prefix), 'PROOF_PREFIX_IN_PRODUCTION_NAMESPACE')
  return { bucket: config.bucket, endpoint: config.endpoint, prefix, accessKeyId: config.accessKeyId, accessKeySecret: config.accessKeySecret }
}

// ---- OSS signature V1 -------------------------------------------------------
const SIGNED_SUBRESOURCES = new Set(['versionId', 'versioning', 'lifecycle'])
export function canonicalResource(bucket, key, query = {}) {
  const sub = Object.keys(query).filter(name => SIGNED_SUBRESOURCES.has(name)).sort()
    .map(name => query[name] === '' || query[name] === undefined ? name : `${name}=${query[name]}`)
  return `/${bucket}/${key}${sub.length ? `?${sub.join('&')}` : ''}`
}
export function signOssV1({ secret, method, contentMd5 = '', contentType = '', date, headers = {}, bucket, key = '', query = {} }) {
  const oss = Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value).trim()])
    .filter(([name]) => name.startsWith('x-oss-')).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${name}:${value}\n`).join('')
  const stringToSign = `${method}\n${contentMd5}\n${contentType}\n${date}\n${oss}${canonicalResource(bucket, key, query)}`
  return createHmac('sha1', secret).update(stringToSign).digest('base64')
}

export function createOssClient({ bucket, endpoint, accessKeyId, accessKeySecret }, { fetchImpl = fetch, scheme = 'https', timeoutMs = 20_000, now = () => new Date() } = {}) {
  async function request({ method, key = '', query = {}, headers = {}, body }) {
    const date = now().toUTCString()
    const contentType = body === undefined ? '' : 'application/octet-stream'
    const signed = { ...headers }
    const signature = signOssV1({ secret: accessKeySecret, method, contentType, date, headers: signed, bucket, key, query })
    const search = new URLSearchParams(Object.entries(query).map(([name, value]) => [name, value ?? ''])).toString().replace(/=(&|$)/g, '$1')
    const url = `${scheme}://${bucket}.${endpoint}/${key.split('/').map(encodeURIComponent).join('/')}${search ? `?${search}` : ''}`
    const response = await fetchImpl(url, {
      method, body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { ...signed, date, authorization: `OSS ${accessKeyId}:${signature}`, ...(body === undefined ? {} : { 'content-type': contentType }) }
    })
    const bytes = Buffer.from(await response.arrayBuffer())
    return { status: response.status, headers: Object.fromEntries(response.headers), bytes }
  }
  return { request }
}

// ---- read-only inspection ---------------------------------------------------
export async function inspectBucket(client, prefix) {
  const versioning = await client.request({ method: 'GET', query: { versioning: '' } })
  const lifecycle = await client.request({ method: 'GET', query: { lifecycle: '' } })
  const list = await client.request({ method: 'GET', query: { prefix, 'max-keys': String(MAX_LIST) } })
  const versioningText = versioning.bytes.toString('utf8')
  const status = /<Status>(Enabled|Suspended)<\/Status>/.exec(versioningText)?.[1] || (versioning.status === 200 ? 'NeverEnabled' : `unknown(${versioning.status})`)
  const rules = lifecycle.status === 200 ? [...lifecycle.bytes.toString('utf8').matchAll(/<Rule>([\s\S]*?)<\/Rule>/g)].map(match => ({
    prefix: /<Prefix>([^<]*)<\/Prefix>/.exec(match[1])?.[1] ?? '', enabled: /<Status>Enabled<\/Status>/.test(match[1]),
    expiresCurrent: /<Expiration>/.test(match[1]), expiresNoncurrent: /<NoncurrentVersionExpiration>/.test(match[1])
  })) : []
  return {
    versioning: status,
    lifecycle: lifecycle.status === 200 ? rules : lifecycle.status === 404 ? 'none' : `unknown(${lifecycle.status})`,
    listable: list.status === 200,
    existingUnderTestPrefix: list.status === 200 ? (list.bytes.toString('utf8').match(/<Key>/g) || []).length : null
  }
}

// ---- write-once + version-id proof -----------------------------------------
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const validVersion = value => typeof value === 'string' && value !== '' && value !== 'null'

export function proofPlan({ bucket, endpoint, prefix }, runId) {
  const steps = [
    'T0 GET ?versioning, ?lifecycle, LIST prefix (read-only)',
    `T1 PUT ${prefix}${runId}/a.bin with x-oss-forbid-overwrite:true; record x-oss-version-id`,
    'T2 PUT the same key again (other bytes, forbid-overwrite): expect 409',
    'T3 GET the same key with versionId from T1: same bytes and same x-oss-version-id',
    'T4 GET the key without versionId: still the T1 bytes',
    `T5 ${CONCURRENCY} parallel PUTs of distinct bytes to ${prefix}${runId}/b.bin (forbid-overwrite): exactly one 200`,
    'T6 (only with --overwrite-control) two unprotected PUTs to c.bin: the second succeeds',
    'T7 (only with --cleanup) DELETE exactly the created objects/versions and confirm they are gone'
  ]
  return { bucket, endpoint, prefix, runId, steps, planHash: createHash('sha256').update(JSON.stringify({ bucket, endpoint, prefix, runId, steps })).digest('hex') }
}

export async function runWriteOnceProof(client, { prefix, runId, overwriteControl = false, cleanup = false, random = randomBytes }) {
  assert.match(runId, /^[a-f0-9]{16}$/, 'PROOF_RUN_ID_INVALID')
  const key = name => `${prefix}${runId}/${name}`
  const created = []
  const put = async (name, bytes, forbid) => {
    const result = await client.request({ method: 'PUT', key: key(name), headers: forbid ? { 'x-oss-forbid-overwrite': 'true' } : {}, body: bytes })
    if (result.status === 200) created.push({ key: key(name), version: result.headers['x-oss-version-id'] })
    return result
  }
  const get = (name, version) => client.request({ method: 'GET', key: key(name), query: version ? { versionId: version } : {} })
  const t = {}

  const first = random(BODY_BYTES)
  const t1 = await put('a.bin', first, true)
  const version = t1.headers['x-oss-version-id']
  t.t1 = { status: t1.status, versionIdPresent: validVersion(version) }
  const t2 = await put('a.bin', random(BODY_BYTES), true)
  t.t2 = { status: t2.status, refused: t2.status === 409 }
  if (validVersion(version)) {
    const t3 = await get('a.bin', version)
    t.t3 = { status: t3.status, sameBytes: t3.bytes.equals(first), sameVersionHeader: t3.headers['x-oss-version-id'] === version }
  } else t.t3 = { skipped: 'no usable version id from T1' }
  const t4 = await get('a.bin')
  t.t4 = { status: t4.status, stillFirstBytes: t4.bytes.equals(first) }

  const bodies = Array.from({ length: CONCURRENCY }, () => random(BODY_BYTES))
  const settled = await Promise.all(bodies.map(body => put('b.bin', body, true)))
  const winners = settled.map((result, index) => ({ result, index })).filter(item => item.result.status === 200)
  const t5read = await get('b.bin')
  t.t5 = {
    successes: winners.length, conflicts: settled.filter(result => result.status === 409).length, other: settled.filter(result => ![200, 409].includes(result.status)).length,
    survivorMatchesAWinner: winners.some(item => t5read.bytes.equals(bodies[item.index])),
    distinctVersionIds: new Set(winners.map(item => item.result.headers['x-oss-version-id']).filter(validVersion)).size
  }

  if (overwriteControl) {
    const one = await put('c.bin', random(BODY_BYTES), false)
    const two = await put('c.bin', random(BODY_BYTES), false)
    t.t6 = { firstStatus: one.status, secondStatus: two.status, unprotectedOverwriteWorks: one.status === 200 && two.status === 200 }
  }

  if (cleanup) {
    const failures = []
    for (const object of created.reverse()) {
      const query = validVersion(object.version) ? { versionId: object.version } : {}
      const result = await client.request({ method: 'DELETE', key: object.key, query })
      if (![200, 204, 404].includes(result.status)) failures.push(result.status)
    }
    const gone = await get('a.bin')
    t.t7 = { deleteFailures: failures.length, latestGone: [404].includes(gone.status) }
  }
  return { runId, checks: t, verdict: proofVerdict(t), createdObjects: created.length }
}

export function proofVerdict(t) {
  const errors = t.t1?.status !== 200 || t.t5?.other > 0
  if (errors) return { result: 'INCONCLUSIVE', reason: 'a required request failed (credentials, permissions or network); nothing can be concluded' }
  const writeOnce = t.t2.refused && t.t4.stillFirstBytes && t.t5.successes === 1 && t.t5.survivorMatchesAWinner
  const exactVersion = t.t1.versionIdPresent && t.t3?.status === 200 && t.t3.sameBytes && t.t3.sameVersionHeader
  if (writeOnce && exactVersion) return { result: 'PASS_BOTH', reason: 'forbid-overwrite is enforced and every successful PUT returns a usable version id that reads back exactly' }
  if (writeOnce) return { result: 'FAIL_NO_VERSION_ID', reason: 'write-once holds but no usable version id is returned (typical for a never-versioned bucket): the current Runtime contract (non-null exact version) cannot be satisfied' }
  if (exactVersion) return { result: 'FAIL_NOT_WRITE_ONCE', reason: 'version ids exist but forbid-overwrite is not enforced (typical for a versioned bucket): the same key can be replaced' }
  return { result: 'FAIL_NEITHER', reason: 'neither condition holds' }
}

// ---- CLI --------------------------------------------------------------------
function protectedJson(path) {
  const stat = statSync(path)
  assert.equal(stat.uid, process.getuid(), 'PROOF_CONFIG_OWNER')
  assert.equal(stat.mode & 0o077, 0, 'PROOF_CONFIG_PERMISSIONS')
  return JSON.parse(readFileSync(path, 'utf8'))
}

export async function main(argv = process.argv.slice(2), { fetchImpl, scheme, log = console.log, random } = {}) {
  const { values } = parseArgs({ args: argv, options: {
    config: { type: 'string' }, plan: { type: 'boolean', default: false }, 'write-proof': { type: 'boolean', default: false },
    confirm: { type: 'string' }, cleanup: { type: 'boolean', default: false }, 'overwrite-control': { type: 'boolean', default: false }, 'run-id': { type: 'string' }
  } })
  assert.ok(values.config, 'usage: snapshot-bucket-proof.mjs --config FILE [--plan | --write-proof --confirm HASH [--cleanup] [--overwrite-control]]')
  assert.ok(values['write-proof'] || (!values.cleanup && !values['overwrite-control']), 'PROOF_WRITE_FLAGS_REQUIRE_WRITE_PROOF')
  // A write run must reuse the run id whose --plan hash was reviewed.
  assert.ok(!values['write-proof'] || values['run-id'], 'PROOF_RUN_ID_REQUIRED_FOR_WRITE (use the runId printed by --plan)')
  const config = validateProofConfig(protectedJson(resolve(values.config)))
  const runId = values['run-id'] || randomBytes(8).toString('hex')
  const plan = proofPlan(config, runId)
  if (values.plan) { log(JSON.stringify(plan, null, 2)); return plan }
  const client = createOssClient(config, { fetchImpl, scheme })
  if (!values['write-proof']) {
    const report = await inspectBucket(client, config.prefix)
    log(JSON.stringify({ mode: 'read-only', bucket: config.bucket, ...report }, null, 2))
    return report
  }
  assert.equal(values.confirm, plan.planHash, 'PROOF_CONFIRM_HASH_MISMATCH (run --plan for the same --run-id and pass its planHash)')
  const inspection = await inspectBucket(client, config.prefix)
  const proof = await runWriteOnceProof(client, { prefix: config.prefix, runId, overwriteControl: values['overwrite-control'], cleanup: values.cleanup, random })
  const report = { mode: 'write-proof', bucket: config.bucket, prefix: config.prefix, inspection, ...proof }
  log(JSON.stringify(report, null, 2))
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(`PROOF_STOPPED:${String(error?.message || error).replace(/[A-Za-z0-9._~+/=-]{32,}/g, '[redacted]').slice(0, 200)}`)
  process.exitCode = 1
})
