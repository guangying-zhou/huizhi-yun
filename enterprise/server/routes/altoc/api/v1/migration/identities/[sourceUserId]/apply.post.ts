import { defineEventHandler } from 'h3'
import { enterpriseAltocMigrationIdentityApply } from '../../../../../../../utils/enterpriseMigrationQueue'

export default defineEventHandler(event => enterpriseAltocMigrationIdentityApply(event))
