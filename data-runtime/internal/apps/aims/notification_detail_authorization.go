package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const notificationDetailActorPurpose = "notification-detail-authorization"

type notificationAuthorizationFacts struct {
	workItemID          int64
	projectID           int64
	projectCode         string
	departmentCode      string
	confidentiality     string
	projectOwnerUID     string
	projectCreatedByUID string
	workItemUpdatedAt   string
	projectUpdatedAt    string
	subjectIsMember     bool
	subjectIsOwner      bool
}

func (a *Adapter) handleNotificationDetailAuthorizationRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	if method != http.MethodPost || path != "/v1/aims/notification-details/authorize" {
		return nil, "", false, nil
	}
	if strings.TrimSpace(query.Get("hzy_runtime_actor_purpose")) != notificationDetailActorPurpose {
		return nil, "", true, httperror.New(http.StatusForbidden, "trusted_notification_actor_required", "trusted notification detail actor delegation is required")
	}

	resource, normalizedID, workItemID, err := exactNotificationAuthorizationDescriptor(body["descriptor"])
	if err != nil {
		return nil, "", true, err
	}
	notificationID, err := requiredNotificationAuthorizationText(body["notificationId"], "notification_id", 191)
	if err != nil {
		return nil, "", true, err
	}
	subjectUID := strings.TrimSpace(query.Get("current_user"))
	if subjectUID == "" {
		return nil, "", true, httperror.New(http.StatusUnauthorized, "missing_current_user", "trusted notification subject is required")
	}
	if resource == "integration_operation" {
		trusted, trustedErr := integrationoperation.TrustedContextFromMap(aimsIntegrationOperationTrustedQuery(query), "aims")
		if trustedErr != nil {
			return nil, "", true, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted integration operation context is missing or invalid")
		}
		repository, repositoryErr := integrationoperation.NewRepository(a.DB())
		if repositoryErr != nil {
			return nil, "", true, repositoryErr
		}
		authorized, reason, authorizeErr := repository.AuthorizeDeadLetterNotification(ctx, integrationoperation.AuthorizeDeadLetterNotificationInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "aims", OperationID: normalizedID, NotificationID: notificationID, SubjectUID: subjectUID})
		if authorizeErr != nil {
			return nil, "", true, authorizeErr
		}
		return map[string]any{"authorized": authorized, "reasonCode": reason, "resource": resource, "id": normalizedID}, "aims.notification_details.authorize", true, nil
	}
	stage := strings.TrimSpace(notificationAuthorizationText(body["stage"]))
	if stage != "prepare" && stage != "finalize" {
		return nil, "", true, httperror.New(http.StatusBadRequest, "invalid_authorization_stage", "notification authorization stage is invalid")
	}

	facts, err := a.loadNotificationAuthorizationFacts(ctx, workItemID, subjectUID)
	if err == sql.ErrNoRows {
		return map[string]any{
			"authorized": false,
			"reasonCode": "not_found",
			"resource":   resource,
			"id":         normalizedID,
		}, "aims.notification_details.authorize", true, nil
	}
	if err != nil {
		return nil, "", true, err
	}

	if stage == "prepare" {
		if facts.subjectIsMember || facts.subjectIsOwner {
			return map[string]any{
				"authorized": true,
				"reasonCode": "allowed",
				"resource":   resource,
				"id":         normalizedID,
			}, "aims.notification_details.authorize", true, nil
		}
		challenge := notificationAuthorizationChallenge(query, notificationID, subjectUID, resource, normalizedID, facts)
		return map[string]any{
			"authorized":             false,
			"reasonCode":             "scoped_authorization_required",
			"resource":               resource,
			"id":                     normalizedID,
			"authorizationChallenge": challenge,
		}, "aims.notification_details.authorize", true, nil
	}
	return finalizeNotificationDetailAuthorization(
		query,
		body,
		notificationID,
		subjectUID,
		resource,
		normalizedID,
		facts,
	)
}

