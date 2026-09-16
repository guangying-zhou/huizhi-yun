package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var notificationAuthorizationFactsQuery = regexp.QuoteMeta("SELECT wi.id,") + ".*FROM work_items wi"

func notificationAuthorizationQuery(uid string) url.Values {
	return url.Values{
		"current_user":                {uid},
		"hzy_runtime_actor_purpose":   {notificationDetailActorPurpose},
		"hzy_runtime_tenant_code":     {"tenant-a"},
		"hzy_runtime_deployment_code": {"deployment-a"},
	}
}

func notificationAuthorizationBody(stage string) map[string]any {
	return map[string]any{
		"stage":          stage,
		"notificationId": "notification-1",
		"descriptor": map[string]any{
			"resource": "work_item",
			"id":       "042",
		},
	}
}

func notificationAuthorizationRows(confidentiality string, ownerUID any, memberID any, projectUpdatedAt string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"work_item_id", "project_id", "project_code", "dept_code", "confidentiality_level",
		"leader_uid", "created_by", "work_item_updated_at", "project_updated_at", "member_id",
	}).AddRow(
		int64(42), int64(9), "PRJ-9", "DEPT-A", confidentiality,
		ownerUID, "creator-1", "2026-07-10 12:00:00", projectUpdatedAt, memberID,
	)
}

func expectNotificationAuthorizationFacts(mock sqlmock.Sqlmock, uid string, confidentiality string, ownerUID any, memberID any, projectUpdatedAt string) {
	mock.ExpectQuery(notificationAuthorizationFactsQuery).
		WithArgs(uid, int64(42)).
		WillReturnRows(notificationAuthorizationRows(confidentiality, ownerUID, memberID, projectUpdatedAt))
}

func prepareNotificationAuthorization(t *testing.T, adapter *Adapter, mock sqlmock.Sqlmock, uid string, confidentiality string) map[string]any {
	t.Helper()
	expectNotificationAuthorizationFacts(mock, uid, confidentiality, "owner-1", nil, "2026-07-10 12:00:00")
	data, operation, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery(uid), notificationAuthorizationBody("prepare"),
	)
	if err != nil || !handled || operation != "aims.notification_details.authorize" {
		t.Fatalf("handled=%v operation=%s err=%v", handled, operation, err)
	}
	return data.(map[string]any)
}

func finalizeNotificationAuthorizationBody(challenge map[string]any, basis ...string) map[string]any {
	body := notificationAuthorizationBody("finalize")
	body["authorizationChallenge"] = challenge
	rawBasis := make([]any, 0, len(basis))
	for _, item := range basis {
		rawBasis = append(rawBasis, item)
	}
	body["decisionBinding"] = map[string]any{
		"allowed":          true,
		"appCode":          "aims",
		"resourceCode":     "projects",
		"action":           "admin",
		"factsHash":        challenge["factsHash"],
		"policyRevision":   float64(17),
		"policyBundleHash": "bundle-hash-17",
		"scopeBasis":       rawBasis,
	}
	return body
}

