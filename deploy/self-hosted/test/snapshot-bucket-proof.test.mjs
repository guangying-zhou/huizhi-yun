import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PROOF_PREFIX, createOssClient, inspectBucket, main, proofPlan, proofVerdict, runWriteOnceProof, signOssV1, validateProofConfig } from '../snapshot-bucket-proof.mjs'

const credentials = { accessKeyId: 'AKIDPROOFTEST', accessKeySecret: 'SECRETPROOFTEST/abcdefghijklmnopqrstuvwxyz0123' }
const config = { bucket: 'hzy-proof-bucket', endpoint: 'oss-cn-test.example.invalid', ...credentials }

// In-process fake OSS: verifies the V1 signature and emulates the four bucket behaviours.
//   never-versioned: forbid-overwrite enforced, no version id
//   versioned: version ids, forbid-overwrite ignored (real OSS behaviour on versioned buckets)
//   ideal: both (hypothetical), broken: every request denied
function fakeOss(mode) {
  const objects = new Map()
  const log = []
  let serial = 0
  const fetchImpl = async (url, init) => {
    const target = new URL(url)
    const key = decodeURIComponent(target.pathname.slice(1))
    const query = Object.fromEntries(target.searchParams)
    const headers = Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]))
    log.push({ method: init.method, key, query: { ...query }, forbid: headers['x-oss-forbid-overwrite'] === 'true' })
    const expected = signOssV1({ secret: credentials.accessKeySecret, method: init.method, contentType: headers['content-type'] || '', date: headers.date, headers,
      bucket: config.bucket, key, query })
    if (mode === 'broken' || headers.authorization !== `OSS ${credentials.accessKeyId}:${expected}`) return new Response('denied', { status: 403 })
    const versions = objects.get(key) || []
    const reply = (status, body = '', extra = {}) => new Response([204, 205, 304].includes(status) ? null : body, { status, headers: extra })
    if (init.method === 'GET' && !key) {
      if ('versioning' in query) return reply(200, mode === 'never-versioned' ? '<VersioningConfiguration></VersioningConfiguration>' : '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>')
      if ('lifecycle' in query) return reply(200, '<LifecycleConfiguration><Rule><Prefix>codocs/</Prefix><Status>Enabled</Status><NoncurrentVersionExpiration><NoncurrentDays>30</NoncurrentDays></NoncurrentVersionExpiration></Rule></LifecycleConfiguration>')
      return reply(200, `<ListBucketResult>${[...objects.keys()].map(name => `<Contents><Key>${name}</Key></Contents>`).join('')}</ListBucketResult>`)
    }
    if (init.method === 'PUT') {
      const forbid = headers['x-oss-forbid-overwrite'] === 'true'
      if (forbid && mode !== 'versioned' && versions.length) return reply(409, '<Error><Code>FileAlreadyExists</Code></Error>')
      const version = mode === 'never-versioned' ? undefined : `v${++serial}${randomBytes(4).toString('hex')}`
      versions.push({ version, bytes: Buffer.from(init.body) })
      objects.set(key, versions)
      return reply(200, '', version ? { 'x-oss-version-id': version } : {})
    }
    if (init.method === 'GET') {
      const found = query.versionId ? versions.find(item => item.version === query.versionId) : versions.at(-1)
      return found ? reply(200, found.bytes, found.version ? { 'x-oss-version-id': found.version } : {}) : reply(404)
    }
    if (init.method === 'DELETE') {
      if (query.versionId) objects.set(key, versions.filter(item => item.version !== query.versionId))
      else objects.delete(key)
      if (!objects.get(key)?.length) objects.delete(key)
      return reply(204)
    }
    return reply(405)
  }
  return { fetchImpl, log, objects }
}

const run = (mode, options = {}) => {
  const fake = fakeOss(mode)
  const client = createOssClient(config, { fetchImpl: fake.fetchImpl })
  return { fake, promise: runWriteOnceProof(client, { prefix: PROOF_PREFIX, runId: 'a'.repeat(16), ...options }) }
}

