package codocs

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const deptCollabUnitUUID = "00000000-0000-4000-8000-000000000017"

func deptCollabDocRows(kind, dept, project string, readonly, status int, ossPath string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "owner_uid", "doc_type", "dept_code", "project_code", "readonly_flag", "status", "oss_path"}).AddRow(9, "owner", kind, dept, project, readonly, status, ossPath)
}

func TestLockDepartmentDocumentRules(t *testing.T) {
	cases := []struct {
		name                         string
		kind, dept, project          string
		readonly, status, wantStatus int
		wantCode                     string
		ossPath                      string
	}{
		{"writable department document", "department", "D1", "", 0, 1, 0, "", ""},
		{"private document", "private", "", "", 0, 1, 403, "department_document_scope_denied", ""},
		{"other department", "department", "D2", "", 0, 1, 403, "department_document_scope_denied", ""},
		{"project document", "project", "D1", "P1", 0, 1, 403, "department_document_scope_denied", ""},
		{"department doc with project code", "department", "D1", "P1", 0, 1, 403, "department_document_scope_denied", ""},
		{"recycled", "department", "D1", "", 0, 0, 404, "document_not_found", ""},
		{"published or archived status", "department", "D1", "", 0, 2, 403, "snapshot_document_not_writable", ""},
		{"read-only", "department", "D1", "", 1, 1, 403, "snapshot_document_not_writable", ""},
		{"weekly report stays out of collaboration", "department", "D1", "", 0, 1, 403, "department_document_not_collaborative", "codocs/departments/D1/weekly-reports/w1.md"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			mock.ExpectQuery(`FROM documents WHERE uuid = \? FOR UPDATE`).WithArgs(deptCollabUnitUUID).WillReturnRows(deptCollabDocRows(tc.kind, tc.dept, tc.project, tc.readonly, tc.status, tc.ossPath))
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			doc, err := lockDepartmentDocument(context.Background(), tx, "D1", deptCollabUnitUUID, true)
			if tc.wantCode == "" {
				if err != nil || doc.ID != 9 || doc.Owner != "owner" {
					t.Fatalf("doc=%+v err=%v", doc, err)
				}
				return
			}
			var he httperror.Error
			if !errors.As(err, &he) || he.Status != tc.wantStatus || he.Code != tc.wantCode {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestDepartmentWriterRuleMatrix(t *testing.T) {
	member := DepartmentCollabRole{CanWrite: true}
	manager := DepartmentCollabRole{CanWrite: true, CanManage: true}
	none := DepartmentCollabRole{} // leader, parent and non-members never write
	cases := []struct {
		name       string
		role       DepartmentCollabRole
		uid        string
		share      string // "" = no share row; "-" = the share is not consulted
		wantQuery  bool
		wantAllows bool
	}{
		{"leader or parent, even as owner", none, "owner", "-", false, false},
		{"leader or parent with write share", none, "other", "-", false, false},
		{"manager of someone else's document", manager, "other", "-", false, true},
		{"member owner", member, "owner", "-", false, true},
		{"member with write share", member, "other", "write", false, true},
		{"member with read share", member, "other", "read", false, true},
		{"member without share", member, "other", "", false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			if tc.wantQuery {
				rows := sqlmock.NewRows([]string{"permission"})
				if tc.share != "" {
					rows.AddRow(tc.share)
				}
				mock.ExpectQuery(`FROM document_shares.*FOR UPDATE`).WithArgs(int64(9), tc.uid).WillReturnRows(rows)
			}
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			allowed, err := (departmentDocument{ID: 9, Owner: "owner"}).allows(context.Background(), tx, tc.role, tc.uid)
			if err != nil || allowed != tc.wantAllows {
				t.Fatalf("allowed=%v err=%v", allowed, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDepartmentHostPolicyConvertsGenerationZeroMarkdownOnly(t *testing.T) {
	policy := &departmentSnapshotPolicy{dept: "D1", host: true, actor: DepartmentCollabRole{CanWrite: true}}
	// Neither check reaches the database.
	err := policy.checkWrite(context.Background(), nil, PersonalFolderCreationIdentity{}, SnapshotCommand{UUID: deptCollabUnitUUID, Generation: 1}, 0)
	var he httperror.Error
	if !errors.As(err, &he) || he.Status != http.StatusConflict || he.Code != "department_snapshot_conversion_only" {
		t.Fatalf("err=%v", err)
	}
	err = policy.checkWrite(context.Background(), nil, PersonalFolderCreationIdentity{}, SnapshotCommand{UUID: deptCollabUnitUUID, YjsSHA256: strings.Repeat("d", 64), YjsSize: 1}, 0)
	if !errors.As(err, &he) || he.Status != http.StatusBadRequest || he.Code != "department_snapshot_conversion_invalid" {
		t.Fatalf("err=%v", err)
	}
	// Leader/parent roles cannot even start a conversion.
	_, err = (&Adapter{}).PrepareDepartmentConversionSnapshot(context.Background(), PersonalFolderCreationIdentity{Client: "enterprise.runtime"}, "D1", DepartmentCollabRole{}, SnapshotCommand{})
	if !errors.As(err, &he) || he.Status != http.StatusForbidden || he.Code != "department_writer_required" {
		t.Fatalf("err=%v", err)
	}
	_, err = (&Adapter{}).OpenDepartmentCollaborationSession(context.Background(), PersonalFolderCreationIdentity{Client: "enterprise.runtime", Tenant: "t", Deployment: "d", Actor: "a"}, "D1", deptCollabUnitUUID, DepartmentCollabRole{})
	if !errors.As(err, &he) || he.Status != http.StatusForbidden || he.Code != "department_writer_required" {
		t.Fatalf("err=%v", err)
	}
}

func TestParticipantsRevokedErrorKeepsTheHTTPErrorAndItsDetails(t *testing.T) {
	err := error(ParticipantsRevokedError{Base: httperror.New(409, "collaboration_participant_revoked", "x"), UIDs: []string{"a"}})
	var he httperror.Error
	var revoked ParticipantsRevokedError
	if !errors.As(err, &he) || he.Status != 409 || !errors.As(err, &revoked) || revoked.UIDs[0] != "a" {
		t.Fatalf("err=%v", err)
	}
	if isParticipantsChanged(err) || !isParticipantsChanged(errParticipantsChanged()) {
		t.Fatal("participants-changed classification wrong")
	}
}

func TestPrivatePolicyIsTheOriginalBehaviour(t *testing.T) {
	// The private policy adds no lock step and delegates to the original functions.
	release, err := privateSnapshotPolicy{}.begin(context.Background(), &Adapter{}, PersonalFolderCreationIdentity{}, deptCollabUnitUUID)
	if err != nil || release == nil {
		t.Fatalf("begin: %v", err)
	}
	release()
}
