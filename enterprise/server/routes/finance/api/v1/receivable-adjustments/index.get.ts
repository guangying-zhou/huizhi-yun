import { enterpriseFinanceLedger } from '../../../../../utils/enterpriseFinanceLedger'

export default defineEventHandler(event => enterpriseFinanceLedger(event, 'receivable-adjustments-page'))
