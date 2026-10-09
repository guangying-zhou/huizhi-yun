package aims

import (
	"bytes"
	"compress/flate"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// R1b reuses the existing receipt column. A versioned, bounded compressed result
// freezes generated IDs and outcomes without consulting mutable rows on replay.
func requirementExtendedReceiptCode(project, object, action string, value map[string]any) string {
	raw, err := json.Marshal([]any{project, object, action, value})
	if err != nil {
		return ""
	}
	var b bytes.Buffer
	w, _ := flate.NewWriter(&b, flate.BestCompression)
	_, err = w.Write(raw)
	if err != nil {
		return ""
	}
	if w.Close() != nil {
		return ""
	}
	return "r2." + base64.RawURLEncoding.EncodeToString(b.Bytes())
}
func requirementExtendedReceiptValue(project, object, action, code string) (map[string]any, error) {
	denied := func() (map[string]any, error) {
		return nil, httperror.New(409, "receipt_result_unavailable", "Requirement receipt binding is invalid")
	}
	packed, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(code, "r2."))
	if err != nil {
		return denied()
	}
	r := flate.NewReader(bytes.NewReader(packed))
	defer r.Close()
	raw, err := io.ReadAll(io.LimitReader(r, 8193))
	if err != nil || len(raw) > 8192 {
		return denied()
	}
	var result []json.RawMessage
	if json.Unmarshal(raw, &result) != nil || len(result) != 4 {
		return denied()
	}
	for i, want := range []string{project, object, action} {
		var got string
		if json.Unmarshal(result[i], &got) != nil || got != want {
			return denied()
		}
	}
	var value map[string]any
	if json.Unmarshal(result[3], &value) != nil || value == nil {
		return denied()
	}
	return value, nil
}

// All payload and persisted batch references are checked under the owning
// project lock before either replay or mutation. Missing deleted batches allow
// only a matching receipt replay; the domain command itself still returns 404.
func validateRequirementReviewReferencesTx(ctx context.Context, tx *sql.Tx, pid, oid int64, action string, body map[string]any) error {
	check := func(table string, id int64) error {
		return requireRequirementObjectProjectTx(ctx, tx, table, id, pid, false)
	}
	if ids, ok := body["requirementIds"].([]any); ok {
		if len(ids) == 0 || len(ids) > 1000 {
			return httperror.New(400, "requirement_ids_required", "Select requirement IDs")
		}
		for _, raw := range ids {
			id := int64BodyValue(map[string]any{"id": raw}, "id")
			if id <= 0 {
				return httperror.New(400, "requirement_input_invalid", "Invalid requirement ID")
			}
			if err := check("requirement_items", id); err != nil {
				return err
			}
		}
	}
	if nodes, ok := body["contents"].([]any); ok {
		for _, raw := range nodes {
			node, _ := raw.(map[string]any)
			id := int64BodyValue(node, "contentId")
			if id <= 0 {
				return httperror.New(400, "requirement_input_invalid", "Invalid content ID")
			}
			if err := check("requirement_contents", id); err != nil {
				return err
			}
		}
	}
	if action == "review-append" || action == "review-withdraw" || action == "review-sync" || action == "review-create-tasks" {
		var raw sql.NullString
		err := tx.QueryRowContext(ctx, "SELECT requirement_ids_json FROM requirement_review_batches WHERE id=? AND project_id=? FOR UPDATE", oid, pid).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) && action == "review-withdraw" {
			return nil
		}
		if err != nil {
			return err
		}
		var ids []int64
		if !raw.Valid || json.Unmarshal([]byte(raw.String), &ids) != nil || len(ids) > 1000 {
			return httperror.New(409, "review_batch_references_invalid", "Review batch references are invalid")
		}
		for _, id := range ids {
			if id <= 0 {
				return httperror.New(409, "review_batch_references_invalid", "Review batch references are invalid")
			}
		}
		for _, id := range ids {
			if err := check("requirement_items", id); err != nil {
				return err
			}
			if action == "review-sync" || action == "review-create-tasks" {
				var parent, milestone, work sql.NullInt64
				if err := tx.QueryRowContext(ctx, "SELECT parent_requirement_id,milestone_id,work_item_id FROM requirement_items WHERE id=?", id).Scan(&parent, &milestone, &work); err != nil {
					return err
				}
				for table, ref := range map[string]sql.NullInt64{"requirement_items": parent, "milestones": milestone, "work_items": work} {
					if ref.Valid {
						if err := check(table, ref.Int64); err != nil {
							return err
						}
					}
				}
				if err := validateRequirementReviewReferencesTx(ctx, tx, pid, id, "task-create", nil); err != nil {
					return err
				}
				if parent.Valid {
					var ancestor, m, w sql.NullInt64
					if err := tx.QueryRowContext(ctx, "SELECT parent_requirement_id,milestone_id,work_item_id FROM requirement_items WHERE id=?", parent.Int64).Scan(&ancestor, &m, &w); err != nil {
						return err
					}
					if ancestor.Valid {
						return httperror.New(409, "review_batch_references_invalid", "Nested change parent is invalid")
					}
					for table, ref := range map[string]sql.NullInt64{"milestones": m, "work_items": w} {
						if ref.Valid {
							if err := check(table, ref.Int64); err != nil {
								return err
							}
						}
					}
					if err := validateRequirementReviewReferencesTx(ctx, tx, pid, parent.Int64, "task-create", nil); err != nil {
						return err
					}
				}
			}
		}
	}
	if action == "change-create" || action == "task-create" {
		rows, err := tx.QueryContext(ctx, `SELECT c.project_id FROM requirement_item_contents r JOIN requirement_contents c ON c.id=r.content_id WHERE r.requirement_id=? ORDER BY c.id FOR UPDATE`, oid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var project int64
			if err := rows.Scan(&project); err != nil {
				return err
			}
			if project != pid {
				return httperror.New(403, "requirement_project_mismatch", "Related chapter belongs to another project")
			}
		}
		return rows.Err()
	}
	return nil
}

