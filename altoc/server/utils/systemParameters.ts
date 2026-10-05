import { createError } from 'h3'

function retiredSystemParameterPath(): never {
  throw createError({
    statusCode: 500,
    message: 'Local system parameter DB helpers are retired. Use Console or Altoc tenant-runtime configuration.'
  })
}

export async function getSystemParameter(_key: string): Promise<string | null> {
  return retiredSystemParameterPath()
}

export async function getSystemParameters(_keys: string[]): Promise<Record<string, string>> {
  return retiredSystemParameterPath()
}

export async function setSystemParameter(_key: string, _value: string): Promise<void> {
  return retiredSystemParameterPath()
}
