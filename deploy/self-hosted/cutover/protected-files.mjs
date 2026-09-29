import { constants } from 'node:fs'
import { closeSync, fstatSync, fsyncSync, lstatSync, openSync, readSync, writeSync, linkSync, unlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

export const MAX_FILE_BYTES = 32 * 1024 * 1024
export const MAX_PACKAGE_BYTES = 128 * 1024 * 1024
const NOFOLLOW = constants.O_NOFOLLOW

function fail(code) { throw new Error(code) }
function secureDir(path) {
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) fail('EVIDENCE_DIRECTORY_UNPROTECTED')
  return stat
}
function secureFile(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) fail('EVIDENCE_FILE_UNPROTECTED')
  if (stat.size > MAX_FILE_BYTES) fail('EVIDENCE_FILE_TOO_LARGE')
}
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs }
function sameDir(a, b) { return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && (a.mode & 0o777) === (b.mode & 0o777) }

export function localName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) || name === '.' || name === '..' || basename(name) !== name) fail('EVIDENCE_FILE_NAME')
  return name
}

export function readProtectedFile(path) {
  if (!Number.isInteger(NOFOLLOW)) fail('EVIDENCE_NOFOLLOW_UNAVAILABLE')
  const file = resolve(path)
  const parent = dirname(file)
  const dirBefore = secureDir(parent)
  const before = lstatSync(file)
  secureFile(before)
  let fd
  try {
    fd = openSync(file, constants.O_RDONLY | NOFOLLOW | constants.O_NONBLOCK)
    const opened = fstatSync(fd)
    secureFile(opened)
    if (!sameFile(before, opened)) fail('EVIDENCE_FILE_REPLACED')
    const bytes = Buffer.alloc(opened.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset)
      if (count === 0) fail('EVIDENCE_FILE_TRUNCATED')
      offset += count
    }
    if (!sameFile(opened, fstatSync(fd)) || !sameFile(opened, lstatSync(file)) || !sameDir(dirBefore, secureDir(parent))) fail('EVIDENCE_FILE_REPLACED')
    return bytes
  } finally { if (fd !== undefined) closeSync(fd) }
}

export function readCredential(directory = process.env.CREDENTIALS_DIRECTORY) {
  if (!directory || typeof directory !== 'string') fail('EVIDENCE_CREDENTIAL_DIRECTORY_MISSING')
  const bytes = readProtectedFile(join(resolve(directory), 'offline-drain-hmac'))
  if (bytes.length !== 32) fail('EVIDENCE_CREDENTIAL_LENGTH')
  return bytes
}

export function writeProtectedNew(path, bytes) {
  if (!Number.isInteger(NOFOLLOW)) fail('EVIDENCE_NOFOLLOW_UNAVAILABLE')
  const target = resolve(path), parent = dirname(target)
  const dirBefore = secureDir(parent)
  const content = Buffer.from(bytes)
  if (content.length > MAX_FILE_BYTES) fail('EVIDENCE_FILE_TOO_LARGE')
  const temp = join(parent, `.cutover-${randomBytes(12).toString('hex')}.tmp`)
  let fd
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600)
    let offset = 0
    while (offset < content.length) offset += writeSync(fd, content, offset, content.length - offset, offset)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    if (!sameDir(dirBefore, secureDir(parent))) fail('EVIDENCE_DIRECTORY_REPLACED')
    linkSync(temp, target) // EEXIST: never overwrite a reviewed package.
    const dirFd = openSync(parent, constants.O_RDONLY | NOFOLLOW)
    try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
    return target
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(temp) } catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
}
