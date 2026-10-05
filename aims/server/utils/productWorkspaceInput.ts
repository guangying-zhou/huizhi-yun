export type WorkspaceAction = 'view' | 'edit' | 'archive' | 'restore'

export interface WorkspaceChangeInput {
  expected_revision: number
  positioning?: string | null
  target_users?: string | null
  value_statement?: string | null
  reason: string
}

export function workspaceChangeInput(action: Exclude<WorkspaceAction, 'view'>, raw: unknown): WorkspaceChangeInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const fields = action === 'edit'
    ? ['expectedRevision', 'positioning', 'targetUsers', 'valueStatement', 'reason']
    : ['expectedRevision', 'reason']
  if (Object.keys(value).some(key => !fields.includes(key))) return null
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) return null
  const reason = value.reason ?? ''
  if (typeof reason !== 'string' || [...reason].length > 2000 || (action !== 'edit' && !reason.trim())) return null
  const result: WorkspaceChangeInput = { expected_revision: Number(value.expectedRevision), reason }
  if (action === 'edit') {
    for (const [key, target] of [['positioning', 'positioning'], ['targetUsers', 'target_users'], ['valueStatement', 'value_statement']] as const) {
      const text = value[key]
      if (text !== null && (typeof text !== 'string' || [...text].length > 10000)) return null
      result[target] = text as string | null
    }
  }
  return result
}

export function productCommandKey(raw: string | undefined): string | null {
  return raw && raw === raw.trim() && [...raw].length <= 191 && !hasProductControlCharacter(raw) ? raw : null
}

export function hasProductControlCharacter(value: string): boolean {
  return [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}
