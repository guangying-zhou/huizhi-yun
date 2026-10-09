import { defineEventHandler } from 'h3'
import { handleEnterpriseDigitalAssetsRead } from '~~/server/utils/enterpriseDigitalAssetsRead'

export default defineEventHandler(event => handleEnterpriseDigitalAssetsRead(event, 'view'))
