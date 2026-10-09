import { defineEventHandler } from 'h3'
import { handleProductRequestAction } from '../../../../../../utils/productRequestActionRuntime'

export default defineEventHandler(event => handleProductRequestAction(event, 'decide'))
