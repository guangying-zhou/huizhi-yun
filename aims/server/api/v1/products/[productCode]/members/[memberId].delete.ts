import { handleProductMembers } from '../../../../../utils/productMemberRuntime'

export default defineEventHandler(event => handleProductMembers(event, 'revoke'))
