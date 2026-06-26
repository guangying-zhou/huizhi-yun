import type { RowDataPacket } from '~~/server/utils/db'
import { execute, queryRow } from '~~/server/utils/db'

interface ActiveMilestoneRow extends RowDataPacket {
  id: number
}

export async function initializeProjectMilestonesOnActivation(projectId: number) {
  const activeMilestone = await queryRow<ActiveMilestoneRow>(
    `SELECT id
     FROM milestones
     WHERE project_id = ? AND status = 'active'
     ORDER BY sort_order ASC, start_date ASC, id ASC
     LIMIT 1`,
    [projectId]
  )

  await execute(
    `UPDATE milestones
     SET status = 'todo'
     WHERE project_id = ? AND status = 'planning'`,
    [projectId]
  )

  if (activeMilestone) {
    return
  }

  await execute(
    `UPDATE milestones
     SET status = 'active'
     WHERE id = (
       SELECT id FROM (
         SELECT id
         FROM milestones
         WHERE project_id = ? AND status = 'todo'
         ORDER BY sort_order ASC, start_date ASC, id ASC
         LIMIT 1
       ) AS t
     )`,
    [projectId]
  )
}
