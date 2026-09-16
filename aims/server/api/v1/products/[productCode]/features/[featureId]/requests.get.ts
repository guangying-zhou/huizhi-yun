import { handleProductFeatureRequests } from '../../../../../../utils/productFeatureRequestRuntime'

export default defineEventHandler(event => handleProductFeatureRequests(event, 'list'))
