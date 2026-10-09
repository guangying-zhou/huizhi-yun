import { defineEventHandler } from 'h3'
import { handleProductRequestAction } from '../../../../../../../../../../aims/server/utils/productRequestActionRuntime'
import { enterpriseProductRequestActions } from '../../../../../../../../utils/enterpriseProductRequestActions'

export default defineEventHandler(async event => handleProductRequestAction(event, 'merge', await enterpriseProductRequestActions(event)))
