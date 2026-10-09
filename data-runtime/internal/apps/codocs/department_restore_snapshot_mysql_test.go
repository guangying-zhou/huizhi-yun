package codocs

import (
	"context"
	"database/sql"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Recycle-bin restore of snapshot-backed (v2) department documents (H1c, A9/A10):
// restore flips the status only; the snapshot head stays intact and the plan
// tells the Host not to copy any mirror. Runs in the R1 disposable-MySQL suite
// (Directory and Codocs in separate schemas).
func TestMySQLDepartmentCollaborationRestoreSnapshotBacked(t *testing.T) {
	env := newDeptCollabEnv(t)
	mgr := func(context.Context, *sql.Tx, string, string) error { return nil }
	identity := func(key string) EnterpriseDepartmentFolderIdentity {
		id := departmentFolderIdentity()
		id.Actor, id.Key = "mgr", key+"-"+uuid.NewString()
		return id
	}
	setPath := func(u, path string) {
		dcExec(t, env.docDB, `UPDATE documents SET oss_path=? WHERE uuid=?`, path, u)
	}
	docState := func(u string) (status int64, path string) {
		if err := env.docDB.QueryRow(`SELECT status, oss_path FROM documents WHERE uuid=?`, u).Scan(&status, &path); err != nil {
			t.Fatal(err)
		}
		return
	}

	for name, path := range map[string]string{"mirror-path": "codocs/departments/D1/v2.md", "recycle-bin-path": "recycle.bin/departments/D1/v2.md"} {
		name, path := name, path
		t.Run(name, func(t *testing.T) {
			u := env.v2Doc("owner")
			gen0, epoch0 := env.head(u)
			if err := env.manage("mgr", "recycle", u, nil); err != nil {
				t.Fatal(err)
			}
			setPath(u, path)
			plan, err := env.a.PlanEnterpriseDepartmentDocumentRestore(env.ctx, identity("plan"), u, map[string]any{}, mgr)
			if err != nil {
				t.Fatal(err)
			}
			if plan["snapshot_backed"] != true || plan["deleted"] != true {
				t.Fatalf("plan not snapshot backed: %v", plan)
			}
			want := path
			if name == "recycle-bin-path" {
				want = "codocs/document-restores/" + u + "/" + plan["state_sha256"].(string) + ".md"
			}
			if plan["target_path"] != want {
				t.Fatalf("target=%v want %v", plan["target_path"], want)
			}
			_, err = env.a.RestoreEnterpriseDepartmentDocument(env.ctx, identity("stale"), u, map[string]any{"state_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, mgr)
			env.wantStatus(err, 409, "department_restore_state_changed")
			if status, _ := docState(u); status != 0 {
				t.Fatalf("stale restore changed status to %d", status)
			}
			result, err := env.a.RestoreEnterpriseDepartmentDocument(env.ctx, identity("commit"), u, map[string]any{"state_sha256": plan["state_sha256"]}, mgr)
			if err != nil || result["restored"] != true {
				t.Fatalf("restore: %v %v", result, err)
			}
			if status, got := docState(u); status != 1 || got != want {
				t.Fatalf("status=%d path=%q want %q", status, got, want)
			}
			if gen, epoch := env.head(u); gen != gen0 || epoch < epoch0 {
				t.Fatalf("head changed: gen %d->%d epoch %d->%d", gen0, gen, epoch0, epoch)
			}
			if _, err := env.open("owner", u); err != nil {
				t.Fatalf("restored v2 document cannot open a session: %v", err)
			}
		})
	}

	t.Run("v1-document-is-not-snapshot-backed", func(t *testing.T) {
		u := env.newDoc("owner", "department", "D1")
		setPath(u, "codocs/departments/D1/v1.md")
		if err := env.manage("mgr", "recycle", u, nil); err != nil {
			t.Fatal(err)
		}
		plan, err := env.a.PlanEnterpriseDepartmentDocumentRestore(env.ctx, identity("plan-v1"), u, map[string]any{}, mgr)
		if err != nil || plan["snapshot_backed"] != false {
			t.Fatalf("plan=%v err=%v", plan, err)
		}
	})

	t.Run("non-manager-and-foreign-scope-stay-refused", func(t *testing.T) {
		u := env.v2Doc("owner")
		if err := env.manage("mgr", "recycle", u, nil); err != nil {
			t.Fatal(err)
		}
		setPath(u, "codocs/departments/D1/v2b.md")
		denied := func(context.Context, *sql.Tx, string, string) error {
			return httperror.New(403, "department_manager_required", "Department manager required")
		}
		_, err := env.a.PlanEnterpriseDepartmentDocumentRestore(env.ctx, identity("deny"), u, map[string]any{}, denied)
		env.wantStatus(err, 403, "department_manager_required")
		other := identity("other")
		other.Department = "D2"
		_, err = env.a.PlanEnterpriseDepartmentDocumentRestore(env.ctx, other, u, map[string]any{}, mgr)
		env.wantStatus(err, 403, "department_document_scope_denied")
	})
}

// Read-only department version history (H1c, A11): a department reader without a
// share reads the history row created with the v2 head and that exact version
// under the trusted department context; a mismatching context or a missing
// delegation stays refused.
func TestMySQLDepartmentCollaborationVersionHistoryReads(t *testing.T) {
	env := newDeptCollabEnv(t)
	u := env.v2Doc("owner")
	query := func(actor, dept string, delegated bool) url.Values {
		q := url.Values{"current_user": {actor}, "operator_uid": {actor}}
		if delegated {
			q.Set("hzy_runtime_actor_delegated", "1")
		}
		if dept != "" {
			q.Set("trusted_department_read_dept_code", dept)
		}
		return q
	}
	list, err := env.a.documentVersions(env.ctx, u, query("reader", "D1", true))
	if err != nil {
		t.Fatal(err)
	}
	items, _ := list["items"].([]map[string]any)
	if len(items) != 1 || !strings.HasPrefix(stringValue(items[0]["object_key"]), "codocs/snapshots/") {
		t.Fatalf("list=%v", list)
	}
	one, err := env.a.documentVersion(env.ctx, u, strconv.FormatInt(int64Value(items[0]["id"]), 10), query("reader", "D1", true))
	if err != nil || int64Value(one["version_num"]) != 1 {
		t.Fatalf("view=%v err=%v", one, err)
	}
	_, err = env.a.documentVersions(env.ctx, u, query("outsider", "D2", true))
	env.wantStatus(err, 403, "permission_denied")
	_, err = env.a.documentVersions(env.ctx, u, query("outsider", "", true))
	env.wantStatus(err, 403, "permission_denied")
	_, err = env.a.documentVersions(env.ctx, u, query("reader", "D1", false))
	env.wantStatus(err, 403, "trusted_actor_required")
}
