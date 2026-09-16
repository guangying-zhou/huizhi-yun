package finance

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const financeNotificationDetailActorPurpose = "notification-detail-authorization"

func (a *Adapter) AuthorizeNotificationDetail(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	if strings.TrimSpace(query.Get("hzy_runtime_actor_purpose")) != financeNotificationDetailActorPurpose {
		return nil, httperror.New(http.StatusForbidden, "trusted_notification_actor_required", "trusted notification detail actor delegation is required")
	}
	resource, code, err := exactFinanceNotificationDescriptor(body["descriptor"])
	if err != nil {
		return nil, err
	}
	subjectUID := query.Get("current_user")
	if !validFinanceResponsibleUID(subjectUID) {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "trusted notification subject is required")
	}
	if resource == "integration_operation" {
		trusted, trustedErr := integrationoperation.TrustedContextFromMap(financeNotificationTrustedQuery(query), "finance")
		if trustedErr != nil {
			return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Finance integration operation context is required")
		}
		notificationID := strings.TrimSpace(cleanStringValue(body["notificationId"]))
		if notificationID == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_notification_id", "notification id is required")
		}
		repository, repositoryErr := integrationoperation.NewRepository(a.db)
		if repositoryErr != nil {
			return nil, repositoryErr
		}
		authorized, reason, authorizeErr := repository.AuthorizeDeadLetterNotification(ctx, integrationoperation.AuthorizeDeadLetterNotificationInput{
			TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "finance", OperationID: code,
			NotificationID: notificationID, SubjectUID: subjectUID,
		})
		if authorizeErr != nil {
			return nil, authorizeErr
		}
		return map[string]any{"authorized": authorized, "reasonCode": reason, "resource": resource, "id": code}, nil
	}

	var id int64
	var related int
	if resource == "invoice_request" {
		err = a.db.QueryRowContext(ctx, `SELECT id,CASE WHEN status='approved' AND issued_invoice_id IS NULL
			AND issuance_responsible_uid=? AND issuance_due_at IS NOT NULL THEN 1 ELSE 0 END
			FROM invoice_request WHERE code=? AND deleted_at IS NULL LIMIT 1`, subjectUID, code).Scan(&id, &related)
	} else {
		err = a.db.QueryRowContext(ctx, `SELECT r.id,CASE WHEN r.status IN ('confirmed','partially_reconciled')
			AND r.received_amount>COALESCE((SELECT SUM(rec.reconciled_amount) FROM finance_reconciliation rec WHERE rec.receipt_id=r.id AND rec.status='active'),0)
			AND r.reconciliation_responsible_uid=? AND r.reconciliation_due_at IS NOT NULL THEN 1 ELSE 0 END
			FROM finance_receipt r WHERE r.code=? AND r.deleted_at IS NULL LIMIT 1`, subjectUID, code).Scan(&id, &related)
	}
	authorized, reason := false, "not_authorized"
	if err == sql.ErrNoRows {
		reason = "not_found"
	} else if err != nil {
		return nil, err
	} else if related == 1 {
		authorized, reason = true, "allowed"
	}
	return map[string]any{"authorized": authorized, "reasonCode": reason, "resource": resource, "id": code}, nil
}

func exactFinanceNotificationDescriptor(value any) (string, string, error) {
	descriptor, ok := value.(map[string]any)
	if !ok || len(descriptor) != 2 {
		return "", "", invalidFinanceNotificationDescriptor()
	}
	for key := range descriptor {
		if key != "resource" && key != "id" {
			return "", "", invalidFinanceNotificationDescriptor()
		}
	}
	resource, resourceOK := descriptor["resource"].(string)
	code, codeOK := descriptor["id"].(string)
	if !resourceOK || !codeOK || resource != strings.TrimSpace(resource) || code != strings.TrimSpace(code) || code == "" || len(code) > 50 || hasFinanceControlCharacter(code) {
		return "", "", invalidFinanceNotificationDescriptor()
	}
	if resource == "integration_operation" {
		if code != strings.ToLower(code) || integrationoperation.ValidateOperationID(code) != nil {
			return "", "", invalidFinanceNotificationDescriptor()
		}
		return resource, code, nil
	}
	if resource != "invoice_request" && resource != "finance_receipt" {
		return "", "", invalidFinanceNotificationDescriptor()
	}
	return resource, code, nil
}

func financeNotificationTrustedQuery(query url.Values) map[string]any {
	result := map[string]any{}
	for _, key := range []string{
		integrationoperation.TrustedTenantCodeKey, integrationoperation.TrustedDeploymentCodeKey,
		integrationoperation.TrustedSourceAppKey, integrationoperation.TrustedServiceClientIDKey,
		integrationoperation.TrustedRequestIDKey,
	} {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			result[key] = value
		}
	}
	return result
}

func invalidFinanceNotificationDescriptor() error {
	return httperror.New(http.StatusBadRequest, "invalid_descriptor", "Finance notification descriptor is invalid")
}
