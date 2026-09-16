import { $fetch as ofetch } from 'ofetch'

export type ExternalFetchOptions = Record<string, unknown>
export type ExternalFetch = <T>(url: string, options?: ExternalFetchOptions) => Promise<T>

// Avoid coupling outbound HTTP calls to Nitro's generated internal-route union.
export const fetchExternal = ofetch as unknown as ExternalFetch
