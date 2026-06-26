import { createError, defineEventHandler } from 'h3'
import { maybeCallCurrentFinanceDataRuntime } from '../../../../utils/dataRuntime'

export default defineEventHandler(async (event) => {
  const runtime = await maybeCallCurrentFinanceDataRuntime(event)
  if (runtime.handled) return runtime.data
  throw createError({
    statusCode: 503,
    message: 'Finance tenant-runtime is required for people cost parameters.'
  })
})
