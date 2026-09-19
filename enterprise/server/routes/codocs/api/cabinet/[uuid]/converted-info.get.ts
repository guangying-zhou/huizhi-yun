import { enterpriseCodocsCabinetRead } from '../../../../../utils/enterpriseCodocsCabinetReads'
export default defineEventHandler(event => enterpriseCodocsCabinetRead(event, 'converted-info'))
