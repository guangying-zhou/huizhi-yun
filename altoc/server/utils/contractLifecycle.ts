import { createError } from 'h3'

export const CONTRACT_STAGE_TYPES = ['contract_signed', 'delivery', 'acceptance', 'service_end'] as const

export const CONTRACT_STAGE_STATUS_MAP: Record<string, string> = {
  contract_signed: 'effective',
  delivery: 'effective',
  acceptance: 'effective',
  service_end: 'effective'
}

function retiredContractLifecyclePath(): never {
  throw createError({
    statusCode: 500,
    message: 'Local contract lifecycle DB helpers are retired. Use Altoc tenant-runtime contract commands.'
  })
}

export async function ensureContractLifecycleSchema(): Promise<void> {
  return retiredContractLifecyclePath()
}

export function normalizeStageType(value: unknown) {
  const stageType = String(value || '').trim()
  return (CONTRACT_STAGE_TYPES as readonly string[]).includes(stageType) ? stageType : ''
}

export async function generateReceivablePlansForStage(_contractId: number, _stageType: string, _uid: string): Promise<number> {
  return retiredContractLifecyclePath()
}
