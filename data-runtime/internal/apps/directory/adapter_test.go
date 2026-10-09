package directory

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func signedDirectoryRequest(t *testing.T, key *rsa.PrivateKey, connectorID, path string, body map[string]any) *http.Request {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return signedDirectoryRawRequest(t, key, connectorID, path, encoded)
}

func signedDirectoryRawRequest(t *testing.T, key *rsa.PrivateKey, connectorID, path string, encoded []byte) *http.Request {
	t.Helper()
	bodyDigest := sha256.Sum256(encoded)
	bodySHA := hex.EncodeToString(bodyDigest[:])
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonce := "0123456789abcdef01234567"
	canonical := canonicalRequest(http.MethodPost, path, timestamp, nonce, bodySHA)
	digest := sha256.Sum256([]byte(canonical))
	signature, err := rsa.SignPSS(rand.Reader, key, crypto.SHA256, digest[:], nil)
	if err != nil {
		t.Fatal(err)
	}
	request := &http.Request{Method: http.MethodPost, URL: &url.URL{Path: path}, Header: make(http.Header)}
	request.Header.Set(headerConnectorID, connectorID)
	request.Header.Set(headerTimestamp, timestamp)
	request.Header.Set(headerNonce, nonce)
	request.Header.Set(headerBodySHA256, bodySHA)
	request.Header.Set(headerSignature, base64.RawURLEncoding.EncodeToString(signature))
	return request
}