func TestAimsNotificationDetailAuthorizationAllowsRuntimeProvenActiveMember(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	expectNotificationAuthorizationFacts(mock, "u-1", "L2", "owner-1", int64(81), "2026-07-10 12:00:00")

	data, operation, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-1"), notificationAuthorizationBody("prepare"),
	)
	if err != nil || !handled || operation != "aims.notification_details.authorize" {
		t.Fatalf("handled=%v operation=%s err=%v", handled, operation, err)
	}
	result := data.(map[string]any)
	if result["authorized"] != true || result["id"] != "42" || result["resource"] != "work_item" || len(result) != 4 {
		t.Fatalf("result=%#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAimsNotificationDetailAuthorizationSupportsExactDeadLetterGeneration(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	operationID := "550e8400-e29b-41d4-a716-446655440099"
	query := notificationAuthorizationQuery("u-1")
	query.Set("hzy_runtime_source_app", "aims")
	mock.ExpectQuery(`(?s)SELECT d.recipient_uids.*d.closure_state.*i.status.*i.version_no.*d.source_operation_version.*WHERE d.operation_id = \?.*d.notification_id = \?.*d.tenant_code = \?.*d.deployment_code = \?.*d.source_app = \?`).
		WithArgs(operationID, "notification-1", "tenant-a", "deployment-a", "aims").
		WillReturnRows(sqlmock.NewRows([]string{"recipient_uids", "closure_state", "status", "version_no", "source_operation_version"}).AddRow(`["u-1"]`, nil, "dead_letter", 7, 7))
	data, operation, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize", query, map[string]any{"notificationId": "notification-1", "descriptor": map[string]any{"resource": "integration_operation", "id": operationID}})
	if err != nil || !handled || operation != "aims.notification_details.authorize" {
		t.Fatalf("handled=%v operation=%s err=%v", handled, operation, err)
	}
	result := data.(map[string]any)
	if len(result) != 4 || result["authorized"] != true || result["reasonCode"] != "allowed" || result["resource"] != "integration_operation" || result["id"] != operationID {
		t.Fatalf("result=%#v", result)
	}
}

func TestAimsNotificationDetailAuthorizationAllowsRuntimeProvenLeader(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	expectNotificationAuthorizationFacts(mock, "owner-1", "L3", "owner-1", nil, "2026-07-10 12:00:00")

	data, _, _, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("owner-1"), notificationAuthorizationBody("prepare"),
	)
	if err != nil || data.(map[string]any)["authorized"] != true {
		t.Fatalf("data=%#v err=%v", data, err)
	}
}

func TestAimsNotificationDetailAuthorizationChallengeUsesOnlyDatabaseFacts(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	expectNotificationAuthorizationFacts(mock, "u-2", "L2", "owner-1", nil, "2026-07-10 12:00:00")
	body := notificationAuthorizationBody("prepare")
	body["projectCode"] = "INJECTED"
	body["departmentCode"] = "INJECTED"
	body["authorizationChallenge"] = map[string]any{"factsHash": "attacker"}
	query := notificationAuthorizationQuery("u-2")
	query.Set("current_user_project_admin_dept_codes", "INJECTED")
	query.Set("current_user_is_project_admin", "1")

	data, _, _, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize", query, body,
	)
	if err != nil {
		t.Fatal(err)
	}
	result := data.(map[string]any)
	challenge := result["authorizationChallenge"].(map[string]any)
	object := challenge["object"].(map[string]any)
	if result["authorized"] != false || result["reasonCode"] != "scoped_authorization_required" {
		t.Fatalf("result=%#v", result)
	}
	if len(result) != 5 || len(challenge) != 6 || len(object) != 4 {
		t.Fatalf("non-minimal result=%#v", result)
	}
	if object["projectCode"] != "PRJ-9" || object["departmentCode"] != "DEPT-A" || object["confidentialityLevel"] != "L2" || object["projectId"] != "9" {
		t.Fatalf("object=%#v", object)
	}
	if !notificationAuthorizationSHA256(challenge["factsHash"].(string)) || !notificationAuthorizationSHA256(challenge["objectRevision"].(string)) {
		t.Fatalf("challenge hashes=%#v", challenge)
	}
	for _, forbidden := range []string{"actorUid", "ownerUid", "projectOwnerUid", "projectMemberUids", "matchedRelations", "subjectIsProjectMember", "subjectIsProjectOwner"} {
		if _, exists := object[forbidden]; exists {
			t.Fatalf("challenge leaked %s: %#v", forbidden, object)
		}
	}
}

func TestAimsNotificationDetailAuthorizationNotFoundIsExplicit(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(notificationAuthorizationFactsQuery).
		WithArgs("u-2", int64(42)).
		WillReturnError(sql.ErrNoRows)

	data, _, _, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-2"), notificationAuthorizationBody("prepare"),
	)
	if err != nil {
		t.Fatal(err)
	}
	result := data.(map[string]any)
	if result["authorized"] != false || result["reasonCode"] != "not_found" || len(result) != 4 {
		t.Fatalf("result=%#v", result)
	}
}

func TestAimsNotificationDetailAuthorizationDatabaseFailureRemainsUnavailable(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	dbFailure := errors.New("database unavailable")
	mock.ExpectQuery(notificationAuthorizationFactsQuery).
		WithArgs("u-2", int64(42)).
		WillReturnError(dbFailure)

	data, _, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-2"), notificationAuthorizationBody("prepare"),
	)
	if !handled || !errors.Is(err, dbFailure) || data != nil {
		t.Fatalf("handled=%v data=%#v err=%v", handled, data, err)
	}
}