func (a *Adapter) loadNotificationAuthorizationFacts(ctx context.Context, workItemID int64, subjectUID string) (notificationAuthorizationFacts, error) {
	var facts notificationAuthorizationFacts
	var departmentCode, projectOwnerUID sql.NullString
	var memberID sql.NullInt64
	err := a.DB().QueryRowContext(ctx, `
		SELECT wi.id,
		       p.id,
		       p.project_code,
		       p.dept_code,
		       COALESCE(p.confidentiality_level, 'L1'),
		       p.leader_uid,
		       p.created_by,
		       CAST(wi.updated_at AS CHAR),
		       CAST(p.updated_at AS CHAR),
		       pm.id
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		LEFT JOIN aims_project_members pm
		  ON pm.project_id = p.id
		 AND pm.uid = ?
		 AND COALESCE(pm.status, 'active') = 'active'
		WHERE wi.id = ?
		LIMIT 1
	`, subjectUID, workItemID).Scan(
		&facts.workItemID,
		&facts.projectID,
		&facts.projectCode,
		&departmentCode,
		&facts.confidentiality,
		&projectOwnerUID,
		&facts.projectCreatedByUID,
		&facts.workItemUpdatedAt,
		&facts.projectUpdatedAt,
		&memberID,
	)
	if err != nil {
		return notificationAuthorizationFacts{}, err
	}
	facts.projectCode = notificationAuthorizationFactText(facts.projectCode, 64)
	facts.departmentCode = notificationAuthorizationNullText(departmentCode, 64)
	facts.confidentiality = strings.ToUpper(notificationAuthorizationFactText(facts.confidentiality, 2))
	facts.projectOwnerUID = notificationAuthorizationNullText(projectOwnerUID, 191)
	facts.projectCreatedByUID = notificationAuthorizationFactText(facts.projectCreatedByUID, 191)
	facts.subjectIsMember = memberID.Valid && memberID.Int64 > 0
	facts.subjectIsOwner = facts.projectOwnerUID != "" && facts.projectOwnerUID == subjectUID
	if facts.projectCode == "" || !notificationAuthorizationConfidentialityAllowed(facts.confidentiality) {
		return notificationAuthorizationFacts{}, httperror.New(http.StatusServiceUnavailable, "authorization_facts_invalid", "Aims notification authorization facts are invalid")
	}
	return facts, nil
}

func exactNotificationAuthorizationDescriptor(value any) (string, string, int64, error) {
	descriptor, ok := value.(map[string]any)
	if !ok || len(descriptor) != 2 {
		return "", "", 0, httperror.New(http.StatusBadRequest, "invalid_descriptor", "Aims work item descriptor is invalid")
	}
	for key := range descriptor {
		if key != "resource" && key != "id" {
			return "", "", 0, httperror.New(http.StatusBadRequest, "invalid_descriptor", "Aims work item descriptor is invalid")
		}
	}
	resource := strings.TrimSpace(notificationAuthorizationText(descriptor["resource"]))
	rawID := strings.TrimSpace(notificationAuthorizationText(descriptor["id"]))
	if resource == "integration_operation" {
		if rawID != strings.ToLower(rawID) || integrationoperation.ValidateOperationID(rawID) != nil {
			return "", "", 0, httperror.New(http.StatusBadRequest, "invalid_descriptor", "Aims integration operation descriptor is invalid")
		}
		return resource, rawID, 0, nil
	}
	workItemID, err := strconv.ParseInt(rawID, 10, 64)
	if resource != "work_item" || err != nil || workItemID <= 0 {
		return "", "", 0, httperror.New(http.StatusBadRequest, "invalid_descriptor", "Aims work item descriptor is invalid")
	}
	return resource, strconv.FormatInt(workItemID, 10), workItemID, nil
}

func notificationAuthorizationChallenge(
	query url.Values,
	notificationID string,
	subjectUID string,
	resource string,
	id string,
	facts notificationAuthorizationFacts,
) map[string]any {
	objectRevision := notificationAuthorizationObjectRevision(facts)
	object := notificationAuthorizationObject(facts)
	factsHash := notificationAuthorizationFactsHash(query, notificationID, subjectUID, resource, id, objectRevision, object)
	return map[string]any{
		"appCode":        "aims",
		"resourceCode":   "projects",
		"action":         "admin",
		"objectRevision": objectRevision,
		"factsHash":      factsHash,
		"object":         object,
	}
}

