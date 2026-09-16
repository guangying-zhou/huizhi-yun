package people

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const offboardingNotificationDetailActorPurpose = "notification-detail-authorization"

func (a *Adapter) handleOffboardingNotificationDetailAuthorizationRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if method != http.MethodPost || path != "/v1/people/notification-details/authorize" {
		return nil, "", false, nil
	}
	if strings.TrimSpace(query.Get("hzy_runtime_actor_purpose")) != offboardingNotificationDetailActorPurpose {
		return nil, "", true, httperror.New(http.StatusForbidden, "trusted_notification_actor_required", "trusted notification detail actor delegation is required")
	}
	resource, objectID, err := exactPeopleNotificationDescriptor(body["descriptor"])
	if err != nil {
		return nil, "", true, err
	}
	subjectUID := strings.TrimSpace(query.Get("current_user"))
	if validateOffboardingIdentity(subjectUID, "current_user") != nil {
		return nil, "", true, httperror.New(http.StatusUnauthorized, "missing_current_user", "trusted notification subject is required")
	}
	if resource == "integration_operation" {
		notificationID, notificationErr := requiredPeopleNotificationID(body["notificationId"])
		if notificationErr != nil {
			return nil, "", true, notificationErr
		}
		trusted, trustedErr := integrationoperation.TrustedContextFromMap(peopleIntegrationOperationQueryBody(query), "people")
		if trustedErr != nil {
			return nil, "", true, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted People integration operation context is missing or invalid")
		}
		if err := a.requireAllowedPeopleIntegrationOperation(ctx, trusted, objectID); err != nil {
			if peopleUnsupportedOperation(err) {
				return map[string]any{"authorized": false, "reasonCode": "not_found", "resource": resource, "id": objectID}, "people.notification_details.authorize", true, nil
			}
			return nil, "", true, err
		}
		repository, repositoryErr := integrationoperation.NewRepository(a.DB())
		if repositoryErr != nil {
			return nil, "", true, repositoryErr
		}
		authorized, reason, authorizeErr := repository.AuthorizeDeadLetterNotification(ctx, integrationoperation.AuthorizeDeadLetterNotificationInput{TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "people", OperationID: objectID, NotificationID: notificationID, SubjectUID: subjectUID})
		if authorizeErr != nil {
			return nil, "", true, authorizeErr
		}
		return map[string]any{"authorized": authorized, "reasonCode": reason, "resource": resource, "id": objectID}, "people.notification_details.authorize", true, nil
	}
	var id int64
	var related int
	err = a.DB().QueryRowContext(ctx, `
		SELECT t.id,CASE WHEN t.status='pending' AND c.status='active' AND t.responsible_uid=? THEN 1 ELSE 0 END
		FROM people_offboarding_tasks t
		JOIN people_offboarding_cases c ON c.case_code=t.case_code
		WHERE t.task_code=? LIMIT 1`, subjectUID, objectID).Scan(&id, &related)
	authorized, reason := false, "not_authorized"
	if err == sql.ErrNoRows {
		reason = "not_found"
	} else if err != nil {
		return nil, "", true, err
	} else if related == 1 {
		authorized, reason = true, "allowed"
	}
	return map[string]any{"authorized": authorized, "reasonCode": reason, "resource": resource, "id": objectID}, "people.notification_details.authorize", true, nil
}

func exactPeopleNotificationDescriptor(value any) (string, string, error) {
	descriptor, ok := value.(map[string]any)
	if !ok || len(descriptor) != 2 {
		return "", "", httperror.New(http.StatusBadRequest, "invalid_descriptor", "People notification descriptor is invalid")
	}
	for key := range descriptor {
		if key != "resource" && key != "id" {
			return "", "", httperror.New(http.StatusBadRequest, "invalid_descriptor", "People notification descriptor is invalid")
		}
	}
	resource, resourceOK := descriptor["resource"].(string)
	id, idOK := descriptor["id"].(string)
	if !resourceOK || !idOK || resource != strings.TrimSpace(resource) || id != strings.TrimSpace(id) {
		return "", "", httperror.New(http.StatusBadRequest, "invalid_descriptor", "People notification descriptor is invalid")
	}
	if resource == "integration_operation" && integrationoperation.IsValidOperationID(id) {
		return resource, id, nil
	}
	if resource != "offboarding_task" || validateOffboardingCode(id, "descriptor.id") != nil {
		return "", "", httperror.New(http.StatusBadRequest, "invalid_descriptor", "People notification descriptor is invalid")
	}
	return resource, id, nil
}

func requiredPeopleNotificationID(value any) (string, error) {
	text, ok := value.(string)
	text = strings.TrimSpace(text)
	if !ok || text == "" || len(text) > 191 {
		return "", httperror.New(http.StatusBadRequest, "invalid_notification_id", "People notification id is invalid")
	}
	return text, nil
}
