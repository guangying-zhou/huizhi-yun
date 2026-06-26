type PlatformFetchOptions = {
  method?: string
  query?: unknown
  body?: unknown
  headers?: Record<string, string>
}

export const platformFetchJson = $fetch as <T>(request: string, options?: PlatformFetchOptions) => Promise<T>
