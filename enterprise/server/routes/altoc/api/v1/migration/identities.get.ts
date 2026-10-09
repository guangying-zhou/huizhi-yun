import { defineEventHandler } from 'h3'
import { enterpriseAltocMigrationIdentities } from '../../../../../utils/enterpriseMigrationQueue'

export default defineEventHandler(event => enterpriseAltocMigrationIdentities(event))
