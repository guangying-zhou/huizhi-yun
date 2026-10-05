import handler from '@hzy/foundation/server/api/notifications/[notificationId]/read.post'
import { enterpriseSharedApi } from '../../../../../../utils/enterpriseSharedApi'

export default enterpriseSharedApi(handler)
