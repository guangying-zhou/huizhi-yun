import { resolveEnterpriseDepartmentAccess } from '../../../../utils/enterpriseCodocsDepartmentDocuments'

export default defineEventHandler(event => resolveEnterpriseDepartmentAccess(event))
