import { defineEventHandler } from 'h3'
import { handleEnterpriseAssetsRead } from '~~/server/utils/enterpriseAssetsRead'
export default defineEventHandler(event => handleEnterpriseAssetsRead(event, 'dictionaries'))
