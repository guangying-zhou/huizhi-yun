import { productVersionArchiveInput } from './productVersionArchiveInput'

export function productVersionVisibilityInput(raw: unknown, versionID: number) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { isPublic, ...rest } = raw as Record<string, unknown>
  if (typeof isPublic !== 'boolean') return null
  const input = productVersionArchiveInput(rest, versionID)
  if (!input || /\p{Cc}/u.test(input.reason)) return null
  return { ...input, is_public: isPublic }
}
