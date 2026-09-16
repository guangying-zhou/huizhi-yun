import type { AcceptanceCheck, VersionAcceptanceDetail } from './productVersionAcceptance'
import type { ProductVersionScope } from './productVersionScope'

export interface ProductRelease {
  id: number
  biz_id: string
  version_id: number
  release_seq: number
  released_by: string | null
  released_at: string | null
  evidence_level: 'verified' | 'legacy_import'
  content_hash: string
  current: boolean
  withdrawn: boolean
  superseded: boolean
  snapshot_available: boolean
  version: { id: number, product_code: string, version_code: string, name: string | null, description: string | null } | null
  scopes: Omit<ProductVersionScope, 'version_id'>[]
  accepted_by: string
  accepted_at: string
  checks: AcceptanceCheck[]
  exceptions: VersionAcceptanceDetail['exceptions']
}

export type ProductReleaseSummary = Pick<ProductRelease, 'id' | 'version_id' | 'release_seq' | 'released_at' | 'released_by' | 'evidence_level' | 'current' | 'withdrawn' | 'superseded'> & { supersedes_record_id: number | null }
export interface ProductReleasePage { items: ProductReleaseSummary[], total: number, page: number, pageSize: number }
