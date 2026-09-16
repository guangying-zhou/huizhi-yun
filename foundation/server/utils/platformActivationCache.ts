import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

export type PlatformActivationMode = 'pending' | 'active' | 'failed'

export interface PlatformCachedPolicyBundle {
  tenantCode: string
  deploymentCode: string
  bundleVersion: string
  bundleHash: string
  schemaVersion: string
  status: string
  generatedAt: string | null
  expiresAt: string | null
  signature: string
  kid: string
  alg: string
  signedAt: string | null
  payload: Record<string, unknown>
  cachedAt: string
}

export interface PlatformActivationStatus {
  mode: PlatformActivationMode
  activated: boolean
  envValid: boolean
  licenseValid: boolean
  bundleReady: boolean
  tenantCode: string | null
  deploymentCode: string | null
  bundleVersion: string | null
  bundleHash: string | null
  lastCheckedAt: string | null
  lastActivatedAt: string | null
  lastHeartbeatAt: string | null
  lastError: string | null
}

const BUNDLE_FILE = 'policy-bundle.json'
const STATUS_FILE = 'activation-status.json'

function resolveCacheDir(cacheDir: string) {
  return isAbsolute(cacheDir) ? cacheDir : resolve(process.cwd(), cacheDir)
}

async function ensureCacheDir(cacheDir: string) {
  const dir = resolveCacheDir(cacheDir)
  await mkdir(dir, { recursive: true })
  return dir
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

export function emptyPlatformActivationStatus(): PlatformActivationStatus {
  return {
    mode: 'pending',
    activated: false,
    envValid: false,
    licenseValid: false,
    bundleReady: false,
    tenantCode: null,
    deploymentCode: null,
    bundleVersion: null,
    bundleHash: null,
    lastCheckedAt: null,
    lastActivatedAt: null,
    lastHeartbeatAt: null,
    lastError: null
  }
}

export async function readCachedPlatformBundle(cacheDir: string) {
  const dir = resolveCacheDir(cacheDir)
  return readJsonFile<PlatformCachedPolicyBundle>(join(dir, BUNDLE_FILE))
}

export async function writeCachedPlatformBundle(cacheDir: string, bundle: PlatformCachedPolicyBundle) {
  const dir = await ensureCacheDir(cacheDir)
  await writeFile(join(dir, BUNDLE_FILE), JSON.stringify(bundle, null, 2), 'utf8')
}

export async function readPlatformActivationStatus(cacheDir: string) {
  const dir = resolveCacheDir(cacheDir)
  return await readJsonFile<PlatformActivationStatus>(join(dir, STATUS_FILE)) || emptyPlatformActivationStatus()
}

export async function writePlatformActivationStatus(cacheDir: string, status: PlatformActivationStatus) {
  const dir = await ensureCacheDir(cacheDir)
  await writeFile(join(dir, STATUS_FILE), JSON.stringify(status, null, 2), 'utf8')
}

export async function patchPlatformActivationStatus(cacheDir: string, patch: Partial<PlatformActivationStatus>) {
  const current = await readPlatformActivationStatus(cacheDir)
  const next = {
    ...current,
    ...patch
  }
  await writePlatformActivationStatus(cacheDir, next)
  return next
}