test('V1 signature matches the documented Aliyun OSS example', () => {
  assert.equal(signOssV1({ secret: 'OtxrzxIsfpFjA7SwPzILwy8Bw21TLhquhboDYROV', method: 'PUT', contentMd5: 'ODBGOERFMDMzQTczRUY3NUE3NzA5QzdFNUYzMDQxNEM=', contentType: 'text/html',
    date: 'Thu, 17 Nov 2005 18:49:58 GMT', headers: { 'X-OSS-Meta-Author': 'foo@bar.com', 'X-OSS-Magic': 'abracadabra' }, bucket: 'oss-example', key: 'nelson' }),
  '26NBxoKdsyly4EDv6inkoDft/yA=')
})

test('verdict is PASS only when write-once and an exact version id hold together', async () => {
  const ideal = await run('ideal').promise
  assert.equal(ideal.verdict.result, 'PASS_BOTH')
  assert.equal(ideal.checks.t5.successes, 1)
  const never = await run('never-versioned').promise
  assert.equal(never.verdict.result, 'FAIL_NO_VERSION_ID')
  assert.equal(never.checks.t1.versionIdPresent, false)
  assert.equal(never.checks.t2.refused, true)
  const versioned = await run('versioned').promise
  assert.equal(versioned.verdict.result, 'FAIL_NOT_WRITE_ONCE')
  assert.equal(versioned.checks.t2.status, 200, 'forbid-overwrite is ignored on a versioned bucket')
  assert.ok(versioned.checks.t5.successes > 1)
  assert.equal((await run('broken').promise).verdict.result, 'INCONCLUSIVE')
  assert.equal(proofVerdict({ t1: { status: 200, versionIdPresent: false }, t2: { refused: false }, t3: { skipped: 'x' }, t4: { stillFirstBytes: false }, t5: { successes: 8, survivorMatchesAWinner: true, other: 0 } }).result, 'FAIL_NEITHER')
})

test('a "null" version id is not usable', async () => {
  const fake = fakeOss('ideal')
  const nullish = async (url, init) => {
    const response = await fake.fetchImpl(url, init)
    if (init.method !== 'PUT') return response
    return new Response('', { status: response.status, headers: { 'x-oss-version-id': 'null' } })
  }
  const outcome = await runWriteOnceProof(createOssClient(config, { fetchImpl: nullish }), { prefix: PROOF_PREFIX, runId: 'b'.repeat(16) })
  assert.equal(outcome.checks.t1.versionIdPresent, false)
})

test('writes stay under the dedicated prefix and cleanup removes exactly what was created', async () => {
  const { fake, promise } = run('ideal', { cleanup: true, overwriteControl: true })
  const outcome = await promise
  assert.equal(outcome.checks.t6.unprotectedOverwriteWorks, true, 'control: an unprotected PUT can overwrite')
  assert.equal(outcome.checks.t7.deleteFailures, 0)
  assert.equal(outcome.checks.t7.latestGone, true)
  const writes = fake.log.filter(entry => entry.method !== 'GET')
  assert.ok(writes.length > 0 && writes.every(entry => entry.key.startsWith(`${PROOF_PREFIX}${'a'.repeat(16)}/`)))
  assert.equal(fake.objects.size, 0, 'nothing left behind after cleanup')
  const noCleanup = run('ideal')
  await noCleanup.promise
  assert.ok(noCleanup.fake.objects.size > 0)
  assert.ok(!noCleanup.fake.log.some(entry => entry.method === 'DELETE'), 'no delete without --cleanup')
  assert.ok(!noCleanup.fake.log.some(entry => entry.key.endsWith('c.bin')), 'no unprotected PUT without --overwrite-control')
})

