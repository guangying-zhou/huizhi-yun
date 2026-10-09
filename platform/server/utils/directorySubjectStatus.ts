import { createHash } from 'node:crypto'

/** Matches Console's existing deterministic export identity; never a caller flag. */
export function isDirectoryProjectedUser(uid: string, externalRef: string | null) {
  return externalRef === createHash('sha256').update(`console:user:${uid}`).digest('hex')
}
