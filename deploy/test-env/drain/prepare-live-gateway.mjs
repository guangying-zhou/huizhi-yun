// Read-only exact active Gateway export and no-bundle drain candidate preparation.
// It neither uploads nor deploys and never exports secret values.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

const output = process.argv[2]
const expectedVersion = process.argv[3] || '0979bab5-8f46-4e06-b8f1-f5aa1be7cabb'
if (!output) throw Error('EXPLICIT_NEW_OUTPUT_DIRECTORY_REQUIRED')
const directory = resolve(output)
await mkdir(dirname(directory), { recursive: true, mode: 0o700 })
await mkdir(directory, { mode: 0o700 })

const wranglerLogin = await readFile(resolve(homedir(), 'Library/Preferences/.wrangler/config/default.toml'), 'utf8')
const token = wranglerLogin.match(/^oauth_token\s*=\s*"([^"\r\n]+)"/m)?.[1]
if (!token) throw Error('EXISTING_WRANGLER_LOGIN_REQUIRED')
async function request(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000)
  })
  if (!response.ok) throw Error(`READ_ONLY_CLOUDFLARE_EXPORT_HTTP_${response.status}`)
  return response
}
async function api(path) {
  const body = await (await request(path)).json()
  if (!body.success) throw Error('READ_ONLY_CLOUDFLARE_EXPORT_FAILED')
  return body.result
}

const accounts = await api('/accounts?per_page=50')
if (accounts.length !== 1) throw Error('EXACT_EXISTING_ACCOUNT_REQUIRED')
const accountId = accounts[0].id
const worker = 'hzy-test-gateway'
const base = `/accounts/${accountId}/workers/scripts/${worker}`
const deploymentsBefore = await api(`${base}/deployments`)
const active = [...deploymentsBefore.deployments].sort((a, b) => String(b.created_on).localeCompare(String(a.created_on)))[0]
if (!active || active.versions.length !== 1 || active.versions[0].percentage !== 100) throw Error('SINGLE_100_PERCENT_ACTIVE_VERSION_REQUIRED')
const originalVersionId = active.versions[0].version_id
if (originalVersionId !== expectedVersion) throw Error(`CURRENT_GATEWAY_VERSION_MISMATCH:${originalVersionId}`)
const version = await api(`${base}/versions/${originalVersionId}`)
const settings = await api(`${base}/settings`)
const resources = version.resources
const existingBindings = resources.bindings || []
const hasEnterpriseAuth = existingBindings.some(binding => binding.name === 'HZY_ENTERPRISE_AUTH_PILOT')
if (!hasEnterpriseAuth) throw Error('ENTERPRISE_AUTH_BINDING_MISSING_FROM_ACTIVE_VERSION')

