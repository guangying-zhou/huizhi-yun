import { handleProductObjective } from '../../../../../utils/productObjectiveRuntime'

export default defineEventHandler(event => handleProductObjective(event, 'list'))
