import { handleProductWorkspace } from '../../../../utils/productWorkspaceRuntime'

export default defineEventHandler(event => handleProductWorkspace(event, 'restore'))
