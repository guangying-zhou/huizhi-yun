import { handleProductFeatureCreate } from '../../../../../utils/productFeatureCreateRuntime'

export default defineEventHandler(event => handleProductFeatureCreate(event))
