import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, symlink } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

export const APPS = Object.freeze(['gateway', 'console', 'workflow', 'enterprise', 'aims', 'codocs', 'collab', 'platform'])
export const BASE_PATHS = Object.freeze({ gateway: '/', console: '/console/', workflow: '/workflow/', enterprise: '/enterprise/', aims: '/aims/', codocs: '/codocs/', collab: '/codocs/', platform: '/' })
export const PORTS = Object.freeze({ gatewayIngress: 8780, gatewayHealth: 8781, runtime: 31080, console: 31001, enterprise: 31002, workflow: 31003, aims: 31004, codocs: 31005, platform: 31006, collab: 31007 })

export function safeName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) || value === '.' || value === '..') throw Error('invalid release name')
  return value
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function regularFiles(root, dir = root) {
  const result = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) throw Error(`symlink in release: ${relative(root, path)}`)
    if (entry.isDirectory()) result.push(...await regularFiles(root, path))
    else if (entry.isFile()) result.push(relative(root, path).split(sep).join('/'))
    else throw Error(`unsupported release entry: ${relative(root, path)}`)
  }
  return result.sort()
}

export async function createManifest(dir, { app, version, commit, nodeVersion }) {
  if (!APPS.includes(app)) throw Error('unknown application')
  safeName(version)
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('commit must be a full SHA')
  const files = {}
  for (const path of await regularFiles(dir)) {
    if (path === 'manifest.json') throw Error('source contains manifest.json')
    files[path] = await sha256File(join(dir, path))
  }
  if (!Object.keys(files).length || (app !== 'gateway' && !files['.output/server/index.mjs']) || (app === 'gateway' && !files['deploy/self-hosted/gateway/server.mjs'])) throw Error('release payload incomplete')
  return { schema: 'hzy-self-hosted-release.v1', app, version, commit, nodeVersion, os: process.platform, arch: process.arch, preset: app === 'gateway' ? 'node' : 'node-server', files }
}

// Standalone Collab ships as one self-contained bundle. It must carry neither
// configuration values nor key material: everything is read from
// /etc/hzy/collab.env at start (COLLAB_SERVICE_CLIENT_SECRET included).
const COLLAB_FORBIDDEN_FILE = /(^|\/)(\.env[^/]*|[^/]+\.(pem|key|p12|pfx)|[^/]*credentials?[^/]*\.json)$/i
const COLLAB_LITERAL_SECRET = /COLLAB_SERVICE_CLIENT_SECRET['"]?\s*[:=]\s*['"][^'"\s]{8,}['"]/
export async function verifyCollabPayload(dir, files) {
  for (const required of ['.output/server/index.mjs', '.output/package.json']) if (!files.includes(required)) throw Error(`collab release is missing ${required}`)
  const forbidden = files.find(path => COLLAB_FORBIDDEN_FILE.test(path))
  if (forbidden) throw Error(`collab release contains a configuration or key file: ${forbidden}`)
  if (COLLAB_LITERAL_SECRET.test(await readFile(join(dir, '.output/server/index.mjs'), 'utf8'))) throw Error('collab bundle embeds a client secret literal')
}

export async function verifyManifest(dir, expected = {}) {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  if (manifest.schema !== 'hzy-self-hosted-release.v1' || !APPS.includes(manifest.app)) throw Error('release schema or app invalid')
  safeName(manifest.version)
  if (!/^[a-f0-9]{40}$/.test(manifest.commit) || !/^v24\.18\.0$/.test(manifest.nodeVersion)) throw Error('release source or Node version invalid')
  if (manifest.os !== process.platform || manifest.arch !== process.arch) throw Error('release OS/architecture mismatch')
  if (manifest.preset !== (manifest.app === 'gateway' ? 'node' : 'node-server')) throw Error('non-node-server artifact')
  for (const key of ['app', 'version', 'commit']) if (expected[key] && manifest[key] !== expected[key]) throw Error(`release ${key} mismatch`)
  const actual = (await regularFiles(dir)).filter(path => path !== 'manifest.json')
  const listed = Object.keys(manifest.files || {}).sort()
  if (JSON.stringify(actual) !== JSON.stringify(listed)) throw Error('release file list differs from manifest')
  for (const path of actual) {
    if (!/^[a-f0-9]{64}$/.test(manifest.files[path]) || await sha256File(join(dir, path)) !== manifest.files[path]) throw Error(`release file hash mismatch: ${path}`)
  }
  if (manifest.app === 'collab') await verifyCollabPayload(dir, actual)
  return manifest
}

async function atomicLink(target, current) {
  const temporary = `${current}.next-${process.pid}`
  await rm(temporary, { force: true })
  await symlink(target, temporary)
  await rename(temporary, current)
}

export async function publishDirectory({ root, app, version, staged, restart, health, keep = 5 }) {
  if (!APPS.includes(app)) throw Error('unknown application')
  safeName(version)
  await verifyManifest(staged, { app, version })
  const appRoot = resolve(root, app)
  const releases = join(appRoot, 'releases')
  const destination = join(releases, version)
  const current = join(appRoot, 'current')
  await mkdir(releases, { recursive: true })
  let previous = null
  try {
    previous = await readlink(current)
    if (!previous.startsWith('releases/') || previous.includes('..')) throw Error('current link target invalid')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (await lstat(destination).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) throw Error('release version already exists')
  await rename(staged, destination)
  try {
    await verifyManifest(destination, { app, version })
    await atomicLink(`releases/${version}`, current)
    await restart(app)
    await health(app)
  } catch (error) {
    if (previous) await atomicLink(previous, current)
    else await rm(current, { force: true })
    await restart(app).catch(() => {})
    throw error
  }
  const entries = (await readdir(releases, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().reverse()
  const protectedNames = new Set([version, previous?.slice('releases/'.length)])
  let retained = 0
  for (const name of entries) {
    if (protectedNames.has(name) || retained++ < keep) continue
    await rm(join(releases, name), { recursive: true, force: true })
  }
  return { app, version, previous }
}
