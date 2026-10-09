import { defineEventHandler } from 'h3'
import { enterpriseAltocMigrationResolve } from '../../../../../../../utils/enterpriseMigrationQueue'

export default defineEventHandler(event => enterpriseAltocMigrationResolve(event))
