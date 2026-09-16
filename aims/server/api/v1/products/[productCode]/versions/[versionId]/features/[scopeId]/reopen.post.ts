import { handleProductVersionScope } from '../../../../../../../../utils/productVersionScopeRuntime'

export default defineEventHandler(event => handleProductVersionScope(event, 'reopen'))
