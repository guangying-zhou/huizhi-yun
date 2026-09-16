import { handleProductFeatureRead } from '../../../../../utils/productFeatureReadRuntime'

export default defineEventHandler(event => handleProductFeatureRead(event, 'list'))
