import { defineEventHandler } from 'h3'
import { handleProductRequestRead } from '../../../../../../../../../../../aims/server/utils/productRequestReadRuntime'
import { enterpriseProductRequestActions } from '../../../../../../../../../utils/enterpriseProductRequestActions'

export default defineEventHandler(async event => handleProductRequestRead(event, 'sources', await enterpriseProductRequestActions(event)))
