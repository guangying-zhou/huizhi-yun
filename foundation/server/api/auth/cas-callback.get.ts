import { defineEventHandler } from 'h3'
import { handleCasCallback } from '../../utils/casAuth'

// Legacy Auth Bridge entrypoint. Kept for existing CAS flows only.
export default defineEventHandler(async (event) => {
  return handleCasCallback(event)
})
