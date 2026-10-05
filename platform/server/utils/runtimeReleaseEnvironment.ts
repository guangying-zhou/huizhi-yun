import { createError } from 'h3'

export type RuntimeReleaseEnvironment = 'prod' | 'test' | 'dev'
export function requireRuntimeReleaseEnvironment(value: unknown): RuntimeReleaseEnvironment {
  if (value !== 'prod' && value !== 'test' && value !== 'dev') throw createError({ statusCode: 400, message: 'environment must be prod, test or dev' })
  return value
}
export function runtimeReleaseChannel(value: unknown) {
  return `stable-${requireRuntimeReleaseEnvironment(value)}`
}
export function requireRuntimeReleaseUpdateMode(value: unknown) {
  if (value !== 'pinned' && value !== 'tracking' && value !== 'retired') throw createError({ statusCode: 503, message: 'runtime release update mode is unavailable' })
  if (value === 'retired') throw createError({ statusCode: 403, message: 'runtime_instance_retired' })
  return value
}
