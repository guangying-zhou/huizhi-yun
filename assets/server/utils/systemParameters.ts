import { createError } from 'h3'

function tenantRuntimeOnly(): never {
  throw createError({
    statusCode: 503,
    message: 'Assets system parameters are served by tenant-runtime/data-runtime. Local database repositories are disabled.'
  })
}

async function unavailable<T = never>(): Promise<T> {
  return tenantRuntimeOnly()
}

export async function getSystemParameter(_key: string): Promise<string | null> {
  return unavailable()
}

export async function getSystemParameters(_keys: string[]): Promise<Record<string, string>> {
  return unavailable()
}

export async function setSystemParameter(_key: string, _value: string): Promise<void> {
  return unavailable()
}
