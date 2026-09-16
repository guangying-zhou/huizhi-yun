package assets

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const assetsNotificationDetailActorPurpose = "notification-detail-authorization"

func (a *Adapter) handleNotificationDetailAuthorizationRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	if method != http.MethodPost || path != "/v1/assets/notification-details/authorize" {
		return nil, "", false, nil
	}
	if strings.TrimSpace(query.Get("hzy_runtime_actor_purpose")) != assetsNotificationDetailActorPurpose {
		return nil, "", true, httperror.New(http.StatusForbidden, "trusted_notification_actor_required", "trusted notification detail actor delegation is required")
	}
	resource, objectCode, err := exactAssetsNotificationDescriptor(body["descriptor"])
	if err != nil {
		return nil, "", true, err
	}
	subjectUID := strings.TrimSpace(query.Get("current_user"))
	if subjectUID == "" {
		return nil, "", true, httperror.New(http.StatusUnauthorized, "missing_current_user", "trusted notification subject is required")
	}
	if resource == "integration_operation" {
		notificationID := strings.TrimSpace(assetText(map[string]any{"notificationId": body["notificationId"]}, "notificationId"))
		if notificationID == "" || len(notificationID) > 191 {
			return nil, "", true, httperror.New(http.StatusBadRequest, "invalid_notification_id", "Assets notification id is invalid")
		}
		trusted, trustedErr := integrationoperation.TrustedContextFromMap(assetsIntegrationOperationQueryBody(query), "assets")
		if trustedErr != nil {
			return nil, "", true, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted Assets integration operation context is missing or invalid")
		}
		repository, repositoryErr := integrationoperation.NewRepository(a.DB())
		if repositoryErr != nil {
			return nil, "", true, repositoryErr
		}
		authorized, reason, authorizeErr := repository.AuthorizeDeadLetterNotification(ctx, integrationoperation.AuthorizeDeadLetterNotificationInput{
			TenantCode: trusted.TenantCode, DeploymentCode: trusted.DeploymentCode, SourceApp: "assets",
			OperationID: objectCode, NotificationID: notificationID, SubjectUID: subjectUID,
		})
		if authorizeErr != nil {
			return nil, "", true, authorizeErr
		}
		return map[string]any{"authorized": authorized, "reasonCode": reason, "resource": resource, "id": objectCode}, "assets.notification_details.authorize", true, nil
	}

	authorized, found, err := a.authorizeAssetsNotificationObject(ctx, resource, objectCode, subjectUID)
	if err != nil {
		return nil, "", true, err
	}
	reason := "not_authorized"
	if !found {
		reason = "not_found"
	} else if authorized {
		reason = "allowed"
	}
	return map[string]any{
		"authorized": authorized,
		"reasonCode": reason,
		"resource":   resource,
		"id":         objectCode,
	}, "assets.notification_details.authorize", true, nil
}

func exactAssetsNotificationDescriptor(value any) (string, string, error) {
	descriptor, ok := value.(map[string]any)
	if !ok || len(descriptor) != 2 {
		return "", "", httperror.New(http.StatusBadRequest, "invalid_descriptor", "Assets notification descriptor is invalid")
	}
	for key := range descriptor {
		if key != "resource" && key != "id" {
			return "", "", httperror.New(http.StatusBadRequest, "invalid_descriptor", "Assets notification descriptor is invalid")
		}
	}
	resourceValue, resourceOK := descriptor["resource"].(string)
	idValue, idOK := descriptor["id"].(string)
	resource := strings.TrimSpace(resourceValue)
	objectCode := strings.TrimSpace(idValue)
	if !resourceOK || !idOK || (resource != "asset_item" && resource != "ip_asset" && resource != "customer_delivery_asset" && resource != "offboarding_recovery_case" && resource != "integration_operation") || objectCode == "" || len(objectCode) > 64 {
		return "", "", httperror.New(http.StatusBadRequest, "invalid_descriptor", "Assets notification descriptor is invalid")
	}
	if resource == "integration_operation" && !integrationoperation.IsValidOperationID(objectCode) {
		return "", "", httperror.New(http.StatusBadRequest, "invalid_descriptor", "Assets notification descriptor is invalid")
	}
	return resource, objectCode, nil
}

func (a *Adapter) authorizeAssetsNotificationObject(ctx context.Context, resource, objectCode, subjectUID string) (bool, bool, error) {
	var id int64
	var related int
	var err error
	if resource == "asset_item" {
		err = a.DB().QueryRowContext(ctx, `
			SELECT ai.id,
			       CASE WHEN ai.status='active' AND ai.archived_at IS NULL
			                  AND ? IN (COALESCE(ai.owner_uid,''), COALESCE(ai.custodian_uid,''), COALESCE(ai.user_uid,''))
			            THEN 1 ELSE 0 END AS related
			FROM asset_items ai
			WHERE ai.asset_code=? AND ai.asset_category='resource'
			LIMIT 1`, subjectUID, objectCode).Scan(&id, &related)
	} else if resource == "ip_asset" {
		err = a.DB().QueryRowContext(ctx, `
			SELECT ip.id,
			       CASE WHEN ip.status='active' AND (
			              ip.owner_uid=? OR EXISTS (
			                SELECT 1 FROM ip_asset_products iap
			                JOIN product_assets p ON p.id=iap.product_asset_id
			                WHERE iap.ip_asset_id=ip.id AND (? IN (COALESCE(p.business_owner_uid,''), COALESCE(p.technical_owner_uid,'')))
			              )) THEN 1 ELSE 0 END AS related
			FROM ip_assets ip
			WHERE ip.ip_code=?
			LIMIT 1`, subjectUID, subjectUID, objectCode).Scan(&id, &related)
	} else if resource == "customer_delivery_asset" {
		err = a.DB().QueryRowContext(ctx, `
			SELECT cda.id,
			       CASE WHEN cda.deleted_at IS NULL
			                  AND cda.status IN ('delivered','online','accepted','suspended')
			                  AND cda.responsible_uid=?
			            THEN 1 ELSE 0 END AS related
			FROM customer_delivery_assets cda
			WHERE cda.delivery_asset_code=?
			LIMIT 1`, subjectUID, objectCode).Scan(&id, &related)
	} else {
		err = a.DB().QueryRowContext(ctx, `
			SELECT c.id, CASE WHEN c.status='active' AND c.recovery_responsible_uid=?
			  AND c.recovery_responsible_uid=TRIM(c.recovery_responsible_uid)
			  AND c.recovery_responsible_uid<>'' AND LOWER(c.recovery_responsible_uid)<>'@all'
			  AND c.recovery_responsible_uid NOT REGEXP '[[:cntrl:]]' AND c.recovery_responsible_uid<>c.departed_employee_uid
			  AND EXISTS (SELECT 1 FROM asset_items ai WHERE ai.archived_at IS NULL
			    AND ai.status NOT IN ('in_stock','scrapped','inactive','disposed','retired')
			    AND `+offboardingOutstandingPredicate("c", "ai")+`) THEN 1 ELSE 0 END AS related
			FROM asset_offboarding_recovery_cases c WHERE c.case_code=? LIMIT 1`, subjectUID, objectCode).Scan(&id, &related)
	}
	if err == sql.ErrNoRows {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	return related == 1, true, nil
}
