export function objectStorageVersionId(headers: Record<string, string | undefined>): string | undefined {
  const versionHeaders = Object.entries(headers).filter(([name]) => /^(x-amz-version-id|x-oss-version-id)$/i.test(name))
  const values = versionHeaders.map(([, value]) => value).filter((value): value is string => value !== undefined)
  if (values.some(value => !value || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) || new Set(values).size > 1) {
    throw new Error('Object storage returned an invalid version')
  }
  return values[0]
}