func notificationAuthorizationObject(facts notificationAuthorizationFacts) map[string]any {
	object := map[string]any{
		"projectCode":          facts.projectCode,
		"projectId":            strconv.FormatInt(facts.projectID, 10),
		"confidentialityLevel": facts.confidentiality,
	}
	if facts.departmentCode != "" {
		object["departmentCode"] = facts.departmentCode
	}
	return object
}

func notificationAuthorizationObjectRevision(facts notificationAuthorizationFacts) string {
	return notificationAuthorizationHash(
		"aims-notification-object-revision-v1",
		strconv.FormatInt(facts.workItemID, 10),
		strconv.FormatInt(facts.projectID, 10),
		facts.projectCode,
		facts.departmentCode,
		facts.confidentiality,
		facts.projectOwnerUID,
		facts.projectCreatedByUID,
		facts.workItemUpdatedAt,
		facts.projectUpdatedAt,
		strconv.FormatBool(facts.subjectIsMember),
		strconv.FormatBool(facts.subjectIsOwner),
	)
}

func notificationAuthorizationFactsHash(
	query url.Values,
	notificationID string,
	subjectUID string,
	resource string,
	id string,
	objectRevision string,
	object map[string]any,
) string {
	return notificationAuthorizationHash(
		"aims-notification-authorization-facts-v1",
		strings.TrimSpace(query.Get("hzy_runtime_tenant_code")),
		strings.TrimSpace(query.Get("hzy_runtime_deployment_code")),
		"console",
		"aims",
		notificationID,
		subjectUID,
		resource,
		id,
		objectRevision,
		notificationAuthorizationText(object["projectCode"]),
		notificationAuthorizationText(object["projectId"]),
		notificationAuthorizationText(object["departmentCode"]),
		notificationAuthorizationText(object["confidentialityLevel"]),
	)
}

func finalizeNotificationDetailAuthorization(
	query url.Values,
	body map[string]any,
	notificationID string,
	subjectUID string,
	resource string,
	id string,
	facts notificationAuthorizationFacts,
) (any, string, bool, error) {
	expectedChallenge := notificationAuthorizationChallenge(query, notificationID, subjectUID, resource, id, facts)
	challenge, err := exactNotificationAuthorizationChallenge(body["authorizationChallenge"])
	if err != nil {
		return nil, "", true, err
	}
	if !reflect.DeepEqual(challenge, expectedChallenge) {
		return notificationAuthorizationDenied(resource, id, "authorization_facts_stale"), "aims.notification_details.authorize.finalize", true, nil
	}

	decision, policyRevision, scopeBasis, err := exactNotificationAuthorizationDecision(body["decisionBinding"])
	if err != nil {
		return nil, "", true, err
	}
	if decision["factsHash"] != challenge["factsHash"] {
		return notificationAuthorizationDenied(resource, id, "authorization_facts_stale"), "aims.notification_details.authorize.finalize", true, nil
	}
	if facts.subjectIsMember || facts.subjectIsOwner {
		return notificationAuthorizationDenied(resource, id, "authorization_relation_changed"), "aims.notification_details.authorize.finalize", true, nil
	}
	if facts.confidentiality == "L3" && containsNotificationAuthorizationBasis(scopeBasis, "department") {
		return notificationAuthorizationDenied(resource, id, "confidentiality_scope_restricted"), "aims.notification_details.authorize.finalize", true, nil
	}
	if containsNotificationAuthorizationBasis(scopeBasis, "project_member") || containsNotificationAuthorizationBasis(scopeBasis, "project_owner") {
		return notificationAuthorizationDenied(resource, id, "project_relation_scope_restricted"), "aims.notification_details.authorize.finalize", true, nil
	}

	evidence := map[string]any{
		"factsHash":        challenge["factsHash"],
		"objectRevision":   challenge["objectRevision"],
		"policyRevision":   policyRevision,
		"policyBundleHash": decision["policyBundleHash"],
		"scopeBasis":       scopeBasis,
	}
	return map[string]any{
		"authorized":            true,
		"reasonCode":            "allowed",
		"resource":              resource,
		"id":                    id,
		"authorizationEvidence": evidence,
	}, "aims.notification_details.authorize.finalize", true, nil
}