const content = await request(`${base}/content/v2?version=${originalVersionId}`)
const entry = content.headers.get('cf-entrypoint')
if (!entry || !content.headers.get('content-type')?.startsWith('multipart/form-data')) throw Error('EXACT_VERSION_MODULE_EXPORT_REQUIRED')
const originalDirectory = resolve(directory, 'original')
await mkdir(originalDirectory, { mode: 0o700 })
const mimeTypes = {
  'application/javascript+module': 'ESModule',
  'application/javascript': 'CommonJS',
  'application/wasm': 'CompiledWasm',
  'text/plain': 'Text',
  'application/octet-stream': 'Data',
  'application/json': 'Data',
  'application/source-map': 'Data'
}
const modules = []
const rules = []
for (const [name, file] of (await content.formData()).entries()) {
  if (typeof file === 'string' || name.startsWith('/') || name.split('/').some(part => part === '..') || !mimeTypes[file.type]) throw Error('UNSUPPORTED_EXPORTED_MODULE')
  const path = resolve(originalDirectory, name)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const bytes = Buffer.from(await file.arrayBuffer())
  await writeFile(path, bytes, { mode: 0o600 })
  modules.push({ name, type: file.type, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  rules.push({ type: mimeTypes[file.type], globs: [`original/${name}`], fallthrough: true })
}
if (!modules.some(module => module.name === entry)) throw Error('EXPORTED_ENTRYPOINT_MISSING')

const controlProxy = await readFile(new URL('./control-proxy.mjs', import.meta.url), 'utf8')
await writeFile(resolve(directory, 'control-proxy.mjs'), controlProxy, { mode: 0o600 })
const drainEntry = `import originalWorker from ${JSON.stringify(`./original/${entry}`)}\nexport * from ${JSON.stringify(`./original/${entry}`)}\nimport { drainControlResponse } from './control-proxy.mjs'\n\nconst drainPrefix = '/__test/drain/'\nconst testHost = 'hzy-test.huizhi.yun'\nexport default new Proxy(originalWorker, {\n  get(target, property, receiver) {\n    if (property !== 'fetch') return Reflect.get(target, property, receiver)\n    const originalFetch = Reflect.get(target, property, receiver)\n    return async (request, env, context) => {\n      const url = new URL(request.url)\n      if (url.hostname === testHost && url.pathname.startsWith(drainPrefix)) return drainControlResponse(request, env)\n      return originalFetch.call(target, request, env, context)\n    }\n  }\n})\n`
await writeFile(resolve(directory, 'drain-entry.mjs'), drainEntry, { mode: 0o600 })

const preservedBindings = existingBindings
  .filter(binding => !['secret_text', 'secret_key'].includes(binding.type) && !['HZY_DRAIN_COORDINATOR', 'HZY_TEST_DRAIN_CONTROL_ENABLED'].includes(binding.name))
  .map(binding => ({ name: binding.name, type: 'inherit' }))
const metadata = { keep_assets: true, keep_bindings: ['secret_text', 'secret_key'] }
for (const key of ['usage_model', 'placement', 'tags', 'tail_consumers', 'logpush', 'observability', 'limits']) if (settings[key] !== undefined) metadata[key] = settings[key]
const wrangler = {
  name: worker,
  account_id: accountId,
  main: './drain-entry.mjs',
  workers_dev: false,
  preview_urls: false,
  no_bundle: true,
  find_additional_modules: true,
  compatibility_date: resources.script_runtime.compatibility_date,
  compatibility_flags: resources.script_runtime.compatibility_flags,
  rules: [{ type: 'ESModule', globs: ['drain-entry.mjs', 'control-proxy.mjs'], fallthrough: true }, ...rules],
  services: [{ binding: 'HZY_DRAIN_COORDINATOR', service: 'hzy-test-drain-coordinator' }],
  vars: { HZY_TEST_DRAIN_CONTROL_ENABLED: 'true' },
  unsafe: { bindings: preservedBindings, metadata }
}
await writeFile(resolve(directory, 'wrangler.json'), JSON.stringify(wrangler, null, 2) + '\n', { mode: 0o600 })

const deploymentsAfter = await api(`${base}/deployments`)
if (JSON.stringify(deploymentsAfter.deployments) !== JSON.stringify(deploymentsBefore.deployments)) throw Error('SOURCE_DEPLOYMENT_CHANGED_DURING_EXPORT')
const moduleBytes = modules.reduce((total, module) => total + module.bytes, 0)
const manifest = {
  schemaVersion: 'test-gateway-drain-candidate.v1',
  observedAt: new Date().toISOString(),
  worker,
  tenant: 'C000001',
  environment: 'test',
  originalVersionId,
  originalDeploymentId: active.id,
  originalTrafficPercentage: active.versions[0].percentage,
  sourceExport: { entry, modules, moduleBytes, exactByteComparison: true },
  preserved: {
    enterpriseAuthBinding: true,
    nonSecretBindings: preservedBindings.map(binding => binding.name),
    secretBindings: existingBindings.filter(binding => ['secret_text', 'secret_key'].includes(binding.type)).map(binding => binding.name),
    assets: true,
    workersDev: false,
    previewUrls: false,
    metadata: Object.keys(metadata),
    compatibility: true
  },
  changes: [
    { kind: 'service_binding', name: 'HZY_DRAIN_COORDINATOR', service: 'hzy-test-drain-coordinator' },
    { kind: 'plain_text', name: 'HZY_TEST_DRAIN_CONTROL_ENABLED', value: 'true' },
    { kind: 'entrypoint', path: '/__test/drain/', behavior: 'control-proxy only; all non-drain fetches and other default-export handlers transparently use original Worker' }
  ],
  uploaded: false,
  deployed: false,
  rollback: { versionId: originalVersionId, percentage: 100 },
  reviewRequired: true
}
await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ prepared: true, uploaded: false, deployed: false, directory, originalVersionId, modules: modules.length, moduleBytes, exactByteComparison: true, enterpriseAuthPreserved: true, rollback: manifest.rollback }))
