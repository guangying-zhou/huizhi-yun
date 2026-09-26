import { defineEventHandler } from 'h3'
import { handleEnterpriseAssetsCategories } from '~~/server/utils/enterpriseAssetsCategories'
export default defineEventHandler(event => handleEnterpriseAssetsCategories(event, 'list'))