func exactNotificationAuthorizationChallenge(value any) (map[string]any, error) {
	challenge, ok := value.(map[string]any)
	if !ok || !exactNotificationAuthorizationKeys(challenge, "appCode", "resourceCode", "action", "objectRevision", "factsHash", "object") {
		return nil, httperror.New(http.StatusBadRequest, "invalid_authorization_challenge", "notification authorization challenge is invalid")
	}
	object, ok := challenge["object"].(map[string]any)
	if !ok || !exactNotificationAuthorizationObject(object) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_authorization_challenge", "notification authorization challenge object is invalid")
	}
	objectRevision := strings.TrimSpace(notificationAuthorizationText(challenge["objectRevision"]))
	factsHash := strings.ToLower(strings.TrimSpace(notificationAuthorizationText(challenge["factsHash"])))
	if challenge["appCode"] != "aims" || challenge["resourceCode"] != "projects" || challenge["action"] != "admin" || len(objectRevision) > 128 || !notificationAuthorizationSHA256(factsHash) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_authorization_challenge", "notification authorization challenge is invalid")
	}
	normalizedObject := map[string]any{
		"projectCode":          strings.TrimSpace(notificationAuthorizationText(object["projectCode"])),
		"projectId":            strings.TrimSpace(notificationAuthorizationText(object["projectId"])),
		"confidentialityLevel": strings.ToUpper(strings.TrimSpace(notificationAuthorizationText(object["confidentialityLevel"]))),
	}
	if department := strings.TrimSpace(notificationAuthorizationText(object["departmentCode"])); department != "" {
		normalizedObject["departmentCode"] = department
	}
	return map[string]any{
		"appCode":        "aims",
		"resourceCode":   "projects",
		"action":         "admin",
		"objectRevision": objectRevision,
		"factsHash":      factsHash,
		"object":         normalizedObject,
	}, nil
}

func exactNotificationAuthorizationObject(object map[string]any) bool {
	if len(object) < 3 || len(object) > 4 {
		return false
	}
	for key := range object {
		if key != "projectCode" && key != "projectId" && key != "departmentCode" && key != "confidentialityLevel" {
			return false
		}
	}
	projectCode := strings.TrimSpace(notificationAuthorizationText(object["projectCode"]))
	projectID, err := strconv.ParseInt(strings.TrimSpace(notificationAuthorizationText(object["projectId"])), 10, 64)
	confidentiality := strings.ToUpper(strings.TrimSpace(notificationAuthorizationText(object["confidentialityLevel"])))
	return projectCode != "" && len(projectCode) <= 64 && err == nil && projectID > 0 && notificationAuthorizationConfidentialityAllowed(confidentiality)
}