func TestAuthenticateRequestVerifiesEnrolledConnectorSignature(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
	mock.ExpectQuery("SELECT connector_id,tenant_code,deployment_code,public_key_pem").
		WithArgs("connector-1").
		WillReturnRows(sqlmock.NewRows([]string{"connector_id", "tenant_code", "deployment_code", "public_key_pem"}).
			AddRow("connector-1", "C000001", "C000001-console", publicPEM))

	adapter := &Adapter{db: database, tenant: "C000001"}
	body := map[string]any{"fullSync": true, "users": []any{}}
	request := signedDirectoryRequest(t, key, "connector-1", "/runtime/internal/directory-connector/sync", body)
	identity, err := adapter.AuthenticateRequest(context.Background(), request, body)
	if err != nil {
		t.Fatalf("AuthenticateRequest returned error: %v", err)
	}
	if identity.ConnectorID != "connector-1" || identity.TenantCode != "C000001" || identity.DeploymentCode != "C000001-console" {
		t.Fatalf("unexpected connector identity: %#v", identity)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAuthenticateRequestRejectsBodyDigestMismatchBeforeDatabaseLookup(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	signedBody := map[string]any{"fullSync": true}
	request := signedDirectoryRequest(t, key, "connector-1", "/runtime/internal/directory-connector/sync", signedBody)
	adapter := &Adapter{db: database, tenant: "C000001"}
	if _, err := adapter.AuthenticateRequest(context.Background(), request, map[string]any{"fullSync": false}); err == nil {
		t.Fatal("expected body digest mismatch")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAuthenticateConnectorRuntimeRequestUsesRegisteredRuntimeKey(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
	mock.ExpectQuery("SELECT connector_id,tenant_code,deployment_code,public_key_pem FROM connector_runtime_instances").WithArgs("connector-runtime.C000001-console").WillReturnRows(sqlmock.NewRows([]string{"connector_id", "tenant_code", "deployment_code", "public_key_pem"}).AddRow("connector-runtime.C000001-console", "C000001", "C000001-console", publicPEM))
	body := map[string]any{"jobId": "crj_1", "batchNumber": float64(1)}
	request := signedDirectoryRequest(t, key, "connector-runtime.C000001-console", "/runtime/internal/connector-runtime/people-sync-batches", body)
	request.Header.Set(headerRuntimeID, request.Header.Get(headerConnectorID))
	request.Header.Set(headerRuntimeTimestamp, request.Header.Get(headerTimestamp))
	request.Header.Set(headerRuntimeNonce, request.Header.Get(headerNonce))
	request.Header.Set(headerRuntimeBodySHA, request.Header.Get(headerBodySHA256))
	request.Header.Set(headerRuntimeSignature, request.Header.Get(headerSignature))
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := (&Adapter{db: database, tenant: "C000001"}).AuthenticateConnectorRuntimeRequest(context.Background(), request, encoded)
	if err != nil {
		t.Fatal(err)
	}
	if identity.ConnectorID != "connector-runtime.C000001-console" {
		t.Fatalf("unexpected identity: %#v", identity)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAuthenticateConnectorRuntimeRequestHashesOriginalJSONBytes(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	publicPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER}))
	mock.ExpectQuery("SELECT connector_id,tenant_code,deployment_code,public_key_pem FROM connector_runtime_instances").
		WithArgs("connector-runtime.C000001-console").
		WillReturnRows(sqlmock.NewRows([]string{"connector_id", "tenant_code", "deployment_code", "public_key_pem"}).
			AddRow("connector-runtime.C000001-console", "C000001", "C000001-console", publicPEM))

	rawBody := []byte(`{"jobId":"crj_1","batchNumber":1}`)
	request := signedDirectoryRawRequest(t, key, "connector-runtime.C000001-console", "/runtime/internal/connector-runtime/people-sync-batches", rawBody)
	request.Header.Set(headerRuntimeID, request.Header.Get(headerConnectorID))
	request.Header.Set(headerRuntimeTimestamp, request.Header.Get(headerTimestamp))
	request.Header.Set(headerRuntimeNonce, request.Header.Get(headerNonce))
	request.Header.Set(headerRuntimeBodySHA, request.Header.Get(headerBodySHA256))
	request.Header.Set(headerRuntimeSignature, request.Header.Get(headerSignature))

	identity, err := (&Adapter{db: database, tenant: "C000001"}).AuthenticateConnectorRuntimeRequest(context.Background(), request, rawBody)
	if err != nil {
		t.Fatal(err)
	}
	if identity.ConnectorID != "connector-runtime.C000001-console" {
		t.Fatalf("unexpected identity: %#v", identity)
	}
}

func TestDingTalkPeopleBatchBindsExistingCanonicalDepartmentAndUsesStableCode(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}

	mock.ExpectBegin()
	mock.ExpectQuery(`FROM directory_department_identities i`).
		WithArgs("1").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id"}).AddRow("RD", 7))
	mock.ExpectExec(`UPDATE directory_departments`).
		WithArgs("研发部", nil, "", "/", 1, 100, true, nil, sqlmock.AnyArg(), int64(7)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE directory_department_identities`).
		WithArgs(sqlmock.AnyArg(), "", "snapshot-1", "1", "RD").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO directory_subject_exports`).
		WithArgs("RD").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	if applied, err := adapter.ApplyDingTalkDepartmentBatch(context.Background(), map[string]any{
		"watermark":   "snapshot-1",
		"departments": []any{map[string]any{"providerId": "1", "name": "研发部"}},
	}); err != nil || applied != 1 {
		t.Fatalf("department applied=%d err=%v", applied, err)
	}

	mock.ExpectQuery(`FROM directory_identities di INNER JOIN directory_users du`).
		WithArgs("ding-new-hire").
		WillReturnRows(sqlmock.NewRows([]string{"uid", "username", "display_name", "status", "primary_dept_code", "position_title"}))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM directory_users`).
		WithArgs("new@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	// 未命中既有身份的新员工不再合成 dt-* 主体，而是成为入职候选。
	// 部门解析也不再发生：canonical 部门是 HR 在入职单上确认的事实。
	items, candidates, skipped, err := adapter.ResolveDingTalkPeopleBatch(context.Background(), map[string]any{
		"users": []any{map[string]any{
			"providerSubject": "ding-new-hire", "name": "新员工", "employeeNumber": "E100",
			"email": "NEW@example.com", "departmentIds": []any{"1"},
			"employmentStatus": "active", "onboardDate": "2026-07-01", "active": true,
			"mobile": "13800000000", "managerSubject": "ding-manager",
		}},
	})
	if err != nil || skipped != 0 || len(items) != 0 || len(candidates) != 1 {
		t.Fatalf("items=%#v candidates=%#v skipped=%d err=%v", items, candidates, skipped, err)
	}
	candidate := candidates[0]
	if _, present := candidate["employee_uid"]; present {
		t.Fatalf("an onboarding candidate must not carry an employee uid: %#v", candidate)
	}
	if candidate["provider_subject"] != "ding-new-hire" ||
		candidate["candidate_name"] != "新员工" ||
		candidate["mobile"] != "13800000000" ||
		candidate["source_onboard_date"] != "2026-07-01" ||
		candidate["manager_provider_subject"] != "ding-manager" {
		t.Fatalf("candidate was not normalized: %#v", candidate)
	}
	if _, exists := candidate["employee_no"]; exists {
		t.Fatalf("DingTalk job number must not enter an onboarding candidate: %#v", candidate)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkDepartmentCreatesOpaqueCanonicalCodeInsteadOfDTTree(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}

	mock.ExpectBegin()
	mock.ExpectQuery(`FROM directory_department_identities i`).
		WithArgs("22").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id"}))
	mock.ExpectQuery(`FROM directory_departments legacy`).
		WithArgs(dingTalkDepartmentRef("22")).
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id"}))
	mock.ExpectQuery(`FROM directory_departments department`).
		WithArgs("").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id", "dept_name"}))
	mock.ExpectExec(`INSERT INTO directory_departments`).
		WithArgs(sqlmock.AnyArg(), "新事业部", nil, "", "/", 1, 100, nil).
		WillReturnResult(sqlmock.NewResult(42, 1))
	mock.ExpectExec(`UPDATE directory_departments SET source_payload_hash`).
		WithArgs(sqlmock.AnyArg(), int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT external_department_id FROM directory_department_identities`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"external_department_id"}))
	mock.ExpectExec(`INSERT INTO directory_department_identities`).
		WithArgs("22", sqlmock.AnyArg(), "source_created", sqlmock.AnyArg(), "", "snapshot-2").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO directory_subject_exports`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	applied, err := adapter.ApplyDingTalkDepartmentBatch(context.Background(), map[string]any{
		"watermark":   "snapshot-2",
		"departments": []any{map[string]any{"providerId": "22", "name": "新事业部"}},
	})
	if err != nil || applied != 1 {
		t.Fatalf("department applied=%d err=%v", applied, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkDepartmentBootstrapBindsUniqueExistingFormalDepartment(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}

	mock.ExpectBegin()
	mock.ExpectQuery(`FROM directory_department_identities i`).WithArgs("1").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id"}))
	mock.ExpectQuery(`FROM directory_departments legacy`).WithArgs(dingTalkDepartmentRef("1")).
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id"}))
	mock.ExpectQuery(`FROM directory_departments department`).WithArgs("").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id", "dept_name"}).AddRow("RD", 7, "研发部"))
	mock.ExpectExec(`UPDATE directory_departments`).
		WithArgs("研发部", nil, "", "/", 1, 100, true, nil, sqlmock.AnyArg(), int64(7)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT external_department_id FROM directory_department_identities`).WithArgs("RD").
		WillReturnRows(sqlmock.NewRows([]string{"external_department_id"}))
	mock.ExpectExec(`INSERT INTO directory_department_identities`).
		WithArgs("1", "RD", "path_matched", sqlmock.AnyArg(), "", "2026-08-28T00:00:00Z").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO directory_subject_exports`).WithArgs("RD").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	applied, err := adapter.ApplyDingTalkDepartmentBatch(context.Background(), map[string]any{
		"watermark": "2026-08-28T00:00:00Z",
		"departments": []any{map[string]any{
			"providerId": "1", "name": "研发部",
		}},
	})
	if err != nil || applied != 1 {
		t.Fatalf("department applied=%d err=%v", applied, err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkDepartmentBootstrapFailsClosedWhenExistingFormalDepartmentIsUnresolved(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}
	mock.ExpectBegin()
	mock.ExpectQuery(`FROM directory_department_identities i`).WithArgs("1").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id"}))
	mock.ExpectQuery(`FROM directory_departments legacy`).WithArgs(dingTalkDepartmentRef("1")).
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id"}))
	mock.ExpectQuery(`FROM directory_departments department`).WithArgs("").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id", "dept_name"}).AddRow("RD", 7, "同名但需人工对齐"))
	mock.ExpectRollback()

	_, err = adapter.ApplyDingTalkDepartmentBatch(context.Background(), map[string]any{
		"watermark": "2026-08-28T00:00:00Z",
		"departments": []any{map[string]any{
			"providerId": "1", "name": "研发部",
		}},
	})
	assertDirectoryHTTPError(t, err, http.StatusConflict, "dingtalk_department_mapping_required")
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkDepartmentBootstrapFailsClosedWhenSiblingRemainsUnbound(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}
	mock.ExpectBegin()
	mock.ExpectQuery(`FROM directory_department_identities i`).WithArgs("1").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id"}))
	mock.ExpectQuery(`FROM directory_departments legacy`).WithArgs(dingTalkDepartmentRef("1")).
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id"}))
	mock.ExpectQuery(`FROM directory_departments department`).WithArgs("").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "id", "dept_name"}).
			AddRow("RD", 7, "研发部").
			AddRow("OPS", 8, "运营部"))
	mock.ExpectRollback()

	_, err = adapter.ApplyDingTalkDepartmentBatch(context.Background(), map[string]any{
		"watermark": "2026-08-28T00:00:00Z",
		"departments": []any{map[string]any{
			"providerId": "1", "name": "研发部",
		}},
	})
	assertDirectoryHTTPError(t, err, http.StatusConflict, "dingtalk_department_mapping_required")
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkPeopleBatchSkipsAmbiguousDirectoryEmail(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}

	mock.ExpectQuery(`FROM directory_identities di INNER JOIN directory_users du`).
		WithArgs("ding-ambiguous").
		WillReturnRows(sqlmock.NewRows([]string{"uid", "username", "display_name", "status", "primary_dept_code", "position_title"}))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM directory_users`).
		WithArgs("shared@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))

	items, _, skipped, err := adapter.ResolveDingTalkPeopleBatch(context.Background(), map[string]any{
		"users": []any{map[string]any{
			"providerSubject": "ding-ambiguous", "name": "重名员工",
			"email": "shared@example.com", "employmentStatus": "active",
		}},
	})
	if err != nil || skipped != 1 || len(items) != 0 {
		t.Fatalf("items=%#v skipped=%d err=%v", items, skipped, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkPeopleBatchPassesPrivateFactsOnlyWhenProviderSentThem(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}
	mock.ExpectQuery(`FROM directory_identities di INNER JOIN directory_users du`).
		WithArgs("ding-existing").
		WillReturnRows(sqlmock.NewRows([]string{"uid", "username", "display_name", "status", "primary_dept_code", "position_title"}).
			AddRow("u1", "u1", "测试员工", "active", "RD", "工程师"))

	items, _, skipped, err := adapter.ResolveDingTalkPeopleBatch(context.Background(), map[string]any{
		"users": []any{map[string]any{
			"providerSubject": "ding-existing", "name": "测试员工", "employmentStatus": "active",
			"idNumber": "110101199001011234", "birthDate": "1990-01-01",
			"educationLevel": "本科", "graduationSchool": "测试大学",
		}},
	})
	if err != nil || skipped != 0 || len(items) != 1 {
		t.Fatalf("items=%#v skipped=%d err=%v", items, skipped, err)
	}
	if items[0]["id_number"] != "110101199001011234" || items[0]["birth_date"] != "1990-01-01" || items[0]["graduation_school"] != "测试大学" {
		t.Fatalf("private facts were not preserved: %#v", items[0])
	}
	if _, exists := items[0]["graduation_date"]; exists {
		t.Fatalf("an absent provider field must stay absent: %#v", items[0])
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkOnboardingCandidatePreservesAbsentAndExplicitEmptyFields(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}
	emptyIdentityRows := func() *sqlmock.Rows {
		return sqlmock.NewRows([]string{"uid", "username", "display_name", "status", "primary_dept_code", "position_title"})
	}
	for _, subject := range []string{"ding-absent", "ding-empty"} {
		mock.ExpectQuery(`FROM directory_identities di INNER JOIN directory_users du`).
			WithArgs(subject).
			WillReturnRows(emptyIdentityRows())
	}

	_, candidates, skipped, err := adapter.ResolveDingTalkPeopleBatch(context.Background(), map[string]any{
		"users": []any{
			map[string]any{"providerSubject": "ding-absent", "name": "未下发", "employmentStatus": "active"},
			map[string]any{"providerSubject": "ding-empty", "name": "显式空", "employmentStatus": "active", "mobile": "", "onboardDate": ""},
		},
	})
	if err != nil || skipped != 0 || len(candidates) != 2 {
		t.Fatalf("candidates=%#v skipped=%d err=%v", candidates, skipped, err)
	}
	if _, ok := candidates[0]["mobile"]; ok {
		t.Fatalf("absent mobile must remain absent: %#v", candidates[0])
	}
	if _, ok := candidates[0]["source_onboard_date"]; ok {
		t.Fatalf("absent onboard date must remain absent: %#v", candidates[0])
	}
	if value, ok := candidates[1]["mobile"]; !ok || value != "" {
		t.Fatalf("explicit empty mobile must remain present: %#v", candidates[1])
	}
	if value, ok := candidates[1]["source_onboard_date"]; !ok || value != "" {
		t.Fatalf("explicit empty onboard date must remain present: %#v", candidates[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkPeopleBatchRejectsUnmappedPrimaryDepartment(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}

	mock.ExpectQuery(`FROM directory_identities di INNER JOIN directory_users du`).
		WithArgs("ding-existing").
		WillReturnRows(sqlmock.NewRows([]string{"uid", "username", "display_name", "status", "primary_dept_code", "position_title"}).
			AddRow("U-1", "u1", "用户一", "active", "RD", "工程师"))
	mock.ExpectQuery(`FROM directory_department_identities i`).
		WithArgs("missing-dept").
		WillReturnRows(sqlmock.NewRows([]string{"dept_code", "dept_name"}))

	items, _, _, err := adapter.ResolveDingTalkPeopleBatch(context.Background(), map[string]any{
		"users": []any{map[string]any{
			"providerSubject": "ding-existing", "name": "用户一",
			"primaryDepartmentId": "missing-dept", "employmentStatus": "active",
		}},
	})
	if err == nil || items != nil || !strings.Contains(err.Error(), "primary department") {
		t.Fatalf("items=%#v err=%v", items, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkPeopleBatchSkipsUnknownHistoricalDepartureButKeepsMappedDeparture(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	adapter := &Adapter{db: database, tenant: "C000001"}
	emptyIdentityRows := func() *sqlmock.Rows {
		return sqlmock.NewRows([]string{"uid", "username", "display_name", "status", "primary_dept_code", "position_title"})
	}
	mock.ExpectQuery(`FROM directory_identities di INNER JOIN directory_users du`).
		WithArgs("never-managed").
		WillReturnRows(emptyIdentityRows())
	mock.ExpectQuery(`FROM directory_identities di INNER JOIN directory_users du`).
		WithArgs("mapped-left").
		WillReturnRows(emptyIdentityRows().AddRow("u-left", "", "已离职员工", "inactive", nil, nil))

	items, _, skipped, err := adapter.ResolveDingTalkPeopleBatch(context.Background(), map[string]any{
		"users": []any{
			map[string]any{"providerSubject": "never-managed", "employmentStatus": "left", "leaveDate": "2025-01-01"},
			map[string]any{"providerSubject": "mapped-left", "employmentStatus": "left", "leaveDate": "2026-07-01"},
		},
	})
	if err != nil || skipped != 1 || len(items) != 1 {
		t.Fatalf("items=%#v skipped=%d err=%v", items, skipped, err)
	}
	if items[0]["employee_uid"] != "u-left" || items[0]["employment_status"] != "left" || items[0]["leave_date"] != "2026-07-01" {
		t.Fatalf("mapped departure was not normalized: %#v", items[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProjectionSnapshotHashIsOrderIndependent(t *testing.T) {
	left := []subjectProjectionItem{
		{SubjectType: "user", SubjectCode: "u2", Status: "active", SnapshotHash: "h2"},
		{SubjectType: "user", SubjectCode: "u1", Status: "active", SnapshotHash: "h1"},
	}
	right := []subjectProjectionItem{left[1], left[0]}
	if projectionSnapshotHash(left, nil) != projectionSnapshotHash(right, nil) {
		t.Fatal("projection hash must not depend on database row order")
	}
}

func TestLoadSubjectProjectionPreservesProjectSubjectType(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	mock.ExpectQuery("SELECT subject_type,subject_code,external_ref,parent_subject_type").
		WillReturnRows(sqlmock.NewRows([]string{
			"subject_type", "subject_code", "external_ref", "parent_subject_type", "parent_subject_code", "status", "snapshot_hash",
		}).AddRow("project", "PRJ-001", "hashed-project", "project", "PRJ-ROOT", "active", "snapshot-project"))
	mock.ExpectQuery("SELECT ud.uid,ud.dept_code").
		WillReturnRows(sqlmock.NewRows([]string{
			"uid", "container_code", "container_type", "relation_type", "is_primary", "status",
		}).AddRow("U1001", "PRJ-001", "project", "leader", true, "active"))

	items, memberships, err := (&Adapter{db: database}).loadSubjectProjection(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].SubjectType != "project" ||
		items[0].ParentSubjectType == nil || *items[0].ParentSubjectType != "project" {
		t.Fatalf("project subject type was not preserved at the Platform edge: %#v", items)
	}
	if len(memberships) != 1 || memberships[0].ContainerSubjectType != "project" ||
		memberships[0].RelationType != "leader" || !memberships[0].IsPrimary {
		t.Fatalf("project membership type was not preserved at the Platform edge: %#v", memberships)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPushSubjectProjectionUsesEnrolledRuntimeCredentialAndOmitsDirectoryPII(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	mock.ExpectQuery("SELECT subject_type,subject_code,external_ref,parent_subject_type").
		WillReturnRows(sqlmock.NewRows([]string{
			"subject_type", "subject_code", "external_ref", "parent_subject_type", "parent_subject_code", "status", "snapshot_hash",
		}).AddRow("user", "liukai", "hashed-ref", "department", "D001", "active", "snapshot-1"))
	mock.ExpectQuery("SELECT ud.uid,ud.dept_code").
		WillReturnRows(sqlmock.NewRows([]string{
			"uid", "dept_code", "org_type", "relation_type", "is_primary", "status",
		}).AddRow("liukai", "D001", "department", "member", true, "active"))

	var received []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/runtime/subjects/sync" || request.Header.Get("authorization") != "Bearer hzy_dr_test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		received = append(received, payload)
		itemCount := len(payload["items"].([]any))
		membershipCount := len(payload["memberships"].([]any))
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{
			"acceptedCount": itemCount, "membershipAcceptedCount": membershipCount,
		}})
	}))
	defer server.Close()

	adapter := &Adapter{
		db: database, platformURL: server.URL, runtimeToken: "hzy_dr_test", projectionHTTP: server.Client(),
	}
	result, err := adapter.pushSubjectProjection(context.Background(), ConnectorIdentity{
		TenantCode: "C000001", DeploymentCode: "C000001-console",
	}, "job-1")
	if err != nil {
		t.Fatal(err)
	}
	if result["acceptedCount"] != int64(1) || result["chunkCount"] != 2 {
		t.Fatalf("unexpected Platform response: %#v", result)
	}
	if len(received) != 2 {
		t.Fatalf("expected subject and membership chunks, got %d", len(received))
	}
	if received[0]["tenantCode"] != "C000001" || received[0]["deploymentId"] != "C000001-console" {
		t.Fatalf("unexpected projection binding: %#v", received)
	}
	if received[0]["resetMemberships"] != true || received[0]["finalize"] != false || received[1]["resetMemberships"] != false || received[1]["finalize"] != true {
		t.Fatalf("unexpected chunk lifecycle flags: %#v", received)
	}
	encoded, _ := json.Marshal(received)
	for _, forbidden := range []string{"email", "mobile", "displayName", "providerDn", "cn=liukai"} {
		if stringContains(string(encoded), forbidden) {
			t.Fatalf("projection leaked forbidden Directory field %q: %s", forbidden, encoded)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPushSubjectProjectionStopsAfterPlatformReportsUnchangedSnapshot(t *testing.T) {
	database, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	mock.ExpectQuery("SELECT subject_type,subject_code,external_ref,parent_subject_type").
		WillReturnRows(sqlmock.NewRows([]string{
			"subject_type", "subject_code", "external_ref", "parent_subject_type", "parent_subject_code", "status", "snapshot_hash",
		}).AddRow("user", "liukai", "hashed-ref", "department", "D001", "active", "snapshot-1"))
	mock.ExpectQuery("SELECT ud.uid,ud.dept_code").
		WillReturnRows(sqlmock.NewRows([]string{
			"uid", "dept_code", "org_type", "relation_type", "is_primary", "status",
		}).AddRow("liukai", "D001", "department", "member", true, "active"))

	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		requests++
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"unchanged": true}})
	}))
	defer server.Close()

	adapter := &Adapter{
		db: database, platformURL: server.URL, runtimeToken: "hzy_dr_test", projectionHTTP: server.Client(),
	}
	result, err := adapter.pushSubjectProjection(context.Background(), ConnectorIdentity{
		TenantCode: "C000001", DeploymentCode: "C000001-console",
	}, "job-unchanged")
	if err != nil {
		t.Fatal(err)
	}
	if requests != 1 {
		t.Fatalf("expected one snapshot probe instead of every chunk, got %d", requests)
	}
	if result["unchanged"] != true || result["chunkCount"] != 1 {
		t.Fatalf("unexpected unchanged result: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func stringContains(value, substring string) bool {
	return len(substring) > 0 && len(value) >= len(substring) && strings.Contains(value, substring)
}
