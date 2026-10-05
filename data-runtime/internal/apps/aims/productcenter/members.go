package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"
)

type Member struct {
	ID           int64   `json:"id"`
	UID          string  `json:"uid"`
	RelationType string  `json:"relation_type"`
	Status       string  `json:"status"`
	ValidFrom    string  `json:"valid_from"`
	ValidUntil   *string `json:"valid_until"`
	Revision     uint64  `json:"revision"`
	Effective    bool    `json:"effective"`
}

const memberColumns = `id,uid,relation_type,status,CONCAT(LEFT(DATE_FORMAT(valid_from,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z'),CONCAT(LEFT(DATE_FORMAT(valid_until,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z'),revision,
	(status='active' AND valid_from<=UTC_TIMESTAMP(3) AND (valid_until IS NULL OR valid_until>UTC_TIMESTAMP(3)))`

func scanMember(row interface{ Scan(...any) error }) (Member, error) {
	var m Member
	err := row.Scan(&m.ID, &m.UID, &m.RelationType, &m.Status, &m.ValidFrom, &m.ValidUntil, &m.Revision, &m.Effective)
	return m, err
}

type MemberPageQuery struct {
	Page         int    `json:"page"`
	PageSize     int    `json:"page_size"`
	RelationType string `json:"relation_type"`
	Status       string `json:"status"`
}

type MemberPage struct {
	Items             []Member `json:"items"`
	Total             int      `json:"total"`
	Page              int      `json:"page"`
	PageSize          int      `json:"pageSize"`
	WorkspaceRevision uint64   `json:"workspace_revision"`
}

