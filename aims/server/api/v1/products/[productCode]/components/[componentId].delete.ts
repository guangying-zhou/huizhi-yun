import { handleProductComponent } from '../../../../../utils/productComponentRuntime'

export default defineEventHandler(event => handleProductComponent(event, 'delete'))
