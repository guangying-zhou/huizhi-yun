import { defineEventHandler } from 'h3'
import { enterpriseAltocMigrationExceptions } from '../../../../../utils/enterpriseMigrationQueue'

export default defineEventHandler(event => enterpriseAltocMigrationExceptions(event))
