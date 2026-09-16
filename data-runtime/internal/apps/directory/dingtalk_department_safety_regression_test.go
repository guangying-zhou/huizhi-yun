package directory

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestFinalizeDingTalkDepartmentSnapshotRevisionReplayContract(t *testing.T) {
	snapshotHash := strings.Repeat("a", 64)
	tests := []struct {
		name         string
		existingHash string
		wantReplay   bool
		wantCode     string
	}{
		{name: "same hash replays prior result", existingHash: snapshotHash, wantReplay: true},
		{name: "different hash conflicts", existingHash: strings.Repeat("b", 64), wantCode: "dingtalk_organization_snapshot_conflict"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()

			mock.ExpectBegin()
			mock.ExpectQuery(`(?s)SELECT id,snapshot_hash,status,risk_level,missing_department_count.*directory_department_snapshot_runs.*FOR UPDATE`).
				WithArgs("revision-1").
				WillReturnRows(sqlmock.NewRows([]string{"id", "snapshot_hash", "status", "risk_level", "missing_department_count"}).
					AddRow(41, tt.existingHash, "awaiting_confirmation", "high", 2))
			mock.ExpectRollback()

			result, err := newAdapter(database, false, "tenant-1", "", "").FinalizeDingTalkDepartmentSnapshot(
				context.Background(),
				validDingTalkSnapshotFinalBody(snapshotHash, 2),
				"connector-1",
			)
			if tt.wantCode != "" {
				assertDirectoryHTTPError(t, err, http.StatusConflict, tt.wantCode)
			} else {
				if err != nil {
					t.Fatalf("FinalizeDingTalkDepartmentSnapshot: %v", err)
				}
				if result["replayed"] != tt.wantReplay || result["runId"] != int64(41) ||
					result["status"] != "awaiting_confirmation" || result["riskLevel"] != "high" ||
					result["missingDepartmentCount"] != 2 {
					t.Fatalf("result = %#v", result)
				}
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestFinalizeDingTalkDepartmentSnapshotRejectsEvidenceMismatch(t *testing.T) {
	rootDigest := dingTalkDepartmentSnapshotLeafHash("1", "汇智云", "", 10, "")
	computedHash := sha256Hex([]byte("1\n" + rootDigest))
	tests := []struct {
		name          string
		reportedCount int
		snapshotHash  string
		rootCount     *int
		wantCode      string
	}{
		{
			name: "reported count differs from applied identities", reportedCount: 2,
			snapshotHash: computedHash, wantCode: "dingtalk_organization_snapshot_evidence_mismatch",
		},
		{
			name: "reported hash differs from applied identities", reportedCount: 1,
			snapshotHash: strings.Repeat("a", 64), wantCode: "dingtalk_organization_snapshot_evidence_mismatch",
		},
		{
			name: "root identity is not an active canonical root", reportedCount: 1,
			snapshotHash: computedHash, rootCount: intPointer(0), wantCode: "dingtalk_organization_root_invalid",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()

			mock.ExpectBegin()
			mock.ExpectQuery(`(?s)SELECT id,snapshot_hash,status,risk_level,missing_department_count.*directory_department_snapshot_runs.*FOR UPDATE`).
				WithArgs("revision-1").
				WillReturnRows(sqlmock.NewRows([]string{"id", "snapshot_hash", "status", "risk_level", "missing_department_count"}))
			mock.ExpectQuery(`(?s)SELECT external_department_id,source_payload_hash.*directory_department_identities.*last_snapshot_revision=\?`).
				WithArgs("revision-1").
				WillReturnRows(sqlmock.NewRows([]string{"external_department_id", "source_payload_hash"}).AddRow("1", rootDigest))
			if tt.rootCount != nil {
				mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*directory_department_identities identities.*departments.parent_dept_code`).
					WithArgs("1", "revision-1").
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(*tt.rootCount))
			}
			mock.ExpectRollback()

			_, err = newAdapter(database, false, "tenant-1", "", "").FinalizeDingTalkDepartmentSnapshot(
				context.Background(),
				validDingTalkSnapshotFinalBody(tt.snapshotHash, tt.reportedCount),
				"connector-1",
			)
			assertDirectoryHTTPError(t, err, http.StatusConflict, tt.wantCode)
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestConsoleApplyDingTalkDepartmentSnapshotChangesRejectsStaleRun(t *testing.T) {
	snapshotHash := strings.Repeat("a", 64)
	tests := []struct {
		name        string
		currentHash string
		runStatus   string
	}{
		{name: "hash changed", currentHash: strings.Repeat("b", 64), runStatus: "awaiting_confirmation"},
		{name: "run already applied", currentHash: snapshotHash, runStatus: "applied"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()

			originalRandom := rand.Reader
			rand.Reader = bytes.NewReader(make([]byte, 16))
			t.Cleanup(func() { rand.Reader = originalRandom })
			receiptID := "00000000-0000-4000-8000-000000000000"
			payloadJSON, err := json.Marshal(map[string]any{
				"snapshotRunId": int64(41), "snapshotHash": snapshotHash, "departmentCodes": []string{"DPT-OLD"},
			})
			if err != nil {
				t.Fatal(err)
			}
			requestHash := sha256.Sum256(payloadJSON)

			mock.ExpectBegin()
			mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
				WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
				WithArgs("tenant-1", "directory.dingtalk-department-snapshot.apply", "snapshot-stale-1").
				WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
					AddRow(receiptID, hex.EncodeToString(requestHash[:]), "processing", nil))
			mock.ExpectQuery(`(?s)SELECT snapshot_revision,snapshot_hash,status.*directory_department_snapshot_runs.*FOR UPDATE`).
				WithArgs(int64(41)).
				WillReturnRows(sqlmock.NewRows([]string{"snapshot_revision", "snapshot_hash", "status"}).
					AddRow("revision-1", tt.currentHash, tt.runStatus))
			mock.ExpectRollback()

			_, err = newAdapter(database, false, "tenant-1", "", "").ConsoleApplyDingTalkDepartmentSnapshotChanges(
				context.Background(),
				map[string]any{
					"snapshotRunId": int64(41), "snapshotHash": snapshotHash,
					"departmentCodes": []any{"DPT-OLD"},
				},
				ConsoleMutationMeta{IdempotencyKey: "snapshot-stale-1", ActorID: "people-admin-1", ActorType: "human"},
			)
			assertDirectoryHTTPError(t, err, http.StatusConflict, "dingtalk_department_snapshot_stale")
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestApplyDingTalkDepartmentMappingsRejectsIdentityConflicts(t *testing.T) {
	tests := []struct {
		name     string
		identity func(sqlmock.Sqlmock)
		wantCode string
	}{
		{
			name: "external identity is immutable",
			identity: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`(?s)SELECT dept_code FROM directory_department_identities.*external_department_id=\?.*FOR UPDATE`).
					WithArgs("1").
					WillReturnRows(sqlmock.NewRows([]string{"dept_code"}).AddRow("DPT-OTHER"))
			},
			wantCode: "dingtalk_department_mapping_immutable",
		},
		{
			name: "canonical department already has another identity",
			identity: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery(`(?s)SELECT dept_code FROM directory_department_identities.*external_department_id=\?.*FOR UPDATE`).
					WithArgs("1").
					WillReturnRows(sqlmock.NewRows([]string{"dept_code"}))
				mock.ExpectQuery(`(?s)SELECT external_department_id FROM directory_department_identities.*dept_code=\?.*status='active'.*FOR UPDATE`).
					WithArgs("DPT-TARGET").
					WillReturnRows(sqlmock.NewRows([]string{"external_department_id"}).AddRow("2"))
			},
			wantCode: "dingtalk_canonical_department_already_mapped",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()

			originalRandom := rand.Reader
			rand.Reader = bytes.NewReader(make([]byte, 16))
			t.Cleanup(func() { rand.Reader = originalRandom })
			receiptID := "00000000-0000-4000-8000-000000000000"
			rawMappings := []any{map[string]any{
				"externalDepartmentId": "1",
				"canonicalDeptCode":    "DPT-TARGET",
			}}
			payloadJSON, err := json.Marshal(map[string]any{"mappings": rawMappings})
			if err != nil {
				t.Fatal(err)
			}
			requestHash := sha256.Sum256(payloadJSON)

			mock.ExpectBegin()
			mock.ExpectExec(`(?s)INSERT INTO console_mutation_receipts`).
				WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectQuery(`(?s)SELECT receipt_id,request_sha256,status,result_json.*console_mutation_receipts.*FOR UPDATE`).
				WithArgs("tenant-1", "directory.dingtalk-department-mappings.apply", "mapping-conflict-1").
				WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "request_sha256", "status", "result_json"}).
					AddRow(receiptID, hex.EncodeToString(requestHash[:]), "processing", nil))
			mock.ExpectQuery(`(?s)SELECT dept_code FROM directory_departments.*source_provider='dingtalk'.*FOR UPDATE`).
				WithArgs("dingtalk:department:1").
				WillReturnRows(sqlmock.NewRows([]string{"dept_code"}).AddRow("DT-1"))
			mock.ExpectQuery(`(?s)SELECT status,org_type,COALESCE\(source_provider,''\),COALESCE\(external_ref,''\).*directory_departments.*FOR UPDATE`).
				WithArgs("DPT-TARGET").
				WillReturnRows(sqlmock.NewRows([]string{"status", "org_type", "source_provider", "external_ref"}).
					AddRow("active", "department", "people", ""))
			tt.identity(mock)
			mock.ExpectRollback()

			_, err = newAdapter(database, false, "tenant-1", "", "").ConsoleApplyDingTalkDepartmentMappings(
				context.Background(),
				map[string]any{"mappings": rawMappings},
				ConsoleMutationMeta{IdempotencyKey: "mapping-conflict-1", ActorID: "people-admin-1", ActorType: "human"},
			)
			assertDirectoryHTTPError(t, err, http.StatusConflict, tt.wantCode)
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func validDingTalkSnapshotFinalBody(snapshotHash string, departmentCount int) map[string]any {
	return map[string]any{
		"final":                        true,
		"objectScopes":                 []string{"organization"},
		"jobId":                        "job-1",
		"watermark":                    "revision-1",
		"organizationSnapshotComplete": true,
		"organizationRootDepartmentId": "1",
		"organizationDepartmentCount":  departmentCount,
		"organizationSnapshotHash":     snapshotHash,
	}
}

func assertDirectoryHTTPError(t *testing.T, err error, wantStatus int, wantCode string) {
	t.Helper()
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != wantStatus || httpErr.Code != wantCode {
		t.Fatalf("error = %#v, want status=%d code=%q", err, wantStatus, wantCode)
	}
}

func intPointer(value int) *int {
	return &value
}
