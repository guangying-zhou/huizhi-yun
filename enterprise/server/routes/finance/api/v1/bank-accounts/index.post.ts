import { defineEventHandler } from 'h3'
import { enterpriseFinance } from '../../../../../utils/enterpriseFinance'

export default defineEventHandler(event => enterpriseFinance(event, 'accounts-create'))
