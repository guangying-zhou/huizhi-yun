#!/usr/bin/env node
// Local artifact generation only. No credentials, network, SQL or deployment.
import { spawnSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, relative } from 'node:path'
const root = resolve(import.meta.dirname, '../..')
const planPath = resolve(process.argv[2] || resolve(import.meta.dirname, 'artifacts/C000001.enterprise-migration-plan.json'))
const outDir = resolve(process.argv[3] || resolve(import.meta.dirname, 'artifacts'))
const plan = JSON.parse(await readFile(planPath, 'utf8'))
if (!/^[A-Za-z0-9_-]+$/.test(plan.Config?.Tenant)) throw Error('Invalid candidate tenant')
const prefix = resolve(outDir, `${plan.Config.Tenant}.enterprise-`)
const runtimePath = `${prefix}runtime.candidate.json`
let runtime
try { runtime = JSON.parse(await readFile(runtimePath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
if (runtime && (runtime.deployable !== false || runtime.enterprise?.enabled !== false || runtime.enterprise.db?.database !== plan.Config.Target || runtime.enterprise.db?.password)) {
  throw Error('Existing Runtime candidate must be disabled, secret-free and target-bound')
}
const result = spawnSync('go', ['run', './cmd/hzy-enterprise-candidates', '--plan', planPath, '--out-dir', outDir], { cwd: resolve(root, 'data-runtime'), stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
const candidate = JSON.parse(await readFile(`${prefix}composition.candidate.json`, 'utf8'))
const sources = []
for (const name of ['enterpriseplanning', 'enterpriseassets', 'enterprisescheduler']) {
  const directory = resolve(root, 'data-runtime/internal', name)
  for (const entry of (await readdir(directory)).sort()) {
    if (!entry.endsWith('.go') || entry.endsWith('_test.go')) continue
    const path = resolve(directory, entry)
    const raw = await readFile(path)
    sources.push({ path: relative(root, path), sha256: createHash('sha256').update(raw).digest('hex') })
  }
}
const metadata = {
  sourceReviewHash: candidate.sourceReviewHash, sourceArtifactSha256: candidate.sourceArtifactSha256,
  candidateOnly: true, targetVerified: false, installed: false,
  domains: Object.fromEntries(['aims', 'assets'].map(domain => [domain, candidate.views.filter(view => view.Domain === domain).map(view => view.Name)])),
  sources
}
await writeFile(`${prefix}compatibility-views.sources.json`, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })
if (runtime) {
  runtime.sourceReviewHash = candidate.sourceReviewHash
  runtime.sourceArtifactSha256 = candidate.sourceArtifactSha256
  runtime.targetVerified = false
  runtime.businessMigrationApplied = false
  runtime.requiredBeforeEnable = candidate.activationPrerequisites
  runtime.blockers = candidate.blockers
  for (const domain of ['aims', 'assets']) {
    if (!runtime.enterprise.domains?.[domain]?.ownerDeployment) throw Error('Explicit Runtime domain owner missing')
    runtime.enterprise.domains[domain].tables = candidate.physicalMappings[domain]
  }
  runtime.enterprise.environment = candidate.config.Environment
  runtime.enterprise.schemaVersion = candidate.config.SchemaVersion
  runtime.enterprise.generation = candidate.config.Generation
  runtime.enterprise.instanceId = candidate.config.InstanceID
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o600 })
}
// Refresh the preparation inventory only when one already exists. Its hashes
// attest local file bytes; they do not attest installation or an active target.
const manifestPath = `${prefix}preparation.manifest.json`
let manifest
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
if (manifest) {
  if (manifest.tenantCode !== plan.Config.Tenant || !Array.isArray(manifest.files)) throw Error('Invalid preparation inventory')
  const paths = new Set(manifest.files.map(file => file.path))
  paths.add(relative(root, `${prefix}composition.candidate.json`))
  const files = []
  for (const path of paths) {
    const absolute = resolve(root, path)
    if (absolute !== resolve(outDir, absolute.split('/').at(-1))) throw Error('Preparation inventory contains a non-candidate file')
    const raw = await readFile(absolute)
    files.push({ path, sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.length })
  }
  manifest.files = files
  manifest.businessMigrationApplied = false
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
}
