import { defineEventHandler } from 'h3'
import { handleEnterpriseIPAssetsLinkProduct } from '~~/server/utils/enterpriseIPAssetsLinkProduct'

export default defineEventHandler(event => handleEnterpriseIPAssetsLinkProduct(event))
