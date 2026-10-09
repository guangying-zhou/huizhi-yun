import { defineEventHandler } from 'h3'
import { enterpriseAltocMigrationIdentityConfirm } from '../../../../../../../utils/enterpriseMigrationQueue'

export default defineEventHandler(event => enterpriseAltocMigrationIdentityConfirm(event))
