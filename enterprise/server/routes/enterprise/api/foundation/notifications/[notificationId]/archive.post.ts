import handler from '@hzy/foundation/server/api/notifications/[notificationId]/archive.post'
import { enterpriseSharedApi } from '../../../../../../utils/enterpriseSharedApi'

export default enterpriseSharedApi(handler)
