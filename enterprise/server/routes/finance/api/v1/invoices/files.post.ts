import { defineEventHandler } from 'h3'
import { attachFinanceFile } from '../../../../../utils/enterpriseFinanceFiles'

export default defineEventHandler(attachFinanceFile)
