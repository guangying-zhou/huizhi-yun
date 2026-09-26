import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

function readOwnerOnlyJson(path, field) {
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(fd)
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || info.size > 16_384) throw Error('unsafe')
    const value = JSON.parse(readFileSync(fd, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value[field] !== 'string' || !value[field].trim()) throw Error('invalid')
    return value[field]
  } catch {
    throw Error('Local Workflow credential provider is unavailable or unsafe')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function readLocalWorkflowClientSecret(profilePath) {
  return readOwnerOnlyJson(resolve(dirname(profilePath), 'workflow-client-secret.json'), 'HZY_SERVICE_CLIENT_SECRET')
}

export function readLocalAimsClientSecret(root) {
  return readOwnerOnlyJson(resolve(root, 'deploy/test-env/.cloudflare-workers/aims/secrets.json'), 'HZY_AIMS_SERVICE_CLIENT_SECRET')
}
