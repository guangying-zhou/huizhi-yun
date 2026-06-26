/**
 * 获取变更需求的内容 diff 基础数据
 * GET /api/v1/requirements/:reqId/change-diff
 */
import type { RowDataPacket } from '~~/server/utils/db'

interface ChangeReqRow extends RowDataPacket {
  id: number
  req_code: string
  title: string
  status: string
  parent_requirement_id: number
  parent_req_code: string
  parent_title: string
}

interface DiffRow extends RowDataPacket {
  content_original_id: number
  diff_status: 'changed' | 'unchanged' | 'added'
  base_content_id: number | null
  base_title: string | null
  base_content_md: string | null
  base_version_no: number | null
  change_content_id: number
  change_title: string
  change_content_md: string | null
  change_version_no: number
}

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }

  const reqId = Number(getRouterParam(event, 'reqId'))
  if (!reqId || Number.isNaN(reqId)) {
    throw createError({ statusCode: 400, message: '无效的需求ID' })
  }

  const changeReq = await queryRow<ChangeReqRow>(
    `SELECT r.id, r.req_code, r.title, r.status, r.parent_requirement_id,
            p.req_code AS parent_req_code, p.title AS parent_title
     FROM requirement_items r
     INNER JOIN requirement_items p ON p.id = r.parent_requirement_id
     WHERE r.id = ? AND r.item_kind = 'change'`,
    [reqId]
  )
  if (!changeReq) {
    throw createError({ statusCode: 404, message: '变更需求不存在' })
  }

  const rows = await queryRows<DiffRow[]>(
    `SELECT cc.content_original_id,
            CASE
              WHEN pv.id IS NOT NULL THEN 'changed'
              WHEN pb.id IS NOT NULL THEN 'unchanged'
              ELSE 'added'
            END AS diff_status,
            COALESCE(pv.id, pb.id) AS base_content_id,
            COALESCE(pv.title, pb.title) AS base_title,
            COALESCE(pv.content_md, pb.content_md) AS base_content_md,
            COALESCE(pv.version_no, pb.version_no) AS base_version_no,
            cc.id AS change_content_id,
            cc.title AS change_title,
            cc.content_md AS change_content_md,
            cc.version_no AS change_version_no
     FROM requirement_item_contents ric
     INNER JOIN requirement_contents cc ON cc.id = ric.content_id
     LEFT JOIN requirement_contents pv
       ON pv.id = (
         SELECT prev.id
         FROM requirement_contents prev
         WHERE COALESCE(prev.content_original_id, prev.id) = COALESCE(cc.content_original_id, cc.id)
           AND prev.version_no < cc.version_no
         ORDER BY prev.version_no DESC, prev.id DESC
         LIMIT 1
       )
     LEFT JOIN requirement_contents pb
       ON pb.id = (
         SELECT pc.id
         FROM requirement_item_contents pric
         INNER JOIN requirement_contents pc ON pc.id = pric.content_id
         WHERE pric.requirement_id = ?
           AND pric.relation_type IN ('baseline', 'archived')
           AND COALESCE(pc.content_original_id, pc.id) = COALESCE(cc.content_original_id, cc.id)
         ORDER BY
           CASE pric.relation_type WHEN 'baseline' THEN 0 ELSE 1 END,
           pc.version_no DESC,
           pc.id DESC
         LIMIT 1
       )
     WHERE ric.requirement_id = ?
       AND ric.relation_type = 'change'
     ORDER BY ric.sort_order, cc.id`,
    [changeReq.parent_requirement_id, reqId]
  )

  return {
    code: 0,
    data: {
      requirement: {
        id: changeReq.id,
        reqCode: changeReq.req_code,
        title: changeReq.title,
        status: changeReq.status,
        parentRequirementId: changeReq.parent_requirement_id,
        parentReqCode: changeReq.parent_req_code,
        parentTitle: changeReq.parent_title
      },
      items: rows.map(row => ({
        contentOriginalId: row.content_original_id,
        diffStatus: row.diff_status,
        base: row.base_content_id
          ? {
              id: row.base_content_id,
              title: row.base_title,
              contentMd: row.base_content_md,
              versionNo: row.base_version_no
            }
          : null,
        change: {
          id: row.change_content_id,
          title: row.change_title,
          contentMd: row.change_content_md,
          versionNo: row.change_version_no
        }
      }))
    }
  }
})
