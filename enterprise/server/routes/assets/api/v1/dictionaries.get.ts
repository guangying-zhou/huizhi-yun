import { defineEventHandler } from 'h3'
import { handleEnterpriseAssetsProducts } from '~~/server/utils/enterpriseAssetsProducts'
export default defineEventHandler(event => handleEnterpriseAssetsProducts(event, 'dictionaries'))
