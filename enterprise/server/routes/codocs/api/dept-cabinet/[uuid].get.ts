import { readEnterpriseDepartmentCabinet } from '~~/server/utils/enterpriseCodocsDepartmentCabinet'
export default defineEventHandler(event => readEnterpriseDepartmentCabinet(event, 'view'))
