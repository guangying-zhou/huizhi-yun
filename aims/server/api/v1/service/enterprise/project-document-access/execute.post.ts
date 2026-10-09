import { createError, defineEventHandler } from 'h3'

// ADR-018a D11: replaced by the owning typed Host entry and fixed U lane.
export default defineEventHandler(() => {
  throw createError({ statusCode: 410, message: 'Enterprise project documents use the typed Host entry.', data: { code: 'enterprise_aims_service_retired' } })
})
