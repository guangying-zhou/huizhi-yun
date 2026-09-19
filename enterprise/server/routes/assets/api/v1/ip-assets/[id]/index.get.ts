import { defineEventHandler } from 'h3'
import { handleEnterpriseIPAssetsRead } from '~~/server/utils/enterpriseIPAssetsRead'

export default defineEventHandler(event => handleEnterpriseIPAssetsRead(event, 'view'))
