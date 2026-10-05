import { handleProductVersionAcceptance } from '../../../../../../utils/productVersionAcceptanceRuntime'

export default defineEventHandler(event => handleProductVersionAcceptance(event, 'reopen'))
