// Runtime stores the object version in `document_versions.oss_version_id`
// (varchar(100)). Use the id reported by object storage when it fits; a bucket
// without versioning (or an oversized id) is bound to the command's own SHA-256.
export const COMPANY_SUMMARY_OSS_VERSION_MAX_LENGTH = 100

export function companySummaryOssVersionId(reported: unknown, markdownSha256: string) {
  const candidate = String(reported || '').trim()
  return candidate && [...candidate].length <= COMPANY_SUMMARY_OSS_VERSION_MAX_LENGTH ? candidate : `sha256-${markdownSha256}`
}
