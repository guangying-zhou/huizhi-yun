import { handleProductRequestRead } from '../../../../../../../utils/productRequestReadRuntime'

export default defineEventHandler(event => handleProductRequestRead(event, 'sources'))
