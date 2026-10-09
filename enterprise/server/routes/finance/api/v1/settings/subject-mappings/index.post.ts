import { defineEventHandler } from 'h3'
import { enterpriseFinanceLedger } from '../../../../../../utils/enterpriseFinanceLedger'

export default defineEventHandler(event => enterpriseFinanceLedger(event, 'subject-mappings-create'))
