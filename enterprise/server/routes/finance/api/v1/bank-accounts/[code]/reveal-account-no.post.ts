import { defineEventHandler } from 'h3'
import { enterpriseFinanceRevealAccountNo } from '../../../../../../utils/enterpriseFinance'

export default defineEventHandler(event => enterpriseFinanceRevealAccountNo(event))