test('inspection is read-only and reports versioning and lifecycle', async () => {
  const fake = fakeOss('versioned')
  const report = await inspectBucket(createOssClient(config, { fetchImpl: fake.fetchImpl }), PROOF_PREFIX)
  assert.deepEqual(fake.log.map(entry => entry.method), ['GET', 'GET', 'GET'])
  assert.equal(report.versioning, 'Enabled')
  assert.deepEqual(report.lifecycle, [{ prefix: 'codocs/', enabled: true, expiresCurrent: false, expiresNoncurrent: true }])
  assert.equal(report.listable, true)
  const never = await inspectBucket(createOssClient(config, { fetchImpl: fakeOss('never-versioned').fetchImpl }), PROOF_PREFIX)
  assert.equal(never.versioning, 'NeverEnabled')
})

test('configuration must be a dedicated bucket prefix outside the production namespace', () => {
  assert.equal(validateProofConfig(config).prefix, PROOF_PREFIX)
  for (const testPrefix of ['codocs/snapshots/', '/codocs/', 'recycle.bin/', 'other/', '_write-once-proof/../codocs/', '_write-once-proof//x/', '']) {
    assert.throws(() => validateProofConfig({ ...config, testPrefix }), /PROOF_PREFIX/, testPrefix)
  }
  assert.doesNotThrow(() => validateProofConfig({ ...config, testPrefix: '_write-once-proof/2026-10/' }))
  for (const bad of [{ endpoint: 'https://oss.example/' }, { endpoint: 'oss.example/path' }, { bucket: 'Bad_Bucket' }, { accessKeySecret: '' }])
    assert.throws(() => validateProofConfig({ ...config, ...bad }))
})

test('CLI: default is read-only, --plan touches no network, writes need the reviewed hash and a 0600 config', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hzy-proof-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'proof.json')
  await writeFile(file, JSON.stringify(config))
  await chmod(file, 0o600)
  const output = []
  const log = line => output.push(line)
  const failing = async () => { throw Error('network must not be used') }

  await main(['--config', file, '--plan', '--run-id', 'c'.repeat(16)], { fetchImpl: failing, log })
  const plan = JSON.parse(output.pop())
  assert.equal(plan.planHash, proofPlan(validateProofConfig(config), 'c'.repeat(16)).planHash)
  assert.ok(!JSON.stringify(plan).includes(credentials.accessKeySecret))

  const fake = fakeOss('never-versioned')
  await main(['--config', file], { fetchImpl: fake.fetchImpl, log })
  assert.ok(fake.log.every(entry => entry.method === 'GET'), 'default mode issues only GET requests')
  assert.ok(!output.join('').includes(credentials.accessKeySecret))

  const write = fakeOss('never-versioned')
  await assert.rejects(main(['--config', file, '--write-proof', '--run-id', 'c'.repeat(16)], { fetchImpl: write.fetchImpl, log }), /PROOF_CONFIRM_HASH_MISMATCH/)
  await assert.rejects(main(['--config', file, '--write-proof', '--confirm', plan.planHash], { fetchImpl: write.fetchImpl, log }), /PROOF_RUN_ID_REQUIRED_FOR_WRITE/)
  await assert.rejects(main(['--config', file, '--cleanup'], { fetchImpl: write.fetchImpl, log }), /PROOF_WRITE_FLAGS_REQUIRE_WRITE_PROOF/)
  assert.equal(write.log.length, 0, 'refused write runs sent nothing')
  const report = await main(['--config', file, '--write-proof', '--run-id', 'c'.repeat(16), '--confirm', plan.planHash, '--cleanup'], { fetchImpl: write.fetchImpl, log })
  assert.equal(report.verdict.result, 'FAIL_NO_VERSION_ID')
  assert.ok(!output.join('').includes(credentials.accessKeySecret))
  assert.ok(write.log.filter(entry => entry.method !== 'GET').every(entry => entry.key.startsWith(PROOF_PREFIX)))

  await chmod(file, 0o644)
  await assert.rejects(main(['--config', file], { fetchImpl: failing, log }), /PROOF_CONFIG_PERMISSIONS/)
})
