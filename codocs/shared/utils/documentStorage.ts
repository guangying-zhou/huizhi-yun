// Document storage classification (document asset design DOC-06b).
//
// 'git-project' documents are OSS copies of repository documents kept in the
// project-documents bucket. Every decision that depends on that fact goes
// through this module, so DOC-06d can move the discriminator from doc_type to
// documents.storage_locator in one place.

export const REPOSITORY_COPY_DOC_TYPE = 'git-project' as const

export type DocumentBucket = 'documents' | 'projects'

export function isRepositoryCopyDocType(docType: unknown): boolean {
  return docType === REPOSITORY_COPY_DOC_TYPE
}

/** Project documents, including repository copies. */
export function isProjectFamilyDocType(docType: unknown): boolean {
  return docType === 'project' || isRepositoryCopyDocType(docType)
}

/** The OSS bucket that holds a document's content. */
export function documentBucket(docType: unknown): DocumentBucket {
  return isRepositoryCopyDocType(docType) ? 'projects' : 'documents'
}
