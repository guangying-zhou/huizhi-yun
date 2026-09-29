import { enterpriseCodocsDepartmentShares } from '~~/server/utils/enterpriseCodocsDepartmentShares'
export default defineEventHandler(event => enterpriseCodocsDepartmentShares(event, 'list'))
