import { listEnterpriseDepartmentTrash } from '../../../../../utils/enterpriseCodocsDepartmentWrites'

export default defineEventHandler(event => listEnterpriseDepartmentTrash(event))
