import { defineEventHandler } from 'h3'
import { enterpriseFinanceMigrationResolve } from '../../../../../../../utils/enterpriseMigrationQueue'

export default defineEventHandler(event => enterpriseFinanceMigrationResolve(event))
