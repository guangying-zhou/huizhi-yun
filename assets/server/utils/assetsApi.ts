import type { H3Event } from 'h3'
import { getRequestUid } from '~~/server/utils/authIdentity'

export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export function ok<T>(data: T, message = 'ok'): ApiResponse<T> {
  return {
    code: 0,
    message,
    data
  }
}

export function parseIdParam(event: H3Event, key = 'id'): number {
  const raw = event.context.params?.[key]
  const id = Number(raw)

  if (!Number.isInteger(id) || id <= 0) {
    throw createError({
      statusCode: 400,
      message: `无效的 ${key}`
    })
  }

  return id
}

export function getOperatorUid(event: H3Event): string | null {
  return getRequestUid(event) || null
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw createError({
      statusCode: 404,
      message
    })
  }

  return value
}

export async function readRequestBody<T extends Record<string, unknown>>(event: H3Event): Promise<T> {
  const body = await readBody<T | undefined>(event)
  return (body || {}) as T
}

export async function skeletonMutation<T extends Record<string, unknown>>(
  event: H3Event,
  action: string,
  data: T = {} as T
): Promise<ApiResponse<{ accepted: boolean, action: string } & T>> {
  const payload = await readRequestBody<Record<string, unknown>>(event)

  return ok({
    accepted: true,
    action,
    ...data,
    payload
  }, 'skeleton endpoint')
}
