import { writeEnterpriseDepartmentCabinet } from '~~/server/utils/enterpriseCodocsDepartmentCabinetWrites'
export default defineEventHandler(event => writeEnterpriseDepartmentCabinet(event, 'folder-create'))
