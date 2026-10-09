import { defineEventHandler } from 'h3'
import { submitFinanceApproval } from '../../../../../../utils/enterpriseFinanceApproval'

export default defineEventHandler(submitFinanceApproval)
