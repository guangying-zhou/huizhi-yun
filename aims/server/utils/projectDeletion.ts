import type { PoolConnection, ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import { queryRow, withTransaction } from '~~/server/utils/db'

type ConnectionExecuteParams = Parameters<PoolConnection['execute']>[1]

type DeleteImpactKey
  = | 'members'
    | 'repos'
    | 'favorites'
    | 'workflowTransitions'
    | 'notificationRules'
    | 'projectDocuments'
    | 'milestones'
    | 'workItems'
    | 'workItemRelations'
    | 'timeEntries'
    | 'requirements'
    | 'requirementContents'
    | 'requirementReviewBatches'
    | 'deliverables'
    | 'approvals'

type DeleteImpact = Record<DeleteImpactKey, number> & { total: number }

interface CountRow extends RowDataPacket {
  total: number
}

const impactQueries: Array<{ key: DeleteImpactKey, sql: string, params?: number }> = [
  { key: 'members', sql: 'SELECT COUNT(*) AS total FROM aims_project_members WHERE project_id = ?' },
  { key: 'repos', sql: 'SELECT COUNT(*) AS total FROM aims_project_repos WHERE project_id = ?' },
  { key: 'favorites', sql: 'SELECT COUNT(*) AS total FROM user_favorite_projects WHERE project_id = ?' },
  { key: 'workflowTransitions', sql: 'SELECT COUNT(*) AS total FROM workflow_transitions WHERE project_id = ?' },
  { key: 'notificationRules', sql: 'SELECT COUNT(*) AS total FROM notification_rules WHERE project_id = ?' },
  { key: 'projectDocuments', sql: 'SELECT COUNT(*) AS total FROM project_documents WHERE project_id = ? OR milestone_id IN (SELECT id FROM milestones WHERE project_id = ?) OR work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)', params: 3 },
  { key: 'milestones', sql: 'SELECT COUNT(*) AS total FROM milestones WHERE project_id = ?' },
  { key: 'workItems', sql: 'SELECT COUNT(*) AS total FROM work_items WHERE project_id = ?' },
  { key: 'workItemRelations', sql: 'SELECT COUNT(*) AS total FROM work_item_relations WHERE source_id IN (SELECT id FROM work_items WHERE project_id = ?) OR target_id IN (SELECT id FROM work_items WHERE project_id = ?)', params: 2 },
  { key: 'timeEntries', sql: 'SELECT COUNT(*) AS total FROM time_entries WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)' },
  { key: 'requirements', sql: 'SELECT COUNT(*) AS total FROM requirement_items WHERE project_id = ?' },
  { key: 'requirementContents', sql: 'SELECT COUNT(*) AS total FROM requirement_contents WHERE project_id = ?' },
  { key: 'requirementReviewBatches', sql: 'SELECT COUNT(*) AS total FROM requirement_review_batches WHERE project_id = ?' },
  { key: 'deliverables', sql: 'SELECT COUNT(*) AS total FROM deliverables WHERE project_id = ?' },
  { key: 'approvals', sql: 'SELECT COUNT(*) AS total FROM approval_records WHERE project_id = ?' }
]

function repeatedProjectId(projectId: number, count = 1) {
  return Array.from({ length: count }, () => projectId)
}

async function deleteRows(
  connection: PoolConnection,
  deleted: Record<string, number>,
  key: string,
  sql: string,
  params: unknown[]
) {
  const [result] = await connection.execute<ResultSetHeader>(sql, params as ConnectionExecuteParams)
  deleted[key] = result.affectedRows
}

export async function getProjectDeletionImpact(projectId: number): Promise<DeleteImpact> {
  const impact = Object.fromEntries(impactQueries.map(item => [item.key, 0])) as DeleteImpact

  for (const item of impactQueries) {
    const row = await queryRow<CountRow>(item.sql, repeatedProjectId(projectId, item.params ?? 1))
    impact[item.key] = Number(row?.total || 0)
  }

  impact.total = Object.values(impact).reduce((sum, value) => sum + Number(value || 0), 0)
  return impact
}

export async function hardDeleteProject(projectId: number) {
  const deleted: Record<string, number> = {}

  await withTransaction(async (connection) => {
    await deleteRows(connection, deleted, 'deliverables', 'DELETE FROM deliverables WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'approvals', 'DELETE FROM approval_records WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'gitlabCommits', 'DELETE FROM gitlab_commits WHERE project_id = ?', [projectId])

    await deleteRows(connection, deleted, 'timeEntries', 'DELETE FROM time_entries WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)', [projectId])
    await deleteRows(connection, deleted, 'workItemAttachments', 'DELETE FROM work_item_attachments WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)', [projectId])
    await deleteRows(connection, deleted, 'workItemChangelog', 'DELETE FROM work_item_changelog WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)', [projectId])
    await deleteRows(connection, deleted, 'workItemComments', 'DELETE FROM work_item_comments WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)', [projectId])
    await deleteRows(connection, deleted, 'workItemRelations', 'DELETE FROM work_item_relations WHERE source_id IN (SELECT id FROM work_items WHERE project_id = ?) OR target_id IN (SELECT id FROM work_items WHERE project_id = ?)', [projectId, projectId])
    await deleteRows(connection, deleted, 'workItemSourceAnchors', 'DELETE FROM work_item_source_anchors WHERE work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)', [projectId])

    await deleteRows(connection, deleted, 'requirementVersions', 'DELETE FROM requirement_versions WHERE requirement_id IN (SELECT id FROM requirement_items WHERE project_id = ?)', [projectId])
    await deleteRows(
      connection,
      deleted,
      'requirementItemContents',
      'DELETE FROM requirement_item_contents WHERE requirement_id IN (SELECT id FROM requirement_items WHERE project_id = ?) OR content_id IN (SELECT id FROM requirement_contents WHERE project_id = ?)',
      [projectId, projectId]
    )
    await deleteRows(connection, deleted, 'requirementContents', 'DELETE FROM requirement_contents WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'requirementItems', 'DELETE FROM requirement_items WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'requirementReviewBatches', 'DELETE FROM requirement_review_batches WHERE project_id = ?', [projectId])

    await deleteRows(connection, deleted, 'projectDocuments', 'DELETE FROM project_documents WHERE project_id = ? OR milestone_id IN (SELECT id FROM milestones WHERE project_id = ?) OR work_item_id IN (SELECT id FROM work_items WHERE project_id = ?)', [projectId, projectId, projectId])
    await deleteRows(connection, deleted, 'workItems', 'DELETE FROM work_items WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'milestones', 'DELETE FROM milestones WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'workflowTransitions', 'DELETE FROM workflow_transitions WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'notificationRules', 'DELETE FROM notification_rules WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'repos', 'DELETE FROM aims_project_repos WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'counters', 'DELETE FROM project_counters WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'favorites', 'DELETE FROM user_favorite_projects WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'members', 'DELETE FROM aims_project_members WHERE project_id = ?', [projectId])
    await deleteRows(connection, deleted, 'projects', 'DELETE FROM aims_projects WHERE id = ?', [projectId])
  })

  return deleted
}
