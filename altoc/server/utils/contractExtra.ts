import { createError } from 'h3'

function retiredContractExtraPath(): never {
  throw createError({
    statusCode: 500,
    message: 'Local contract extra DB helpers are retired. Use Altoc tenant-runtime contract resources.'
  })
}

export async function ensureContractExtraTable(): Promise<void> {
  return retiredContractExtraPath()
}

export async function upsertContractExtra(_contractId: number, _payload: Record<string, unknown>): Promise<void> {
  return retiredContractExtraPath()
}
