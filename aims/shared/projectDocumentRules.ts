/** Shared project attachment limit; matches the legacy 100 MB upload contract. */
export const PROJECT_DOCUMENT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
export const PROJECT_DOCUMENT_ATTACHMENT_LIMIT_LABEL = '100 MB'
export function isValidProjectAttachmentSize(bytes: number) {
  return Number.isSafeInteger(bytes) && bytes > 0 && bytes <= PROJECT_DOCUMENT_MAX_ATTACHMENT_BYTES
}
