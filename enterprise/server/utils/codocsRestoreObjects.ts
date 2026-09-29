import { createError } from 'h3'

type RestoreClient = {
  head: (key: string) => Promise<unknown>
  get: (key: string) => Promise<{ content: Buffer | Uint8Array }>
  put: (key: string, body: Buffer | Uint8Array, options: { forbidOverwrite: boolean }) => Promise<unknown>
}
export type RestoreStage = 'head' | 'get' | 'put' | 'confirm' | 'client'
export type RestoreObject = 'md' | 'yjs'

export const missingObject = (error: unknown) => {
  const e = error as { status?: number, statusCode?: number, code?: string }
  return e?.status === 404 || e?.statusCode === 404 || e?.code === 'NoSuchKey'
}
const conflictError = (error: unknown) => {
  const e = error as { status?: number, statusCode?: number, code?: string }
  return [409, 412].includes(e?.status || e?.statusCode || 0) || e?.code === 'FileAlreadyExists'
}
export const yjsPath = (path: string) => path.endsWith('.md') ? path.replace(/\.md$/, '.yjs') : `${path}.yjs`

// Fixed vocabulary only: never the object key, body, credentials or the raw error text.
function failureCause(error: unknown) {
  const e = error as { status?: number, statusCode?: number, code?: string, message?: string, cause?: { code?: string } }
  const code = String(e?.code || e?.cause?.code || '')
  if (/timed out|TIMEOUT/i.test(String(e?.message || '')) || /TIMEOUT|ETIMEDOUT/.test(code)) return 'timeout'
  const status = e?.status || e?.statusCode
  if (status && status >= 100 && status <= 599) return `http_${status}`
  if (/^(ECONN|ENOTFOUND|EAI_AGAIN|EHOST|ENET|UND_ERR)/.test(code)) return 'network'
  return 'other'
}
export function logRestoreStorageFailure(stage: RestoreStage, object: RestoreObject | 'client', error: unknown, warn: (message: string) => void = message => console.warn(message)) {
  warn(JSON.stringify({
    event: 'codocs-restore-storage-failed', code: `codocs_restore_storage_${stage}_failed`, object, cause: failureCause(error)
  }))
}

class StageFailure extends Error {
  stage: RestoreStage
  object: RestoreObject
  original: unknown
  constructor(stage: RestoreStage, object: RestoreObject, original: unknown) {
    super('restore storage stage failed')
    this.stage = stage
    this.object = object
    this.original = original
  }
}

/**
 * Copy the Markdown body and any CRDT snapshot to the restore target. Copy only:
 * sources are never deleted here. The two objects are independent, so they run
 * in parallel, but every task must settle and none may fail before the caller
 * commits the Runtime restore. Re-running with the same plan is idempotent
 * (`forbidOverwrite` plus an existing-target check).
 */
export async function copyRestoreObjects(
  createClient: () => Promise<RestoreClient>,
  plan: { source_path: string, target_path: string },
  messages: { unavailable: string, notFound: string },
  warn?: (message: string) => void
) {
  let client: RestoreClient
  try {
    client = await createClient()
  } catch (error) {
    logRestoreStorageFailure('client', 'client', error, warn)
    throw createError({ statusCode: 503, message: messages.unavailable })
  }
  const copyOne = async (object: RestoreObject, source: string, target: string): Promise<boolean> => {
    if (source === target) {
      try {
        await client.head(source)
        return true
      } catch (error) {
        if (missingObject(error)) return false
        throw new StageFailure('head', object, error)
      }
    }
    try {
      await client.head(target)
      return true
    } catch (error) {
      if (!missingObject(error)) throw new StageFailure('head', object, error)
    }
    let bytes: Buffer | Uint8Array
    try {
      bytes = (await client.get(source)).content
    } catch (error) {
      if (missingObject(error)) return false
      throw new StageFailure('get', object, error)
    }
    try {
      await client.put(target, bytes, { forbidOverwrite: true })
    } catch (error) {
      if (!conflictError(error)) throw new StageFailure('put', object, error)
      try {
        await client.head(target)
      } catch (confirmError) {
        // A missing winner is not an optional missing source: do not drop a CRDT
        // snapshot after copying Markdown.
        throw new StageFailure('confirm', object, confirmError)
      }
    }
    return true
  }
  const results = await Promise.allSettled([
    copyOne('md', plan.source_path, plan.target_path),
    copyOne('yjs', yjsPath(plan.source_path), yjsPath(plan.target_path))
  ])
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length) {
    for (const failure of failures) {
      const reason = failure.reason
      if (reason instanceof StageFailure) logRestoreStorageFailure(reason.stage, reason.object, reason.original, warn)
      else logRestoreStorageFailure('head', 'md', reason, warn)
    }
    throw createError({ statusCode: 503, message: messages.unavailable })
  }
  if (!results.some(result => (result as PromiseFulfilledResult<boolean>).value)) throw createError({ statusCode: 404, message: messages.notFound })
}
