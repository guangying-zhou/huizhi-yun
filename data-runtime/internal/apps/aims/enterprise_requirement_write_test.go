package aims

import (
	"context"
	"errors"
	"fmt"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"
)

func TestEnterpriseRequirementInputCannotSetReviewOrAuthority(t *testing.T) {
	for action := range enterpriseRequirementFields {
		for _, key := range []string{"status", "approvedBy", "reviewerUid", "current_user", "projectId", "project_id", "permit"} {
			if validateEnterpriseRequirementPayload(action, map[string]any{key: "forged"}) == nil {
				t.Fatalf("%s accepted %s", action, key)
			}
		}
	}
	for _, body := range []map[string]any{{"title": ""}, {"title": "x", "milestoneId": 1.5}, {"title": "x", "contentIds": []any{2.5}}, {"title": "x", "priority": "super"}} {
		if validateEnterpriseRequirementPayload("create", body) == nil {
			t.Fatalf("invalid create accepted: %#v", body)
		}
	}
	if err := validateEnterpriseRequirementPayload("create", map[string]any{"title": "中文需求", "contentIds": []any{float64(1)}, "priority": "P1"}); err != nil {
		t.Fatal(err)
	}
}
func TestEnterpriseRequirementReceiptFreezesOutcomeAndBinding(t *testing.T) {
	body := map[string]any{"title": "original"}
	code := requirementReceiptCode("12", "", "create", map[string]any{"id": int64(42), "reqNumber": int64(1), "reqCode": "P-REQ-001"})
	first, err := requirementReceiptValue("12", "", "create", code, body)
	if err != nil || first["id"] != float64(42) {
		t.Fatalf("%#v %v", first, err)
	}
	for _, args := range [][3]string{{"13", "", "create"}, {"12", "42", "create"}, {"12", "", "delete"}} {
		if _, err = requirementReceiptValue(args[0], args[1], args[2], code, body); err == nil {
			t.Fatal("cross-target receipt accepted")
		}
	}
	if _, err = requirementReceiptValue("12", "", "create", "[]", body); err == nil {
		t.Fatal("malformed receipt accepted")
	}
}
func TestEnterpriseRequirementListFiltersBeforePagination(t *testing.T) {
	where, args := requirementListWhere("263", url.Values{"status": {"active"}, "work_item_id": {"9"}, "search": {"100%"}})
	if where != "r.project_id=? AND r.status<>'deprecated' AND r.work_item_id=? AND (LOCATE(?,r.title)>0 OR LOCATE(?,r.req_code)>0)" || len(args) != 4 {
		t.Fatalf("%s %#v", where, args)
	}
}

// Only the fixed write entry may install this trusted identity, after its
// authoritative leader/active-manager/scoped-admin check has failed closed.
func TestEnterpriseRequirementIdentityInstalledOnlyAfterManagementGuard(t *testing.T) {
	raw, err := os.ReadFile("enterprise_requirement_write.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	install := "context.WithValue(ctx, enterpriseRequirementIdentityKey{}"
	guard := strings.Index(source, "if managers == 0 {")
	denied := strings.Index(source, `return nil, httperror.New(403, "project_manager_required"`)
	index := strings.Index(source, install)
	if guard < 0 || denied <= guard || index <= denied || strings.Count(source, install) != 1 {
		t.Fatal("trusted requirement identity must only be installed after the management guard rejects unauthorized actors")
	}
	for _, token := range []string{"BINARY p.leader_uid=BINARY ?", "pm.role='manager'", "projectScopedAdminWhere(q"} {
		if i := strings.Index(source, token); i < 0 || i >= guard {
			t.Fatalf("missing authoritative management check: %s", token)
		}
	}
	files, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".go") || strings.HasSuffix(file.Name(), "_test.go") || file.Name() == "enterprise_requirement_write.go" {
			continue
		}
		data, err := os.ReadFile(file.Name())
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), install) {
			t.Fatalf("unexpected identity installer: %s", file.Name())
		}
	}
}

func TestEnterpriseRequirementIdentityMustMatchActorAndAuthoritativeProject(t *testing.T) {
	for _, content := range []bool{false, true} {
		for _, tt := range []struct {
			name, uid string
			project   int64
			want      int
		}{
			{"matching", "Actor", 263, 0}, {"different uid", "Other", 263, 403},
			{"uid case", "actor", 263, 403}, {"different project", "Actor", 264, 403},
		} {
			t.Run(fmt.Sprintf("content=%t/%s", content, tt.name), func(t *testing.T) {
				a, mock, cleanup := newAimsSQLMockAdapter(t)
				defer cleanup()
				var err error
				table := "requirement_items"
				if content {
					table = "requirement_contents"
				}
				mock.ExpectQuery(regexp.QuoteMeta("SELECT project_id FROM " + table + " WHERE id = ?")).WithArgs(int64(9)).WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(tt.project))
				ctx := context.WithValue(context.Background(), enterpriseRequirementIdentityKey{}, enterpriseRequirementIdentity{ActorUID: "Actor", ProjectID: 263})
				if content {
					err = a.requireRequirementContentProjectManagerOrScopedAdmin(ctx, 9, tt.uid, nil)
				} else {
					err = a.requireRequirementProjectManagerOrScopedAdmin(ctx, 9, tt.uid, nil)
				}
				if tt.want == 0 {
					if err != nil {
						t.Fatal(err)
					}
				} else {
					var h httperror.Error
					if !errors.As(err, &h) || h.Status != tt.want {
						t.Fatalf("want %d, got %v", tt.want, err)
					}
				}
				if err := mock.ExpectationsWereMet(); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestEnterpriseRequirementReceiptCodeUsesIdentitySafeEncoding(t *testing.T) {
	for _, action := range []string{"create", "content-create", "import", "update", "delete", "content-update", "content-delete", "content-restore"} {
		code := requirementReceiptCode("981001", "", action, map[string]any{"id": int64(42), "reqCode": "R1A-REQ-001"})
		if len(code) > 191 || !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,239}$`).MatchString(code) {
			t.Fatalf("invalid receipt identity for %s", action)
		}
		if _, err := requirementReceiptValue("981001", "", action, code, nil); err != nil {
			t.Fatal(err)
		}
	}
}