func exactNotificationAuthorizationDecision(value any) (map[string]any, any, []string, error) {
	decision, ok := value.(map[string]any)
	if !ok || !exactNotificationAuthorizationKeys(decision, "allowed", "appCode", "resourceCode", "action", "factsHash", "policyRevision", "policyBundleHash", "scopeBasis") {
		return nil, nil, nil, httperror.New(http.StatusBadRequest, "invalid_authorization_decision", "notification authorization decision is invalid")
	}
	if decision["allowed"] != true || decision["appCode"] != "aims" || decision["resourceCode"] != "projects" || decision["action"] != "admin" {
		return nil, nil, nil, httperror.New(http.StatusBadRequest, "invalid_authorization_decision", "notification authorization decision tuple is invalid")
	}
	factsHash := strings.ToLower(strings.TrimSpace(notificationAuthorizationText(decision["factsHash"])))
	if !notificationAuthorizationSHA256(factsHash) {
		return nil, nil, nil, httperror.New(http.StatusBadRequest, "invalid_authorization_decision", "notification authorization facts hash is invalid")
	}
	policyRevision := decision["policyRevision"]
	if !notificationAuthorizationPolicyRevision(policyRevision) {
		return nil, nil, nil, httperror.New(http.StatusBadRequest, "invalid_authorization_decision", "notification authorization policy revision is invalid")
	}
	policyBundleHash := strings.TrimSpace(notificationAuthorizationText(decision["policyBundleHash"]))
	if !notificationAuthorizationPolicyBundleHash(policyBundleHash) {
		return nil, nil, nil, httperror.New(http.StatusBadRequest, "invalid_authorization_decision", "notification authorization policy bundle hash is invalid")
	}
	rawBasis, ok := decision["scopeBasis"].([]any)
	if !ok || len(rawBasis) == 0 || len(rawBasis) > 6 {
		return nil, nil, nil, httperror.New(http.StatusBadRequest, "invalid_authorization_decision", "notification authorization scope basis is invalid")
	}
	allowedBasis := map[string]bool{
		"unscoped":       true,
		"tenant_global":  true,
		"department":     true,
		"project_code":   true,
		"project_member": true,
		"project_owner":  true,
	}
	scopeBasis := make([]string, 0, len(rawBasis))
	for _, raw := range rawBasis {
		basis := strings.TrimSpace(notificationAuthorizationText(raw))
		if !allowedBasis[basis] {
			return nil, nil, nil, httperror.New(http.StatusBadRequest, "invalid_authorization_decision", "notification authorization scope basis is invalid")
		}
		scopeBasis = append(scopeBasis, basis)
	}
	canonicalBasis := append([]string(nil), scopeBasis...)
	sort.Strings(canonicalBasis)
	for index := range canonicalBasis {
		if canonicalBasis[index] != scopeBasis[index] || (index > 0 && canonicalBasis[index] == canonicalBasis[index-1]) {
			return nil, nil, nil, httperror.New(http.StatusBadRequest, "invalid_authorization_decision", "notification authorization scope basis must be sorted and unique")
		}
	}
	return map[string]any{"factsHash": factsHash, "policyBundleHash": policyBundleHash}, policyRevision, scopeBasis, nil
}

func notificationAuthorizationDenied(resource string, id string, reason string) map[string]any {
	return map[string]any{
		"authorized": false,
		"reasonCode": reason,
		"resource":   resource,
		"id":         id,
	}
}

func containsNotificationAuthorizationBasis(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func exactNotificationAuthorizationKeys(value map[string]any, keys ...string) bool {
	if len(value) != len(keys) {
		return false
	}
	for _, key := range keys {
		if _, ok := value[key]; !ok {
			return false
		}
	}
	return true
}

func notificationAuthorizationPolicyRevision(value any) bool {
	if value == nil {
		return true
	}
	switch revision := value.(type) {
	case float64:
		return revision >= 0 && revision == float64(int64(revision))
	case int:
		return revision >= 0
	case int64:
		return revision >= 0
	default:
		return false
	}
}

func notificationAuthorizationPolicyBundleHash(value string) bool {
	if value == "" || len(value) > 191 {
		return false
	}
	for _, character := range value {
		if !((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || strings.ContainsRune("._:-", character)) {
			return false
		}
	}
	return true
}

func notificationAuthorizationConfidentialityAllowed(value string) bool {
	return value == "L0" || value == "L1" || value == "L2" || value == "L3"
}

func notificationAuthorizationSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func notificationAuthorizationHash(values ...string) string {
	hash := sha256.New()
	for _, value := range values {
		_, _ = fmt.Fprintf(hash, "%d:%s\n", len(value), value)
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func requiredNotificationAuthorizationText(value any, code string, max int) (string, error) {
	text := notificationAuthorizationFactText(notificationAuthorizationText(value), max)
	if text == "" {
		return "", httperror.New(http.StatusBadRequest, code, "notification authorization binding is invalid")
	}
	return text, nil
}

func notificationAuthorizationFactText(value string, max int) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > max {
		return ""
	}
	for _, character := range value {
		if character < 32 || character == 127 {
			return ""
		}
	}
	return value
}

func notificationAuthorizationNullText(value sql.NullString, max int) string {
	if !value.Valid {
		return ""
	}
	return notificationAuthorizationFactText(value.String, max)
}

func notificationAuthorizationText(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}
