import { defineEventHandler } from 'h3'
import { enterpriseFinanceBalanceEntryCreate } from '../../../../../../utils/enterpriseFinance'

export default defineEventHandler(event => enterpriseFinanceBalanceEntryCreate(event))
