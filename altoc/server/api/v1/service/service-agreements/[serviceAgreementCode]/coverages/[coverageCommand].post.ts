import { createError, getRouterParam } from 'h3'
import { handleServiceAgreementCoverageWrite } from '~~/server/utils/serviceAgreementCoverageValidation'

export default defineEventHandler(async (event) => {
  const agreementCode = String(getRouterParam(event, 'serviceAgreementCode') || '').trim()
  const coverageCommand = String(getRouterParam(event, 'coverageCommand') || '').trim()
  if (!agreementCode || !coverageCommand) {
    throw createError({ statusCode: 400, message: 'serviceAgreementCode and coverageCode are required.' })
  }
  return await handleServiceAgreementCoverageWrite(event, { agreementCode, coverageCommand })
})
