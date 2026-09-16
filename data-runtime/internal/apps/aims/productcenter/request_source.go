package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// ManualRequestSource cannot assert a verified external application identity.
// Formal source_app/source_biz_id references belong to a validated integration.
type ManualRequestSource struct {
	BizID                   string  `json:"biz_id"`
	ExpectedRevision        uint64  `json:"expected_revision"`
	ExpectedRequestRevision uint64  `json:"expected_request_revision"`
	Note                    string  `json:"note"`
	EvidenceDate            *string `json:"evidence_date"`
	Kind                    string  `json:"kind"`
	Direction               string  `json:"direction"`
}

func ValidateManualRequestSource(input ManualRequestSource) error {
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.ExpectedRevision == 0 || input.ExpectedRequestRevision == 0 {
		return invalid("product_request_revision_required", "必须提供需求标识与双版本号")
	}
	if !utf8.ValidString(input.Note) || strings.TrimSpace(input.Note) == "" || utf8.RuneCountInString(input.Note) > 10000 || strings.ContainsRune(input.Note, '\x00') {
		return invalid("product_source_note_invalid", "请填写有效的来源说明")
	}
	if input.Kind != "fact" && input.Kind != "assumption" {
		return invalid("product_source_kind_invalid", "请选择事实或假设")
	}
	if input.Direction != "supporting" && input.Direction != "opposing" && input.Direction != "neutral" {
		return invalid("product_source_direction_invalid", "证据方向无效")
	}
	if input.EvidenceDate != nil {
		date, err := time.Parse("2006-01-02", *input.EvidenceDate)
		if err != nil || date.Year() < 1000 || date.Format("2006-01-02") != *input.EvidenceDate {
			return invalid("product_source_date_invalid", "证据日期无效")
		}
	}
	return nil
}

func AddManualRequestSource(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ManualRequestSource) (CommandResult, error) {
	if identity.Action != "product_requests:source-create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "来源添加命令不匹配")
	}
	if err := ValidateManualRequestSource(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_requests", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档，请先恢复")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品空间已变化，请刷新后重试")
		}
		request, err := scanRequest(tx.QueryRowContext(ctx, `SELECT `+requestColumns+` FROM product_requests WHERE product_code=? AND biz_id=?`, identity.ProductCode, input.BizID))
		if err != nil {
			return nil, err
		}
		if request.Revision != input.ExpectedRequestRevision {
			return nil, invalid("product_request_revision_conflict", "需求已变化，请刷新后重试")
		}
		if request.DecisionStatus == "merged" {
			return nil, invalid("product_request_merged_readonly", "已合并需求只读保留")
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO product_request_sources(request_id,source_type,source_note,evidence_date,evidence_kind,direction,verification_status,created_by,updated_by,created_at,updated_at) VALUES (?,'manual',?,?,?,?,'unverified',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, request.ID, input.Note, input.EvidenceDate, input.Kind, input.Direction, identity.ActorUID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_requests SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND product_code=?`, identity.ActorUID, request.ID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_planning_items i JOIN product_planning_item_requests r ON r.planning_item_id=i.id AND r.product_code=i.product_code SET i.evidence_revision=i.evidence_revision+1,i.revision=i.revision+1,i.updated_by=?,i.updated_at=UTC_TIMESTAMP(3) WHERE r.product_code=? AND r.request_id=?`, identity.ActorUID, identity.ProductCode, request.ID)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		after := map[string]any{"id": id, "request_biz_id": input.BizID, "source_type": "manual", "source_note": input.Note, "evidence_date": input.EvidenceDate, "evidence_kind": input.Kind, "direction": input.Direction, "verification_status": "unverified", "revision": 1}
		changes, err := json.Marshal(map[string]any{"after": after})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'request_source',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, id, identity.ActorUID, changes, identity.IdempotencyKey)
		return map[string]any{"source": after, "request_revision": request.Revision + 1, "workspace_revision": root.Revision + 1}, err
	})
}

type RequestSourceRecord struct {
	ID                 int64   `json:"id"`
	SourceApp          *string `json:"source_app"`
	SourceType         string  `json:"source_type"`
	SourceBizID        *string `json:"source_biz_id"`
	Note               string  `json:"source_note"`
	EvidenceDate       *string `json:"evidence_date"`
	Kind               string  `json:"evidence_kind"`
	Direction          string  `json:"direction"`
	VerificationStatus string  `json:"verification_status"`
	Revision           uint64  `json:"revision"`
	CreatedBy          string  `json:"created_by"`
	CreatedAt          string  `json:"created_at"`
}
type RequestSourcePageQuery struct {
	BizID    string `json:"biz_id"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
}
type RequestSourcePage struct {
	Items             []RequestSourceRecord `json:"items"`
	Total             int                   `json:"total"`
	Page              int                   `json:"page"`
	PageSize          int                   `json:"pageSize"`
	RequestRevision   uint64                `json:"request_revision"`
	WorkspaceRevision uint64                `json:"workspace_revision"`
}

func ListRequestSources(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, input RequestSourcePageQuery) (RequestSourcePage, error) {
	var out RequestSourcePage
	id, err := uuid.Parse(input.BizID)
	if err != nil || id.String() != input.BizID || input.Page < 1 || input.Page > 1000000 || input.PageSize < 1 || input.PageSize > 100 {
		return out, invalid("product_source_query_invalid", "来源分页或需求标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_requests", "view", permit); err != nil {
		return out, err
	}
	var requestID int64
	if err := tx.QueryRowContext(ctx, `SELECT id,revision FROM product_requests WHERE product_code=? AND biz_id=?`, code, input.BizID).Scan(&requestID, &out.RequestRevision); err != nil {
		return out, err
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_request_sources WHERE request_id=?`, requestID).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,source_app,source_type,source_biz_id,source_note,DATE_FORMAT(evidence_date,'%Y-%m-%d'),evidence_kind,direction,verification_status,revision,created_by,CONCAT(LEFT(DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z') FROM product_request_sources WHERE request_id=? ORDER BY id DESC LIMIT ? OFFSET ?`, requestID, input.PageSize, (input.Page-1)*input.PageSize)
	if err != nil {
		return out, err
	}
	out.Items = []RequestSourceRecord{}
	for rows.Next() {
		var r RequestSourceRecord
		if err := rows.Scan(&r.ID, &r.SourceApp, &r.SourceType, &r.SourceBizID, &r.Note, &r.EvidenceDate, &r.Kind, &r.Direction, &r.VerificationStatus, &r.Revision, &r.CreatedBy, &r.CreatedAt); err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	out.Page, out.PageSize, out.WorkspaceRevision = input.Page, input.PageSize, permit.Facts.Revision
	return out, tx.Commit()
}
