import { handleProductVersionCollection } from '../../../../../../../utils/productVersionRuntime'

export default defineEventHandler(event => handleProductVersionCollection(event, 'release-view'))
