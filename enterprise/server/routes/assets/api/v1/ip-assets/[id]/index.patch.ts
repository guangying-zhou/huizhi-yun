import { defineEventHandler } from 'h3'
import { handleEnterpriseIPAssetsWrite } from '~~/server/utils/enterpriseIPAssetsWrite'
export default defineEventHandler(event => handleEnterpriseIPAssetsWrite(event, 'edit'))
