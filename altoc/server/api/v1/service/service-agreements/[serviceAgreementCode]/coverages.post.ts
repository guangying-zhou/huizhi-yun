import { createError, getRouterParam } from 'h3'
import { handleServiceAgreementCoverageWrite } from '~~/server/utils/serviceAgreementCoverageValidation'

export default defineEventHandler(async (event) => {
  const agreementCode = String(getRouterParam(event, 'serviceAgreementCode') || '').trim()
  if (!agreementCode) {
    throw createError({ statusCode: 400, message: 'serviceAgreementCode is required.' })
  }
  return await handleServiceAgreementCoverageWrite(event, { agreementCode })
})
