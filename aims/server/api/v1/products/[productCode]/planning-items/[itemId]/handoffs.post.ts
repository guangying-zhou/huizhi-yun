import { handleProductHandoff } from '../../../../../../utils/productHandoffRuntime'

export default defineEventHandler(event => handleProductHandoff(event, 'planning'))
