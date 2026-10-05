import type { H3Event } from 'h3'
import { callCodocsTenantRuntime } from './codocsRuntime'
import { isSnapshotV2Document, parseBodyRef, readBodyByRef, type BodyStorageClient } from './documentBodyRef'
import { createRuntimeOSSClient, downloadDocument } from './oss'

export interface ImageOwnerDocument {
  uuid?: string
  title?: string
  doc_type: string
  oss_path: string
  snapshot_generation?: number
  snapshot_ref?: unknown
}

interface RuntimePage<T> {
  items?: T[]
}

/**
 * The document that owns an image, found by its (mirror) path. Runtime marks
 * v2 documents and, on request, returns the exact published body reference:
 * `oss_path` of a v2 document is only a derived mirror, so the "is this image
 * still referenced" decision must read the snapshot, never the mirror.
 */
export async function findImageOwnerDocument(event: H3Event, ossPath: string): Promise<ImageOwnerDocument | null> {
  const page = await callCodocsTenantRuntime<RuntimePage<ImageOwnerDocument>>(event, '/v1/codocs/documents', {
    query: { oss_path: ossPath, limit: 1, include_snapshot_ref: '1' },
    scope: 'codocs.read'
  })
  return page.items?.[0] || null
}

/**
 * Body used to decide whether an image is referenced. For a v2 document any
 * failure to read the exact, verified snapshot throws so callers fail closed
 * (treat the image as referenced); v1 keeps the mirror read.
 */
export async function readImageOwnerDocumentContent(
  event: H3Event,
  doc: ImageOwnerDocument,
  client?: BodyStorageClient
): Promise<string | null> {
  if (isSnapshotV2Document(doc)) {
    const storage = client || (await createRuntimeOSSClient({ event }) as unknown as BodyStorageClient)
    return (await readBodyByRef(storage, parseBodyRef(doc.snapshot_ref))).toString('utf-8')
  }
  return await downloadDocument(doc.oss_path, doc.doc_type)
}
