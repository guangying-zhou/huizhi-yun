import { createError } from 'h3'

export type TodoKind = 'approval' | 'due' | 'risk' | 'follow_up'

export interface PendingActionableListInput {
  uid: string
  todoKind?: unknown
  category?: unknown
  sourceAppCode?: unknown
  limit?: unknown
  cursor?: unknown
}

interface PendingActionableCursor {
  v: 1
  updatedAt: string
  id: number
}

function text(value: unknown) {
  return String(value || '').trim()
}

function cursorDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw createError({ statusCode: 500, message: 'Invalid actionable cursor source' })
  }
  return date
}

export function encodePendingActionableCursor(updatedAt: string | Date, id: number) {
  return Buffer.from(JSON.stringify({ v: 1, updatedAt: cursorDate(updatedAt).toISOString(), id }), 'utf8').toString('base64url')
}

export function decodePendingActionableCursor(value: unknown): PendingActionableCursor | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<PendingActionableCursor>
    if (parsed.v !== 1 || !Number.isInteger(parsed.id) || Number(parsed.id) <= 0 || typeof parsed.updatedAt !== 'string') {
      throw new Error('invalid')
    }
    const date = new Date(parsed.updatedAt)
    if (Number.isNaN(date.getTime()) || date.toISOString() !== parsed.updatedAt) {
      throw new Error('invalid')
    }
    return { v: 1, updatedAt: parsed.updatedAt, id: Number(parsed.id) }
  } catch {
    throw createError({ statusCode: 400, message: 'cursor is invalid' })
  }
}
