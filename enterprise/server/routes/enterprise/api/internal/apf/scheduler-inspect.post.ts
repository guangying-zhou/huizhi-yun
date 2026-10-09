import { drainEnterpriseAPFDeadLetter } from '../../../../../utils/enterpriseAPFDeadLetterDelivery'
import { drainEnterpriseAPFDue } from '../../../../../utils/enterpriseAPFDueDelivery'
import { createError, defineEventHandler, readBody } from 'h3'
import { callEnterpriseAPFScheduler } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'

import { drainEnterprisePeopleDirectory } from '../../../../../utils/enterprisePeopleDirectoryDelivery'
import { resumeFinanceApprovals } from '../../../../../utils/enterpriseFinanceApproval'
import { resumePeopleAssignmentApprovals } from '../../../../../utils/enterprisePeopleWorkflow'
import { resumeAltocApprovals } from '../../../../../utils/enterpriseAltocApproval'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body || Object.keys(body).length !== 1 || !['altoc', 'finance', 'people'].includes(body.domain)) throw createError({ statusCode: 400 })
  const inspection = await callEnterpriseAPFScheduler(event, body.domain)
  const due = drainEnterpriseAPFDue(event, body.domain)
  const dead = drainEnterpriseAPFDeadLetter(event, body.domain)
  if (body.domain === 'altoc') {
    const [dueNotifications, deadLetterNotifications, approvals] = await Promise.all([due, dead, resumeAltocApprovals(event)])
    return { ...inspection as object, dueNotifications, deadLetterNotifications, approvals }
  }
  if (body.domain === 'people') {
    // Distinct owned queues; neither a Directory dependency failure nor a
    // missing Workflow route starves the other family. Each pass is bounded.
    const [directory, approvals, dueResult, deadResult] = await Promise.allSettled([drainEnterprisePeopleDirectory(event), resumePeopleAssignmentApprovals(event), due, dead])
    if (deadResult.status === 'rejected') throw createError({ statusCode: 503, statusMessage: 'apf_dead_letter_wake_unavailable' })
    if (dueResult.status === 'rejected') throw createError({ statusCode: 503, statusMessage: 'apf_due_wake_unavailable' })
    if (directory.status === 'rejected' || approvals.status === 'rejected') throw createError({ statusCode: 503, statusMessage: 'apf_people_wake_unavailable', data: { directoryUnavailable: directory.status === 'rejected', approvalsUnavailable: approvals.status === 'rejected' } })
    return { ...inspection as object, dueNotifications: dueResult.value, deadLetterNotifications: deadResult.value, directoryLifecycle: directory.value, approvals: approvals.value }
  }
  if (body.domain === 'finance') {
    const [dueNotifications, deadLetterNotifications, approvals] = await Promise.all([due, dead, resumeFinanceApprovals(event)])
    return { ...inspection as object, dueNotifications, deadLetterNotifications, approvals }
  }
  return inspection
})
