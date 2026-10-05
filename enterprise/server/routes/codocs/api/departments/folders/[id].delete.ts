import { manageEnterpriseDepartmentFolder } from '../../../../../utils/enterpriseCodocsDepartmentWrites'

export default defineEventHandler(event => manageEnterpriseDepartmentFolder(event, 'delete'))
