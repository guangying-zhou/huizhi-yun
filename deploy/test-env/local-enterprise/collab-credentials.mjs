import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * The collab.runtime client secret, read by the Gateway token bridge and the
 * Collab child. Collab holds no storage credential: v2 snapshot bytes go
 * through the Runtime. Never return this to CLI output.
 */
export function readCollabClientSecret(profilePath) {
  return readPrivateCredential(profilePath, 'collab-client-secret.json', ['COLLAB_SERVICE_CLIENT_SECRET']).COLLAB_SERVICE_CLIENT_SECRET
}

function readPrivateCredential(profilePath, filename, requiredFields) {
  const path = resolve(dirname(profilePath), filename)
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(fd)
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 16_384) throw Error('unsafe')
    const secrets = JSON.parse(readFileSync(fd, 'utf8'))
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)
      || Object.keys(secrets).length !== requiredFields.length
      || requiredFields.some(key => typeof secrets[key] !== 'string' || !secrets[key].trim())) throw Error('invalid')
    return secrets
  } catch {
    throw Error('Collab credential provider is unavailable or unsafe')
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
