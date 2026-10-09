import { statfs } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MINIMUM_FREE_BYTES = 20n * 1024n ** 3n

// Budget is additional space still needed, including rollback and log growth.
// Existing files are already reflected in bavail; never count total/free blocks.
export async function inspectDiskSpace(path, budget = {}, readStats = statfs) {
  const keys = ['backupBytes', 'stagingBytes', 'logBytes', 'safetyBytes']
  try {
    if (!isAbsolute(path) || Object.keys(budget).some(key => !keys.includes(key))) throw new Error()
    let estimate = 0n
    for (const key of keys) {
      const value = budget[key] ?? '0'
      if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) throw new Error()
      estimate += BigInt(value)
    }
    const required = estimate > MINIMUM_FREE_BYTES ? estimate : MINIMUM_FREE_BYTES
    const stats = await readStats(path, { bigint: true })
    if (typeof stats.bavail !== 'bigint' || typeof stats.bsize !== 'bigint' || stats.bavail < 0n || stats.bsize <= 0n) throw new Error()
    const available = stats.bavail * stats.bsize
    return { ready: available >= required, code: available >= required ? 'ok' : 'disk_space_insufficient', availableBytes: available.toString(), requiredBytes: required.toString(), estimatedBytes: estimate.toString() }
  } catch {
    return { ready: false, code: 'disk_space_check_failed' }
  }
}

export async function run(args) {
  if (args.length < 2 || args.length % 2 !== 0 || args[0] !== '--path') throw new Error('disk_space_arguments_invalid')
  const budget = {}
  const flags = { '--backup-bytes': 'backupBytes', '--staging-bytes': 'stagingBytes', '--log-bytes': 'logBytes', '--safety-bytes': 'safetyBytes' }
  for (let i = 2; i < args.length; i += 2) {
    const key = flags[args[i]]
    if (!key || Object.hasOwn(budget, key)) throw new Error('disk_space_arguments_invalid')
    budget[key] = args[i + 1]
  }
  const result = await inspectDiskSpace(args[1], budget)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result.ready ? 0 : 1
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code }).catch(() => {
    process.stderr.write('disk_space_arguments_invalid\n')
    process.exitCode = 1
  })
}
