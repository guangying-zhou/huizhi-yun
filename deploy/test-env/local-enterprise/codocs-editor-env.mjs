import { closeSync, constants, fstatSync, mkdtempSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const credentialPattern = /^[A-Za-z0-9_-]{32,256}$/

function privateJson(file) {
  let fd
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = fstatSync(fd)
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || info.size > 65_536) throw Error('Local Codocs service credential file is unsafe')
    return JSON.parse(readFileSync(fd, 'utf8'))
  } finally { if (fd !== undefined) closeSync(fd) }
}

// The Codocs editor reads its own service credential from process.env, so the
// private lane must inject it next to the Gateway credential. Both live only in
// a mode-0600 file inside a fresh 0700 directory that the caller removes when
// the editor exits; nothing is placed in argv, logs or committed configuration.
export function writeLocalCodocsEditorEnvFile({ profile, profilePath, root, gatewaySecret }) {
  if (profile.features?.workflowLocal !== true || profile.runtime.transportMode !== 'loopback'
    || profile.runtime.expectedTenant !== 'C000001' || profile.identity.codocsDeployment !== 'C000001-test-codocs'
    || profile.listeners.codocsEditor.host !== '127.0.0.1' || profile.listeners.codocsEditor.port !== 23130
    || profile.listeners.gatewayInternal.port !== 23121) throw Error('Local Codocs Console transport binding rejected')
  if (!credentialPattern.test(String(gatewaySecret || ''))) throw Error('Local Codocs Gateway credential is unavailable')
  let serviceSecret = ''
  try {
    serviceSecret = String(privateJson(resolve(root, 'deploy/test-env/.cloudflare-workers/codocs/secrets.json')).HZY_CODOCS_SERVICE_CLIENT_SECRET || '')
  } catch {
    throw Error('Local Codocs service credential is unavailable')
  }
  if (!credentialPattern.test(serviceSecret)) throw Error('Local Codocs service credential is unavailable')
  const parent = dirname(profilePath)
  const info = statSync(parent)
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw Error('Local Codocs private directory is unsafe')
  const directory = mkdtempSync(join(parent, 'codocs-editor-'))
  const path = join(directory, 'local.env')
  writeFileSync(path, [
    'HZY0_CODOCS_LOCAL_ONLY=true',
    'HZY0_LOCAL_ENTERPRISE=true',
    'HZY0_CONSOLE_EGRESS_URL=http://127.0.0.1:23121',
    `HZY0_GATEWAY_INTERNAL_TOKEN=${gatewaySecret}`,
    `HZY_CLOUDFLARE_INTERNAL_TOKEN=${gatewaySecret}`,
    `HZY_CODOCS_SERVICE_CLIENT_SECRET=${serviceSecret}`,
    'HZY_CODOCS_OSS_TIMEOUT_MS=30000'
  ].join('\n') + '\n', { mode: 0o600, flag: 'wx' })
  return { directory, path }
}
