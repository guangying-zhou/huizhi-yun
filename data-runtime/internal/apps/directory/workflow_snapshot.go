package directory

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type workflowDirectoryVersion struct {
	Table     string `json:"table"`
	ID        int64  `json:"id"`
	Key       string `json:"key"`
	UpdatedAt string `json:"updatedAt"`
}

// WorkflowInitiatorSnapshot is immutable after Directory's own transaction has
// ended. No business transaction or Directory connection is retained.
type WorkflowInitiatorSnapshot struct {
	raw    []byte
	digest string
}

func (s WorkflowInitiatorSnapshot) JSON() json.RawMessage {
	return append(json.RawMessage(nil), s.raw...)
}
func (s WorkflowInitiatorSnapshot) SHA256() string { return s.digest }
func (s WorkflowInitiatorSnapshot) Context() map[string]any {
	var stored struct {
		Context map[string]any `json:"context"`
	}
	// raw is created only by successful json.Marshal in the reader; callers
	// cannot mutate it. Unmarshal cannot fail for an issued snapshot.
	_ = json.Unmarshal(s.raw, &stored)
	return stored.Context
}
func workflowSnapshotUnavailable() error {
	return httperror.New(503, "workflow_directory_snapshot_unavailable", "Workflow directory snapshot unavailable")
}

