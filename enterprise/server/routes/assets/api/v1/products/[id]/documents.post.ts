import { defineEventHandler } from 'h3'
import { handleEnterpriseAssetsLinks } from '~~/server/utils/enterpriseAssetsLinks'
export default defineEventHandler(event => handleEnterpriseAssetsLinks(event, 'link-document'))