func ListMembers(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, input MemberPageQuery) (MemberPage, error) {
	var result MemberPage
	if input.Page < 1 || input.Page > 1000000 || input.PageSize < 1 || input.PageSize > 100 || (input.RelationType != "" && !validMemberRelation(input.RelationType)) || (input.Status != "" && input.Status != "active" && input.Status != "inactive") {
		return result, invalid("product_member_query_invalid", "成员分页或筛选条件无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "products", "admin", permit); err != nil {
		return result, err
	}
	where := ` FROM product_members WHERE product_code=? AND (?='' OR relation_type=?) AND (?='' OR status=?)`
	args := []any{code, input.RelationType, input.RelationType, input.Status, input.Status}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&result.Total); err != nil {
		return result, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT `+memberColumns+where+` ORDER BY uid,relation_type,id LIMIT ? OFFSET ?`, append(args, input.PageSize, (input.Page-1)*input.PageSize)...)
	if err != nil {
		return result, err
	}
	result.Items = []Member{}
	for rows.Next() {
		m, err := scanMember(rows)
		if err != nil {
			rows.Close()
			return result, err
		}
		result.Items = append(result.Items, m)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	result.Page, result.PageSize, result.WorkspaceRevision = input.Page, input.PageSize, permit.Facts.Revision
	return result, tx.Commit()
}

// Only the trusted BFF supplies fresh Directory results. It checks at most the
// target and one named continuing manager, never joins another app's database.
type MemberDirectoryEvidence struct {
	ActiveUIDs []string `json:"active_uids"`
	ExpiresAt  int64    `json:"expires_at"`
}

type MemberChange struct {
	MemberID               int64   `json:"member_id"`
	ExpectedRevision       uint64  `json:"expected_revision"`
	ExpectedMemberRevision uint64  `json:"expected_member_revision"`
	UID                    string  `json:"uid"`
	RelationType           string  `json:"relation_type"`
	Status                 string  `json:"status"`
	ValidFrom              string  `json:"valid_from"`
	ValidUntil             *string `json:"valid_until"`
	ContinuingManagerUID   string  `json:"continuing_manager_uid"`
	Reason                 string  `json:"reason"`
}

func validMemberRelation(value string) bool {
	return value == "manager" || value == "contributor" || value == "viewer"
}
func validMemberUID(value string) bool {
	if value == "" || value != strings.TrimSpace(value) || !utf8.ValidString(value) || utf8.RuneCountInString(value) > 64 {
		return false
	}
	for _, r := range value {
		if r < 32 || r == 127 || r == ',' {
			return false
		}
	}
	return true
}

func parseMemberDate(value string) (time.Time, error) {
	t, err := time.Parse("2006-01-02T15:04:05.000Z", value)
	if err != nil || t.Year() < 1000 || t.Format("2006-01-02T15:04:05.000Z") != value {
		return time.Time{}, invalid("product_member_dates_invalid", "成员有效期须为 UTC 毫秒时间")
	}
	return t, nil
}

func ChangeMember(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, evidence MemberDirectoryEvidence, input MemberChange) (CommandResult, error) {
	action := strings.TrimPrefix(identity.Action, "products:member-")
	if identity.Action != "products:member-"+action || (action != "create" && action != "update" && action != "revoke") {
		return CommandResult{}, invalid("product_action_invalid", "不支持的成员操作")
	}
	if input.ExpectedRevision == 0 || !validMemberUID(input.UID) || !validMemberUID(input.ContinuingManagerUID) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 {
		return CommandResult{}, invalid("product_member_input_invalid", "成员、版本号、接管经理及操作原因不能为空")
	}
	if (action == "create" && (input.MemberID != 0 || input.ExpectedMemberRevision != 0)) || (action != "create" && (input.MemberID <= 0 || input.ExpectedMemberRevision == 0)) {
		return CommandResult{}, invalid("product_member_input_invalid", "成员版本号无效")
	}
	var from time.Time
	var until any
	if action != "revoke" {
		if !validMemberRelation(input.RelationType) || (input.Status != "active" && input.Status != "inactive") {
			return CommandResult{}, invalid("product_member_input_invalid", "成员关系或状态无效")
		}
		var err error
		from, err = parseMemberDate(input.ValidFrom)
		if err != nil {
			return CommandResult{}, err
		}
		if input.ValidUntil != nil {
			end, err := parseMemberDate(*input.ValidUntil)
			if err != nil {
				return CommandResult{}, err
			}
			if !end.After(from) {
				return CommandResult{}, invalid("product_member_dates_invalid", "失效时间必须晚于生效时间")
			}
			until = end.Format("2006-01-02 15:04:05.000")
		}
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if err := AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "products", "admin", permit); err != nil {
			return err
		}
		var now int64
		if err := tx.QueryRowContext(ctx, `SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED)`).Scan(&now); err != nil {
			return err
		}
		if evidence.ExpiresAt <= now || evidence.ExpiresAt > now+30000 || len(evidence.ActiveUIDs) > 2 {
			return invalid("product_directory_evidence_invalid", "目录用户校验已过期或无效")
		}
		active := map[string]bool{}
		for _, uid := range evidence.ActiveUIDs {
			active[uid] = true
		}
		if !active[input.ContinuingManagerUID] || ((action == "create" || (action == "update" && input.Status == "active")) && !active[input.UID]) {
			return invalid("product_member_subject_inactive", "目标成员或接管经理不是有效目录用户")
		}
		return nil
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		workspace, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if workspace.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品成员已变化，请刷新重试")
		}
		if workspace.Status != "active" {
			return nil, invalid("product_archived", "归档产品不能调整成员")
		}
		var before *Member
		id := input.MemberID
		if action != "create" {
			m, err := scanMember(tx.QueryRowContext(ctx, `SELECT `+memberColumns+` FROM product_members WHERE product_code=? AND id=?`, identity.ProductCode, id))
			if err != nil {
				return nil, err
			}
			if m.UID != input.UID {
				return nil, invalid("product_member_identity_mismatch", "成员用户不可变更")
			}
			if m.Revision != input.ExpectedMemberRevision {
				return nil, invalid("product_member_revision_conflict", "成员关系已变化")
			}
			before = &m
		}
		if action == "create" {
			res, err := tx.ExecContext(ctx, `INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,valid_until,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, identity.ProductCode, input.UID, input.RelationType, input.Status, from.Format("2006-01-02 15:04:05.000"), until, identity.ActorUID, identity.ActorUID)
			if err != nil {
				return nil, err
			}
			id, err = res.LastInsertId()
			if err != nil {
				return nil, err
			}
		} else if action == "revoke" {
			_, err = tx.ExecContext(ctx, `UPDATE product_members SET status='inactive',revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, identity.ActorUID, identity.ProductCode, id)
		} else {
			_, err = tx.ExecContext(ctx, `UPDATE product_members SET relation_type=?,status=?,valid_from=?,valid_until=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=? AND id=?`, input.RelationType, input.Status, from.Format("2006-01-02 15:04:05.000"), until, identity.ActorUID, identity.ProductCode, id)
		}
		if err != nil {
			return nil, err
		}
		var managerExists bool
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM product_members WHERE product_code=? AND uid=? AND relation_type='manager' AND status='active' AND valid_from<=UTC_TIMESTAMP(3) AND (valid_until IS NULL OR valid_until>UTC_TIMESTAMP(3)))`, identity.ProductCode, input.ContinuingManagerUID).Scan(&managerExists)
		if err != nil {
			return nil, err
		}
		if !managerExists {
			return nil, invalid("product_last_manager", "调整后必须保留一位当前有效的产品经理")
		}
		after, err := scanMember(tx.QueryRowContext(ctx, `SELECT `+memberColumns+` FROM product_members WHERE product_code=? AND id=?`, identity.ProductCode, id))
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason, "continuing_manager_uid": input.ContinuingManagerUID})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'member',?,?,?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, id, action, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return map[string]any{"member": after, "workspace_revision": workspace.Revision + 1}, err
	})
}
