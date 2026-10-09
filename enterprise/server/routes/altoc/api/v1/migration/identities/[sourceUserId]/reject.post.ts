import { defineEventHandler } from 'h3'
import { enterpriseAltocMigrationIdentityReject } from '../../../../../../../utils/enterpriseMigrationQueue'

export default defineEventHandler(event => enterpriseAltocMigrationIdentityReject(event))
