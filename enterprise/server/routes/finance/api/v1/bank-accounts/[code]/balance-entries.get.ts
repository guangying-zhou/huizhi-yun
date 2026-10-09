import { defineEventHandler } from 'h3'
import { enterpriseFinanceBalanceEntries } from '../../../../../../utils/enterpriseFinance'

export default defineEventHandler(event => enterpriseFinanceBalanceEntries(event))
