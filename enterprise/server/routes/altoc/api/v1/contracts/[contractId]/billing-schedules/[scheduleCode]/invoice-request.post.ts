import { defineEventHandler } from 'h3'
import { createFinanceRequestFromAltoc } from '../../../../../../../../utils/enterpriseFinanceApproval'

export default defineEventHandler(createFinanceRequestFromAltoc)
