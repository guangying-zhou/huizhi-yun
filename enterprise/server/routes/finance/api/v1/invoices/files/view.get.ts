import { defineEventHandler } from 'h3'
import { readFinanceFile } from '../../../../../../utils/enterpriseFinanceFiles'

export default defineEventHandler(readFinanceFile)