// ReadWorkflowInitiatorSnapshot must be called before any unified business Tx.
// It is a complete consistent read, not multiple independently timed lookups.
func (a *Adapter) ReadWorkflowInitiatorSnapshot(ctx context.Context, actor string) (WorkflowInitiatorSnapshot, error) {
	if a == nil || a.db == nil || actor == "" || actor != strings.TrimSpace(actor) || len(actor) > 64 {
		return WorkflowInitiatorSnapshot{}, workflowSnapshotUnavailable()
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return WorkflowInitiatorSnapshot{}, workflowSnapshotUnavailable()
	}
	defer tx.Rollback()
	fail := func() (WorkflowInitiatorSnapshot, error) {
		return WorkflowInitiatorSnapshot{}, workflowSnapshotUnavailable()
	}
	var uid, status, userType, name, primary, updated string
	var userID int64
	var subjectType sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT id,uid,status,user_type,COALESCE(real_name,display_name,nickname,uid),COALESCE(primary_dept_code,''),CAST(updated_at AS CHAR) FROM directory_users WHERE BINARY uid=BINARY ?`, actor).Scan(&userID, &uid, &status, &subjectType, &name, &primary, &updated)
	if err == sql.ErrNoRows {
		return WorkflowInitiatorSnapshot{}, workflowSubjectTypeDenied()
	}
	if err != nil || uid != actor {
		return fail()
	}
	userType = subjectType.String
	if userType != "employee" || strings.HasPrefix(uid, "system:") {
		return WorkflowInitiatorSnapshot{}, workflowSubjectTypeDenied()
	}
	if status != "active" {
		return WorkflowInitiatorSnapshot{}, workflowSubjectTypeDenied()
	}
	if primary == "" || updated == "" {
		return fail()
	}
	versions := []workflowDirectoryVersion{{"directory_users", userID, uid, updated}}
	rows, err := tx.QueryContext(ctx, `SELECT ud.id,ud.dept_code,CAST(ud.updated_at AS CHAR),d.id,d.dept_name,d.org_type,d.level_no,COALESCE(d.manager_uid,''),COALESCE(d.leader_uid,''),COALESCE(d.parent_dept_code,''),CAST(d.updated_at AS CHAR)
 FROM directory_user_departments ud JOIN directory_departments d ON d.dept_code=ud.dept_code
 WHERE BINARY ud.uid=BINARY ? AND ud.status='active' AND ud.is_primary=1 AND ud.relation_type='member' AND d.status='active' AND d.org_type='department' ORDER BY ud.id`, actor)
	if err != nil {
		return fail()
	}
	var deptCode, deptName, org, manager, leader, parent, memberUpdated, deptUpdated string
	var relationID, deptID int64
	var level int
	count := 0
	for rows.Next() {
		count++
		if err = rows.Scan(&relationID, &deptCode, &memberUpdated, &deptID, &deptName, &org, &level, &manager, &leader, &parent, &deptUpdated); err != nil {
			rows.Close()
			return fail()
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil || count != 1 || deptCode != primary || memberUpdated == "" || deptUpdated == "" {
		return fail()
	}
	versions = append(versions, workflowDirectoryVersion{"directory_user_departments", relationID, uid + ":" + deptCode, memberUpdated}, workflowDirectoryVersion{"directory_departments", deptID, deptCode, deptUpdated})
	var parentManager, parentLeader any
	if parent != "" {
		var id int64
		var code, pm, pl, pu string
		err = tx.QueryRowContext(ctx, `SELECT id,dept_code,COALESCE(manager_uid,''),COALESCE(leader_uid,''),CAST(updated_at AS CHAR) FROM directory_departments WHERE dept_code=? AND status='active' AND org_type='department'`, parent).Scan(&id, &code, &pm, &pl, &pu)
		if err != nil || code != parent || pu == "" {
			return fail()
		}
		parentManager = nullWorkflowUID(pm)
		parentLeader = nullWorkflowUID(pl)
		versions = append(versions, workflowDirectoryVersion{"directory_departments", id, code, pu})
	}
	facts := map[string]any{"initiator_uid": uid, "initiator_user_type": userType, "initiator_name": name, "dept_code": deptCode, "initiator_dept_code": deptCode, "dept_name": deptName, "dept_org_type": org, "dept_level": level, "initiator_dept_manager_uid": nullWorkflowUID(manager), "initiator_dept_leader_uid": nullWorkflowUID(leader), "initiator_dept_parent_code": nullWorkflowUID(parent), "dept_manager_uid": nullWorkflowUID(manager), "dept_leader_uid": nullWorkflowUID(leader), "initiator_dept_parent_manager_uid": parentManager, "initiator_dept_parent_leader_uid": parentLeader, "initiator_roles": []string{}}
	max := ""
	for _, v := range versions {
		if v.UpdatedAt > max {
			max = v.UpdatedAt
		}
	}
	raw, err := json.Marshal(struct {
		Version      string                     `json:"version"`
		Actor        string                     `json:"actor"`
		Context      map[string]any             `json:"context"`
		Rows         []workflowDirectoryVersion `json:"rows"`
		MaxUpdatedAt string                     `json:"maxUpdatedAt"`
	}{"workflow-directory-snapshot.v1", actor, facts, versions, max})
	if err != nil {
		return fail()
	}
	if err = tx.Commit(); err != nil {
		return fail()
	}
	hash := sha256.Sum256(raw)
	return WorkflowInitiatorSnapshot{raw: raw, digest: hex.EncodeToString(hash[:])}, nil
}
func nullWorkflowUID(value string) any {
	if value == "" {
		return nil
	}
	return value
}

// WorkflowEmployees contains only facts read from Directory before business Tx.
// The backing map is private and each issued set is immutable to consumers.
type WorkflowEmployees struct{ users map[string]bool }

func (e WorkflowEmployees) Allows(uid string) bool {
	return e.users[uid] && !strings.HasPrefix(uid, "system:")
}
func workflowSubjectTypeDenied() error {
	return httperror.New(403, "workflow_subject_type_not_allowed", "Only employee subjects may participate in this Workflow lane")
}
func (a *Adapter) ReadWorkflowEmployees(ctx context.Context, uids []string) (WorkflowEmployees, error) {
	if a == nil || a.db == nil || len(uids) == 0 || len(uids) > 1000 {
		return WorkflowEmployees{}, workflowSnapshotUnavailable()
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return WorkflowEmployees{}, workflowSnapshotUnavailable()
	}
	defer tx.Rollback()
	set := WorkflowEmployees{users: map[string]bool{}}
	uids = append([]string(nil), uids...)
	sort.Strings(uids)
	for _, uid := range uids {
		if uid == "" || uid != strings.TrimSpace(uid) || strings.HasPrefix(uid, "system:") {
			return WorkflowEmployees{}, workflowSubjectTypeDenied()
		}
		if set.users[uid] {
			continue
		}
		var actual, status string
		var kind sql.NullString
		err = tx.QueryRowContext(ctx, "SELECT uid,status,user_type FROM directory_users WHERE BINARY uid=BINARY ?", uid).Scan(&actual, &status, &kind)
		if err == sql.ErrNoRows || (err == nil && actual != uid) {
			return WorkflowEmployees{}, workflowSubjectTypeDenied()
		}
		if err != nil {
			return WorkflowEmployees{}, workflowSnapshotUnavailable()
		}
		if kind.String != "employee" {
			return WorkflowEmployees{}, workflowSubjectTypeDenied()
		}
		if status != "active" {
			return WorkflowEmployees{}, workflowSubjectTypeDenied()
		}
		set.users[uid] = true
	}
	if err = tx.Commit(); err != nil {
		return WorkflowEmployees{}, workflowSnapshotUnavailable()
	}
	return set, nil
}