func TestAimsNotificationDetailAuthorizationRequiresExactDescriptor(t *testing.T) {
	adapter := &Adapter{}
	body := notificationAuthorizationBody("prepare")
	body["descriptor"].(map[string]any)["projectCode"] = "INJECTED"
	_, _, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-1"), body,
	)
	if !handled || err == nil {
		t.Fatal("descriptor with extra fields must fail closed")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_descriptor" {
		t.Fatalf("error=%T %v", err, err)
	}
}

func TestAimsNotificationDetailAuthorizationRequiresExplicitStage(t *testing.T) {
	adapter := &Adapter{}
	body := notificationAuthorizationBody("")
	_, _, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-1"), body,
	)
	if !handled || err == nil {
		t.Fatal("missing stage must fail closed before database access")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_authorization_stage" {
		t.Fatalf("error=%T %v", err, err)
	}
}

func TestAimsNotificationDetailAuthorizationRequiresPurposeBoundActor(t *testing.T) {
	adapter := &Adapter{}
	query := notificationAuthorizationQuery("aims.runtime")
	query.Del("hzy_runtime_actor_purpose")
	_, _, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize", query, notificationAuthorizationBody("prepare"),
	)
	if !handled || err == nil {
		t.Fatal("missing purpose must not fall back to the runtime service subject")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "trusted_notification_actor_required" {
		t.Fatalf("error=%T %v", err, err)
	}
}

func TestAimsNotificationDetailAuthorizationFinalizeAllowsFreshProjectCodeScope(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	prepared := prepareNotificationAuthorization(t, adapter, mock, "u-2", "L3")
	challenge := prepared["authorizationChallenge"].(map[string]any)
	expectNotificationAuthorizationFacts(mock, "u-2", "L3", "owner-1", nil, "2026-07-10 12:00:00")

	data, operation, _, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-2"), finalizeNotificationAuthorizationBody(challenge, "project_code"),
	)
	if err != nil || operation != "aims.notification_details.authorize.finalize" {
		t.Fatalf("operation=%s err=%v", operation, err)
	}
	result := data.(map[string]any)
	if result["authorized"] != true || len(result) != 5 {
		t.Fatalf("result=%#v", result)
	}
	evidence := result["authorizationEvidence"].(map[string]any)
	if evidence["factsHash"] != challenge["factsHash"] || evidence["objectRevision"] != challenge["objectRevision"] || evidence["policyRevision"] != float64(17) || evidence["policyBundleHash"] != "bundle-hash-17" {
		t.Fatalf("evidence=%#v", evidence)
	}
	if !reflectStringSlice(evidence["scopeBasis"], []string{"project_code"}) {
		t.Fatalf("scopeBasis=%#v", evidence["scopeBasis"])
	}
}

func TestAimsNotificationDetailAuthorizationFinalizeRejectsL3DepartmentScope(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	prepared := prepareNotificationAuthorization(t, adapter, mock, "u-2", "L3")
	challenge := prepared["authorizationChallenge"].(map[string]any)
	expectNotificationAuthorizationFacts(mock, "u-2", "L3", "owner-1", nil, "2026-07-10 12:00:00")

	data, _, _, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-2"), finalizeNotificationAuthorizationBody(challenge, "department"),
	)
	if err != nil {
		t.Fatal(err)
	}
	result := data.(map[string]any)
	if result["authorized"] != false || result["reasonCode"] != "confidentiality_scope_restricted" {
		t.Fatalf("result=%#v", result)
	}
}

func TestAimsNotificationDetailAuthorizationFinalizeRejectsStaleFacts(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	prepared := prepareNotificationAuthorization(t, adapter, mock, "u-2", "L2")
	challenge := prepared["authorizationChallenge"].(map[string]any)
	expectNotificationAuthorizationFacts(mock, "u-2", "L2", "owner-1", nil, "2026-07-10 12:01:00")

	data, _, _, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-2"), finalizeNotificationAuthorizationBody(challenge, "tenant_global"),
	)
	if err != nil {
		t.Fatal(err)
	}
	result := data.(map[string]any)
	if result["authorized"] != false || result["reasonCode"] != "authorization_facts_stale" {
		t.Fatalf("result=%#v", result)
	}
}

