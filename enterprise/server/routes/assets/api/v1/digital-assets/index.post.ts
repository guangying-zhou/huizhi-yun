import { defineEventHandler } from 'h3'
import { handleEnterpriseDigitalAssetsWrite } from '~~/server/utils/enterpriseDigitalAssetsWrite'
export default defineEventHandler(event => handleEnterpriseDigitalAssetsWrite(event, 'create'))
