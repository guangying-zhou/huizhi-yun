import { defineEventHandler } from 'h3'
import { enterpriseFinanceMigrationExceptions } from '../../../../../utils/enterpriseMigrationQueue'

export default defineEventHandler(event => enterpriseFinanceMigrationExceptions(event))