func TestAimsNotificationDetailAuthorizationFactsHashRejectsCrossBindingReplay(t *testing.T) {
	tests := []struct {
		name        string
		finalUID    string
		mutateBody  func(map[string]any)
		mutateQuery func(url.Values)
	}{
		{
			name:     "notification id",
			finalUID: "u-2",
			mutateBody: func(body map[string]any) {
				body["notificationId"] = "notification-2"
			},
		},
		{
			name:     "subject uid",
			finalUID: "u-3",
			mutateQuery: func(query url.Values) {
				query.Set("current_user", "u-3")
			},
		},
		{
			name:     "tenant",
			finalUID: "u-2",
			mutateQuery: func(query url.Values) {
				query.Set("hzy_runtime_tenant_code", "tenant-b")
			},
		},
		{
			name:     "deployment",
			finalUID: "u-2",
			mutateQuery: func(query url.Values) {
				query.Set("hzy_runtime_deployment_code", "deployment-b")
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			adapter, mock, closeDB := newAimsSQLMockAdapter(t)
			defer closeDB()
			prepared := prepareNotificationAuthorization(t, adapter, mock, "u-2", "L2")
			challenge := prepared["authorizationChallenge"].(map[string]any)
			expectNotificationAuthorizationFacts(mock, test.finalUID, "L2", "owner-1", nil, "2026-07-10 12:00:00")
			body := finalizeNotificationAuthorizationBody(challenge, "tenant_global")
			query := notificationAuthorizationQuery("u-2")
			if test.mutateBody != nil {
				test.mutateBody(body)
			}
			if test.mutateQuery != nil {
				test.mutateQuery(query)
			}

			data, _, _, err := adapter.handleNotificationDetailAuthorizationRuntime(
				context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize", query, body,
			)
			if err != nil {
				t.Fatal(err)
			}
			result := data.(map[string]any)
			if result["authorized"] != false || result["reasonCode"] != "authorization_facts_stale" {
				t.Fatalf("result=%#v", result)
			}
		})
	}
}

func TestAimsNotificationDetailAuthorizationFinalizeRejectsRelationScopeAndUnsortedBasis(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	prepared := prepareNotificationAuthorization(t, adapter, mock, "u-2", "L2")
	challenge := prepared["authorizationChallenge"].(map[string]any)
	expectNotificationAuthorizationFacts(mock, "u-2", "L2", "owner-1", nil, "2026-07-10 12:00:00")
	data, _, _, err := adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-2"), finalizeNotificationAuthorizationBody(challenge, "project_member"),
	)
	if err != nil || data.(map[string]any)["reasonCode"] != "project_relation_scope_restricted" {
		t.Fatalf("data=%#v err=%v", data, err)
	}

	expectNotificationAuthorizationFacts(mock, "u-2", "L2", "owner-1", nil, "2026-07-10 12:00:00")
	_, _, _, err = adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-2"), finalizeNotificationAuthorizationBody(challenge, "tenant_global", "department"),
	)
	if err == nil {
		t.Fatal("unsorted scope basis must fail closed")
	}

	expectNotificationAuthorizationFacts(mock, "u-2", "L2", "owner-1", nil, "2026-07-10 12:00:00")
	missingBundleHash := finalizeNotificationAuthorizationBody(challenge, "tenant_global")
	missingBundleHash["decisionBinding"].(map[string]any)["policyBundleHash"] = ""
	_, _, _, err = adapter.handleNotificationDetailAuthorizationRuntime(
		context.Background(), http.MethodPost, "/v1/aims/notification-details/authorize",
		notificationAuthorizationQuery("u-2"), missingBundleHash,
	)
	if err == nil {
		t.Fatal("empty policy bundle hash must fail closed")
	}
}

func reflectStringSlice(value any, expected []string) bool {
	actual, ok := value.([]string)
	if !ok || len(actual) != len(expected) {
		return false
	}
	for index := range expected {
		if actual[index] != expected[index] {
			return false
		}
	}
	return true
}
