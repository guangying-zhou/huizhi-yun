import { createConsoleMutationIntent, type ConsoleMutationRequest } from './consoleMutationIntent'
/** A known CAS rejection is final; an unknown acknowledgement keeps the original intent. */
export function createReviewMutationIntent(prefix: string, settledConflictCodes: readonly string[], key?: () => string) {
  const intent = createConsoleMutationIntent(prefix, key)
  return {
    get uncertain() {
      return intent.uncertain
    },
    get pending() {
      return intent.pending
    },
    reset: () => intent.reset(),
    async submit(request: ConsoleMutationRequest, send: (request: ConsoleMutationRequest, key: string) => Promise<unknown>) {
      let original: unknown
      try {
        return await intent.submit(request, async (frozen, stableKey) => {
          try {
            return await send(frozen, stableKey)
          } catch (error) {
            const e = error as { statusCode?: number, status?: number, response?: { status?: number }, data?: { code?: string, data?: { code?: string } } }
            const status = Number(e.statusCode || e.status || e.response?.status)
            if (status === 409 && settledConflictCodes.includes(String(e.data?.data?.code || e.data?.code))) {
              original = error
              throw { statusCode: 412 }
            }
            throw error
          }
        })
      } catch (error) {
        throw original || error
      }
    }
  }
}