func (a *Adapter) ReadEnterpriseRequirementExtended(ctx context.Context, projectID, objectID, action string, q url.Values) (map[string]any, error) {
	if err := a.requireProjectReadAccess(ctx, projectID, q); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	ctx = context.WithValue(ctx, enterpriseRequirementTxKey{}, tx)
	var data any
	if action == "review-list" {
		batches, ids, e := a.requirementReviewBatches(ctx, projectID)
		if e != nil {
			return nil, e
		}
		m, e := a.requirementReviewRequirementMap(ctx, projectID, ids)
		if e != nil {
			return nil, e
		}
		for i := range batches {
			batches[i].Requirements = []requirementReviewBrief{}
			for _, id := range batches[i].RequirementIDs {
				if row, ok := m[id]; ok {
					batches[i].Requirements = append(batches[i].Requirements, row)
				}
			}
		}
		data = map[string]any{"batches": batches}
	} else {
		pid, e := strconv.ParseInt(projectID, 10, 64)
		if e != nil {
			return nil, e
		}
		oid, e := strconv.ParseInt(objectID, 10, 64)
		if e != nil || oid <= 0 {
			return nil, httperror.New(400, "requirement_input_invalid", "Invalid object ID")
		}
		table := "requirement_items"
		if action == "review-resolve" {
			table = "requirement_review_batches"
		}
		var owning int64
		err = tx.QueryRowContext(ctx, "SELECT project_id FROM "+table+" WHERE id=?", oid).Scan(&owning)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(404, "requirement_object_not_found", "Requirement object not found")
		}
		if err != nil {
			return nil, err
		}
		if owning != pid {
			return nil, httperror.New(404, "requirement_object_not_found", "Requirement object not found")
		}
		if table == "requirement_items" {
			var unsafe int
			err = tx.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM requirement_items r JOIN requirement_items parent ON parent.id=r.parent_requirement_id WHERE r.id=? AND parent.project_id<>r.project_id)+(SELECT COUNT(*) FROM requirement_item_contents ric JOIN requirement_contents c ON c.id=ric.content_id WHERE ric.requirement_id IN (?,(SELECT parent_requirement_id FROM requirement_items WHERE id=?)) AND c.project_id<>?)+(SELECT COUNT(*) FROM work_items w WHERE w.requirement_id=? AND w.project_id<>?)`, oid, oid, oid, pid, oid, pid).Scan(&unsafe)
			if err != nil {
				return nil, err
			}
			if unsafe > 0 {
				return nil, httperror.New(403, "requirement_project_mismatch", "Related object belongs to another project")
			}
		}
		switch action {
		case "versions":
			data, err = a.requirementVersions(ctx, objectID, q)
		case "change-diff":
			data, err = a.requirementChangeDiff(ctx, objectID, q)
		case "change-impact":
			data, err = a.requirementChangeImpact(ctx, objectID, q)
		case "review-resolve":
			data = map[string]any{"projectId": pid}
		default:
			return nil, httperror.New(400, "requirement_action_invalid", "Invalid requirement read")
		}
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "data": data}, nil
}
