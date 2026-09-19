import type { H3Event } from 'h3'
import { requirePermission } from './checkPermission'
import { requireRequestUid } from './authIdentity'
import { readProductDocumentMetadataTransport } from './assetProductDocumentTransport'

export async function readAssetProductDocumentMetadata(event: H3Event, productCode: string, documentUuid: string) {
  await requirePermission(event, 'products', 'edit')
  return readProductDocumentMetadataTransport(event, productCode, documentUuid, requireRequestUid(event), 'assets')
}
