import { defineEventHandler } from 'h3'
import { handleProductRequestCreate } from '../../../../../../../../aims/server/utils/productRequestCreateRuntime'
import { enterpriseProductRequestActions } from '../../../../../../utils/enterpriseProductRequestActions'

export default defineEventHandler(async event => handleProductRequestCreate(event, await enterpriseProductRequestActions(event)))
