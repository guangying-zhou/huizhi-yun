package assets

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleCustomerDeliveryAssetEnvironmentRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodPost && path == "/v1/assets/service/environments/upsert" {
		data, err := a.upsertServiceEnvironment(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(data, "环境已同步"), "assets.service.environments.upsert", err
	}
	if method == http.MethodPost && path == "/v1/assets/service/references:resolve" {
		data, err := a.resolveServiceReferences(ctx, body)
		return true, okWithMessage(data, "ok"), "assets.service.references.resolve", err
	}
	if method == http.MethodPost {
		if environmentCode, ok := pathParamWithSuffix(path, "/v1/assets/service/environments/", "/lifecycle:sync"); ok {
			environmentCode, _ = url.PathUnescape(environmentCode)
			data, err := a.syncServiceEnvironmentLifecycle(ctx, environmentCode, body, actorFromRequest(query, body))
			return true, okWithMessage(data, "环境状态已同步"), "assets.service.environments.lifecycle.sync", err
		}
		if deliveryAssetCode, ok := pathParamWithSuffix(path, "/v1/assets/service/customer-delivery-assets/", "/environments:bind"); ok {
			deliveryAssetCode, _ = url.PathUnescape(deliveryAssetCode)
			data, err := a.bindCustomerDeliveryAssetEnvironment(ctx, deliveryAssetCode, body, actorFromRequest(query, body))
			return true, okWithMessage(data, "交付资产环境关系已同步"), "assets.service.customer_delivery_assets.environments.bind", err
		}
	}
	if method == http.MethodGet {
		if deliveryAssetCode, ok := pathParamWithSuffix(path, "/v1/assets/service/customer-delivery-assets/", "/environments"); ok {
			deliveryAssetCode, _ = url.PathUnescape(deliveryAssetCode)
			data, err := a.listCustomerDeliveryAssetEnvironments(ctx, deliveryAssetCode)
			return true, okWithMessage(data, "ok"), "assets.service.customer_delivery_assets.environments.list", err
		}
		if environmentCode, ok := pathParamWithSuffix(path, "/v1/assets/service/environments/", "/customer-delivery-assets"); ok {
			environmentCode, _ = url.PathUnescape(environmentCode)
			data, err := a.listEnvironmentDeliveryAssets(ctx, environmentCode)
			return true, okWithMessage(data, "ok"), "assets.service.environments.customer_delivery_assets.list", err
		}
		if environmentCode, ok := pathParamWithSuffix(path, "/v1/assets/service/environments/", ""); ok {
			environmentCode, _ = url.PathUnescape(environmentCode)
			data, err := a.serviceEnvironmentByCode(ctx, environmentCode)
			return true, okWithMessage(data, "ok"), "assets.service.environments.get", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) upsertServiceEnvironment(ctx context.Context, body map[string]any, operatorUID string) (map[string]any, error) {
	environmentCode := firstText(bodyText(body, "environmentCode"), bodyText(body, "environment_code"))
	idempotencyKey := firstText(bodyText(body, "idempotencyKey"), bodyText(body, "idempotency_key"))
	customerCode := firstText(bodyText(body, "customerCode"), bodyText(body, "customer_code"))
	contractCode := firstText(bodyText(body, "contractCode"), bodyText(body, "contract_code"))
	sourceProjectCode := firstText(bodyText(body, "sourceProjectCode"), bodyText(body, "source_project_code"), bodyText(body, "projectCode"), bodyText(body, "project_code"))
	environmentName := firstText(bodyText(body, "environmentName"), bodyText(body, "environment_name"))
	environmentType := normalizeEnvironmentType(firstText(bodyText(body, "environmentType"), bodyText(body, "environment_type")))
	requestedStatusText := firstText(bodyText(body, "status"), bodyText(body, "environmentStatus"), bodyText(body, "environment_status"), bodyText(body, "lifecycleStatus"), bodyText(body, "lifecycle_status"))
	statusProvided := requestedStatusText != ""
	statusText := requestedStatusText
	if statusText == "" {
		statusText = "planning"
	}
	status := normalizeEnvironmentStatus(statusText)
	if status == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_environment_transition", "invalid environment status")
	}

	if customerCode == "" || (environmentCode == "" && environmentName == "") {
		return nil, httperror.New(http.StatusBadRequest, "missing_required_field", "customerCode and environmentName are required when creating an environment")
	}
	if environmentCode == "" && idempotencyKey == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_idempotency_key", "idempotencyKey is required when creating an environment")
	}

	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		var environment map[string]any
		var err error
		created := false

		if environmentCode != "" {
			environment, err = assetEnvironmentByCodeTx(ctx, tx, environmentCode, true)
			if err != nil {
				return nil, err
			}
			if environment == nil {
				return nil, httperror.New(http.StatusNotFound, "environment_not_found", "environmentCode can only reference an existing environment")
			}
			if err := assertEnvironmentCustomer(environment, customerCode); err != nil {
				return nil, err
			}
		} else if idempotencyKey != "" {
			environment, err = assetEnvironmentByIdempotencyKeyTx(ctx, tx, idempotencyKey)
			if err != nil {
				return nil, err
			}
			if environment != nil {
				if err := assertEnvironmentCustomer(environment, customerCode); err != nil {
					return nil, err
				}
			}
		}

		if environment == nil {
			environmentCode = buildCode("ENV")
			insert, err := tx.ExecContext(ctx, `
				INSERT INTO asset_environments (
				  environment_code,
				  environment_name,
				  environment_type,
				  project_code,
				  customer_code,
				  contract_code,
				  status,
				  deployment_mode,
				  region,
				  idempotency_key,
				  topology_summary,
				  notes,
				  created_by,
				  updated_by
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`,
				environmentCode,
				environmentName,
				environmentType,
				nullableString(sourceProjectCode),
				nullableString(customerCode),
				nullableString(contractCode),
				status,
				nullableString(firstText(bodyText(body, "deploymentMode"), bodyText(body, "deployment_mode"))),
				nullableString(firstText(bodyText(body, "region"))),
				nullableString(idempotencyKey),
				nullableString(firstText(bodyText(body, "description"), bodyText(body, "topologySummary"), bodyText(body, "topology_summary"))),
				nullableString(firstText(bodyText(body, "notes"), bodyText(body, "remark"))),
				nullableString(operatorUID),
				nullableString(operatorUID),
			)
			if err != nil {
				return nil, err
			}
			id, err := insert.LastInsertId()
			if err != nil {
				return nil, err
			}
			environment, err = assetEnvironmentByIDTx(ctx, tx, id)
			if err != nil {
				return nil, err
			}
			created = true
		} else {
			targetStatus := cleanAnyString(environment["status"])
			if statusProvided {
				if !validEnvironmentTransition(targetStatus, status) {
					return nil, httperror.New(http.StatusConflict, "invalid_environment_transition", "invalid environment status transition")
				}
				targetStatus = status
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE asset_environments
				SET environment_name = COALESCE(?, environment_name),
				    project_code = COALESCE(project_code, ?),
				    contract_code = COALESCE(contract_code, ?),
				    status = ?,
				    deployment_mode = COALESCE(?, deployment_mode),
				    region = COALESCE(?, region),
				    topology_summary = COALESCE(?, topology_summary),
				    notes = COALESCE(?, notes),
				    updated_by = COALESCE(?, updated_by),
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`,
				nullableString(environmentName),
				nullableString(sourceProjectCode),
				nullableString(contractCode),
				targetStatus,
				nullableString(firstText(bodyText(body, "deploymentMode"), bodyText(body, "deployment_mode"))),
				nullableString(firstText(bodyText(body, "region"))),
				nullableString(firstText(bodyText(body, "description"), bodyText(body, "topologySummary"), bodyText(body, "topology_summary"))),
				nullableString(firstText(bodyText(body, "notes"), bodyText(body, "remark"))),
				nullableString(operatorUID),
				environment["id"],
			); err != nil {
				return nil, err
			}
			environment, err = assetEnvironmentByIDTx(ctx, tx, asInt(environment["id"]))
			if err != nil {
				return nil, err
			}
		}

		if err := insertEvent(ctx, tx, "environment", asInt(environment["id"]), "service_upsert", operatorUID, map[string]any{
			"summary":          "正式环境已同步",
			"environment_code": environment["environment_code"],
			"customer_code":    customerCode,
			"contract_code":    contractCode,
			"project_code":     sourceProjectCode,
			"created":          created,
		}); err != nil {
			return nil, err
		}

		environment["created"] = created
		environment["idempotent"] = !created
		return environment, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(map[string]any), nil
}

func (a *Adapter) bindCustomerDeliveryAssetEnvironment(ctx context.Context, deliveryAssetCode string, body map[string]any, operatorUID string) (map[string]any, error) {
	deliveryAssetCode = strings.TrimSpace(deliveryAssetCode)
	environmentCode := firstText(bodyText(body, "environmentCode"), bodyText(body, "environment_code"))
	if deliveryAssetCode == "" || environmentCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_required_field", "deliveryAssetCode and environmentCode are required")
	}

	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		return bindCustomerDeliveryAssetEnvironmentTx(ctx, tx, deliveryAssetCode, body, operatorUID)
	})
	if err != nil {
		return nil, err
	}
	return result.(map[string]any), nil
}

func bindCustomerDeliveryAssetEnvironmentTx(ctx context.Context, tx *sql.Tx, deliveryAssetCode string, body map[string]any, operatorUID string) (map[string]any, error) {
	deliveryAssetCode = strings.TrimSpace(deliveryAssetCode)
	environmentCode := firstText(bodyText(body, "environmentCode"), bodyText(body, "environment_code"))
	if deliveryAssetCode == "" || environmentCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_required_field", "deliveryAssetCode and environmentCode are required")
	}
	relationType, err := deliveryAssetEnvironmentRelationTypeInput(body, "primary", "relationType", "relation_type")
	if err != nil {
		return nil, err
	}
	deploymentStatus, err := deliveryAssetEnvironmentDeploymentStatusInput(body, "planned", "deploymentStatus", "deployment_status")
	if err != nil {
		return nil, err
	}
	status, err := deliveryAssetEnvironmentStatusInput(body, "active", "status")
	if err != nil {
		return nil, err
	}

	asset, err := customerDeliveryAssetByCodeForUpdateTx(ctx, tx, deliveryAssetCode)
	if err != nil {
		return nil, err
	}
	if asset == nil {
		return nil, httperror.New(http.StatusNotFound, "delivery_asset_not_found", "customer delivery asset not found")
	}
	environment, err := assetEnvironmentByCodeTx(ctx, tx, environmentCode, true)
	if err != nil {
		return nil, err
	}
	if environment == nil {
		return nil, httperror.New(http.StatusNotFound, "environment_not_found", "environment not found")
	}
	if err := assertDeliveryAssetEnvironmentCustomer(asset, environment); err != nil {
		return nil, err
	}

	isPrimary := relationBoolInput(body, "isPrimary", "is_primary")
	if status != "active" || deploymentStatus == "removed" {
		isPrimary = false
		if status == "active" {
			status = "ended"
		}
	}

	if isPrimary {
		if err := clearPrimaryDeliveryAssetEnvironmentTx(ctx, tx, asset["id"], operatorUID); err != nil {
			return nil, err
		}
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO customer_delivery_asset_environment_rel (
		  delivery_asset_id,
		  environment_id,
		  relation_type,
		  is_primary,
		  deployment_status,
		  deployed_version,
		  effective_from,
		  effective_to,
		  status,
		  source_project_code,
		  created_by,
		  updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  is_primary = VALUES(is_primary),
		  deployment_status = VALUES(deployment_status),
		  deployed_version = COALESCE(VALUES(deployed_version), deployed_version),
		  effective_from = COALESCE(VALUES(effective_from), effective_from),
		  effective_to = VALUES(effective_to),
		  status = VALUES(status),
		  source_project_code = COALESCE(VALUES(source_project_code), source_project_code),
		  deleted_at = NULL,
		  updated_by = VALUES(updated_by),
		  updated_at = CURRENT_TIMESTAMP
	`,
		asset["id"],
		environment["id"],
		relationType,
		boolIntForAssets(isPrimary),
		deploymentStatus,
		nullableString(firstText(bodyText(body, "deployedVersion"), bodyText(body, "deployed_version"), bodyText(body, "productVersion"), bodyText(body, "product_version"))),
		nullableString(firstText(bodyText(body, "effectiveFrom"), bodyText(body, "effective_from"))),
		nullableString(firstText(bodyText(body, "effectiveTo"), bodyText(body, "effective_to"))),
		status,
		nullableString(firstText(bodyText(body, "sourceProjectCode"), bodyText(body, "source_project_code"), bodyText(body, "projectCode"), bodyText(body, "project_code"))),
		nullableString(operatorUID),
		nullableString(operatorUID),
	)
	if err != nil {
		return nil, err
	}

	if isPrimary {
		if _, err := tx.ExecContext(ctx, `
			UPDATE customer_delivery_assets
			SET environment_code = ?,
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, environmentCode, nullableString(operatorUID), asset["id"]); err != nil {
			return nil, err
		}
	} else if status != "active" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE customer_delivery_assets
			SET environment_code = CASE WHEN environment_code = ? THEN NULL ELSE environment_code END,
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, environmentCode, nullableString(operatorUID), asset["id"]); err != nil {
			return nil, err
		}
	}

	if err := insertEvent(ctx, tx, "customer_delivery_asset", asInt(asset["id"]), "environment_bound", operatorUID, map[string]any{
		"summary":             "客户交付资产环境关系已同步",
		"delivery_asset_code": deliveryAssetCode,
		"environment_code":    environmentCode,
		"relation_type":       relationType,
		"deployment_status":   deploymentStatus,
		"is_primary":          isPrimary,
	}); err != nil {
		return nil, err
	}

	relation, err := deliveryAssetEnvironmentRelationTx(ctx, tx, asset["id"], environment["id"], relationType)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"delivery_asset": asset,
		"environment":    environment,
		"relation":       relation,
	}, nil
}

func (a *Adapter) syncServiceEnvironmentLifecycle(ctx context.Context, environmentCode string, body map[string]any, operatorUID string) (map[string]any, error) {
	requestedStatusText := firstText(bodyText(body, "status"), bodyText(body, "lifecycleStatus"), bodyText(body, "lifecycle_status"))
	targetStatus := normalizeEnvironmentStatus(requestedStatusText)
	if targetStatus == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_status", "status is required")
	}
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		environment, err := assetEnvironmentByCodeTx(ctx, tx, environmentCode, true)
		if err != nil {
			return nil, err
		}
		if environment == nil {
			return nil, httperror.New(http.StatusNotFound, "environment_not_found", "environment not found")
		}
		currentStatus := cleanAnyString(environment["status"])
		if !validEnvironmentTransition(currentStatus, targetStatus) {
			return nil, httperror.New(http.StatusConflict, "invalid_environment_transition", "invalid environment status transition")
		}
		goLiveAt := firstText(bodyText(body, "goLiveAt"), bodyText(body, "go_live_at"))
		acceptedAt := firstText(bodyText(body, "acceptedAt"), bodyText(body, "accepted_at"))
		retiredAt := firstText(bodyText(body, "retiredAt"), bodyText(body, "retired_at"))
		now := time.Now().UTC().Format("2006-01-02 15:04:05")
		if goLiveAt == "" && targetStatus == "active" {
			goLiveAt = now
		}
		if acceptedAt == "" && strings.EqualFold(strings.TrimSpace(requestedStatusText), "accepted") {
			acceptedAt = now
		}
		if retiredAt == "" && targetStatus == "retired" {
			retiredAt = now
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE asset_environments
			SET status = ?,
			    project_code = COALESCE(?, project_code),
			    go_live_at = COALESCE(?, go_live_at),
			    accepted_at = COALESCE(?, accepted_at),
			    retired_at = COALESCE(?, retired_at),
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`,
			targetStatus,
			nullableString(firstText(bodyText(body, "sourceProjectCode"), bodyText(body, "source_project_code"), bodyText(body, "projectCode"), bodyText(body, "project_code"))),
			nullableString(goLiveAt),
			nullableString(acceptedAt),
			nullableString(retiredAt),
			nullableString(operatorUID),
			environment["id"],
		); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "environment", asInt(environment["id"]), "lifecycle_sync", operatorUID, map[string]any{
			"environment_code": environmentCode,
			"old_status":       currentStatus,
			"new_status":       targetStatus,
		}); err != nil {
			return nil, err
		}
		return assetEnvironmentByIDTx(ctx, tx, asInt(environment["id"]))
	})
	if err != nil {
		return nil, err
	}
	return result.(map[string]any), nil
}

func (a *Adapter) listCustomerDeliveryAssetEnvironments(ctx context.Context, deliveryAssetCode string) (map[string]any, error) {
	asset, err := a.queryRowMap(ctx, `
		SELECT *
		FROM customer_delivery_assets
		WHERE delivery_asset_code = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, deliveryAssetCode)
	if err != nil {
		return nil, err
	}
	if asset == nil {
		return nil, httperror.New(http.StatusNotFound, "delivery_asset_not_found", "customer delivery asset not found")
	}
	items, err := a.queryMaps(ctx, `
		SELECT
		  rel.*,
		  env.environment_code,
		  env.environment_name,
		  env.environment_type,
		  env.customer_code,
		  env.contract_code,
		  env.project_code,
		  env.status AS environment_status,
		  env.deployment_mode,
		  env.region,
		  'relation' AS source
		FROM customer_delivery_asset_environment_rel rel
		INNER JOIN asset_environments env ON env.id = rel.environment_id
		WHERE rel.delivery_asset_id = ?
		  AND rel.deleted_at IS NULL
		  AND env.status <> 'retired'
		ORDER BY rel.is_primary DESC, rel.relation_type ASC, rel.id ASC
	`, asset["id"])
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		if envCode := cleanAnyString(asset["environment_code"]); envCode != "" {
			env, err := a.queryRowMap(ctx, `
				SELECT
				  id AS environment_id,
				  environment_code,
				  environment_name,
				  environment_type,
				  customer_code,
				  contract_code,
				  project_code,
				  status AS environment_status,
				  deployment_mode,
				  region,
				  'legacy_snapshot' AS source
				FROM asset_environments
				WHERE environment_code = ?
				LIMIT 1
			`, envCode)
			if err != nil {
				return nil, err
			}
			if env != nil {
				env["relation_type"] = "primary"
				env["is_primary"] = true
				env["deployment_status"] = "planned"
				items = append(items, env)
			}
		}
	}
	return map[string]any{"delivery_asset": asset, "items": items, "total": len(items)}, nil
}

func (a *Adapter) listEnvironmentDeliveryAssets(ctx context.Context, environmentCode string) (map[string]any, error) {
	environment, err := a.serviceEnvironmentByCode(ctx, environmentCode)
	if err != nil {
		return nil, err
	}
	items, err := a.queryMaps(ctx, `
		SELECT
		  cda.*,
		  rel.relation_type,
		  rel.is_primary,
		  rel.deployment_status,
		  rel.deployed_version,
		  rel.effective_from,
		  rel.effective_to,
		  rel.status AS relation_status,
		  rel.source_project_code
		FROM customer_delivery_asset_environment_rel rel
		INNER JOIN customer_delivery_assets cda ON cda.id = rel.delivery_asset_id
		INNER JOIN asset_environments env ON env.id = rel.environment_id
		WHERE env.environment_code = ?
		  AND rel.deleted_at IS NULL
		  AND cda.deleted_at IS NULL
		ORDER BY rel.is_primary DESC, cda.delivery_asset_code ASC
	`, environmentCode)
	if err != nil {
		return nil, err
	}
	return map[string]any{"environment": environment, "items": items, "total": len(items)}, nil
}

func (a *Adapter) serviceEnvironmentByCode(ctx context.Context, environmentCode string) (map[string]any, error) {
	environmentCode = strings.TrimSpace(environmentCode)
	if environmentCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_environment_code", "environmentCode is required")
	}
	environment, err := a.queryRowMap(ctx, `
		SELECT *
		FROM asset_environments
		WHERE environment_code = ?
		LIMIT 1
	`, environmentCode)
	if err != nil {
		return nil, err
	}
	if environment == nil {
		return nil, httperror.New(http.StatusNotFound, "environment_not_found", "environment not found")
	}
	return environment, nil
}

func (a *Adapter) resolveServiceReferences(ctx context.Context, body map[string]any) (map[string]any, error) {
	environmentCodes := cleanStringList(parseJSONStringList(firstPresentValue(body, "environmentCodes", "environment_codes")))
	deliveryAssetCodes := cleanStringList(parseJSONStringList(firstPresentValue(body, "deliveryAssetCodes", "delivery_asset_codes")))
	type pairInput struct {
		DeliveryAssetCode string
		EnvironmentCode   string
	}
	pairs := []pairInput{}
	for _, raw := range mapSliceFromAny(firstPresentValue(body, "pairs", "targets")) {
		deliveryAssetCode := firstText(bodyText(raw, "deliveryAssetCode"), bodyText(raw, "delivery_asset_code"))
		environmentCode := firstText(bodyText(raw, "environmentCode"), bodyText(raw, "environment_code"))
		if deliveryAssetCode != "" && environmentCode != "" {
			pairs = append(pairs, pairInput{DeliveryAssetCode: deliveryAssetCode, EnvironmentCode: environmentCode})
		}
	}

	environmentRows := map[string]map[string]any{}
	environments := []map[string]any{}
	if len(environmentCodes) > 0 {
		rows, err := a.queryMaps(ctx, `
			SELECT *
			FROM asset_environments
			WHERE environment_code IN (`+assetsPlaceholders(len(environmentCodes))+`)
		`, stringsToAny(environmentCodes)...)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			environmentRows[cleanAnyString(row["environment_code"])] = row
		}
	}
	for _, code := range environmentCodes {
		item := environmentRows[code]
		environments = append(environments, map[string]any{"code": code, "found": item != nil, "item": item})
	}

	assetRows := map[string]map[string]any{}
	assets := []map[string]any{}
	if len(deliveryAssetCodes) > 0 {
		rows, err := a.queryMaps(ctx, `
			SELECT *
			FROM customer_delivery_assets
			WHERE delivery_asset_code IN (`+assetsPlaceholders(len(deliveryAssetCodes))+`)
			  AND deleted_at IS NULL
		`, stringsToAny(deliveryAssetCodes)...)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			assetRows[cleanAnyString(row["delivery_asset_code"])] = row
		}
	}
	for _, code := range deliveryAssetCodes {
		item := assetRows[code]
		assets = append(assets, map[string]any{"code": code, "found": item != nil, "item": item})
	}

	pairRows := map[string]map[string]any{}
	pairResults := []map[string]any{}
	if len(pairs) > 0 {
		pairClauses := make([]string, 0, len(pairs))
		pairArgs := make([]any, 0, len(pairs)*2)
		for _, pair := range pairs {
			pairClauses = append(pairClauses, "(cda.delivery_asset_code = ? AND env.environment_code = ?)")
			pairArgs = append(pairArgs, pair.DeliveryAssetCode, pair.EnvironmentCode)
		}
		rows, err := a.queryMaps(ctx, `
			SELECT
			  rel.*,
			  cda.delivery_asset_code,
			  env.environment_code,
			  cda.customer_code AS delivery_asset_customer_code,
			  env.customer_code AS environment_customer_code
			FROM customer_delivery_asset_environment_rel rel
			INNER JOIN customer_delivery_assets cda ON cda.id = rel.delivery_asset_id
			INNER JOIN asset_environments env ON env.id = rel.environment_id
			WHERE rel.deleted_at IS NULL
			  AND rel.status = 'active'
			  AND cda.deleted_at IS NULL
			  AND (`+strings.Join(pairClauses, " OR ")+`)
		`, pairArgs...)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			key := cleanAnyString(row["delivery_asset_code"]) + "\x00" + cleanAnyString(row["environment_code"])
			pairRows[key] = row
		}
	}
	for _, pair := range pairs {
		item := pairRows[pair.DeliveryAssetCode+"\x00"+pair.EnvironmentCode]
		pairResults = append(pairResults, map[string]any{
			"delivery_asset_code": pair.DeliveryAssetCode,
			"environment_code":    pair.EnvironmentCode,
			"found":               item != nil,
			"item":                item,
		})
	}
	return map[string]any{"environments": environments, "delivery_assets": assets, "pairs": pairResults}, nil
}

func assetsPlaceholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}

func stringsToAny(values []string) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func assetEnvironmentByIDTx(ctx context.Context, tx *sql.Tx, id int64) (map[string]any, error) {
	return assetsTxQueryOneMap(ctx, tx, "SELECT * FROM asset_environments WHERE id = ? LIMIT 1", id)
}

func assetEnvironmentByCodeTx(ctx context.Context, tx *sql.Tx, environmentCode string, forUpdate bool) (map[string]any, error) {
	query := `
		SELECT *
		FROM asset_environments
		WHERE environment_code = ?
		LIMIT 1`
	if forUpdate {
		query += " FOR UPDATE"
	}
	return assetsTxQueryOneMap(ctx, tx, query, environmentCode)
}

func assetEnvironmentByIdempotencyKeyTx(ctx context.Context, tx *sql.Tx, idempotencyKey string) (map[string]any, error) {
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		return nil, nil
	}
	return assetsTxQueryOneMap(ctx, tx, `
		SELECT *
		FROM asset_environments
		WHERE idempotency_key = ?
		LIMIT 1
		FOR UPDATE
	`, idempotencyKey)
}

func customerDeliveryAssetByCodeForUpdateTx(ctx context.Context, tx *sql.Tx, deliveryAssetCode string) (map[string]any, error) {
	return assetsTxQueryOneMap(ctx, tx, `
		SELECT *
		FROM customer_delivery_assets
		WHERE delivery_asset_code = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, deliveryAssetCode)
}

func deliveryAssetEnvironmentRelationTx(ctx context.Context, tx *sql.Tx, deliveryAssetID any, environmentID any, relationType string) (map[string]any, error) {
	return assetsTxQueryOneMap(ctx, tx, `
		SELECT *
		FROM customer_delivery_asset_environment_rel
		WHERE delivery_asset_id = ?
		  AND environment_id = ?
		  AND relation_type = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, deliveryAssetID, environmentID, relationType)
}

func assetsTxQueryOneMap(ctx context.Context, tx *sql.Tx, query string, args ...any) (map[string]any, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return items[0], nil
}

func clearPrimaryDeliveryAssetEnvironmentTx(ctx context.Context, tx *sql.Tx, deliveryAssetID any, operatorUID string) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE customer_delivery_asset_environment_rel
		SET is_primary = 0,
		    updated_by = COALESCE(?, updated_by),
		    updated_at = CURRENT_TIMESTAMP
		WHERE delivery_asset_id = ?
		  AND deleted_at IS NULL
		  AND status = 'active'
		  AND is_primary = 1
	`, nullableString(operatorUID), deliveryAssetID)
	return err
}

func assertEnvironmentCustomer(environment map[string]any, customerCode string) error {
	current := cleanAnyString(environment["customer_code"])
	if current != "" && customerCode != "" && current != customerCode {
		return httperror.New(http.StatusConflict, "environment_customer_conflict", "environment belongs to another customer")
	}
	return nil
}

func assertDeliveryAssetEnvironmentCustomer(asset map[string]any, environment map[string]any) error {
	assetCustomer := cleanAnyString(asset["customer_code"])
	environmentCustomer := cleanAnyString(environment["customer_code"])
	if assetCustomer != "" && environmentCustomer != "" && assetCustomer != environmentCustomer {
		return httperror.New(http.StatusConflict, "delivery_asset_environment_conflict", "delivery asset and environment belong to different customers")
	}
	return nil
}

func normalizeEnvironmentType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "dev", "test", "staging", "internal_prod", "customer_test", "customer_prod":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "customer_prod"
	}
}

func normalizeEnvironmentStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "planning", "planned", "provisioning":
		return "planning"
	case "active", "online", "accepted":
		return "active"
	case "frozen", "suspended":
		return "frozen"
	case "retired", "terminated", "removed":
		return "retired"
	default:
		return ""
	}
}

func validEnvironmentTransition(current string, target string) bool {
	current = normalizeEnvironmentStatus(current)
	target = normalizeEnvironmentStatus(target)
	if target == "" {
		return false
	}
	if current == "" || current == target {
		return true
	}
	switch current {
	case "planning":
		return target == "active" || target == "frozen" || target == "retired"
	case "active":
		return target == "frozen" || target == "retired"
	case "frozen":
		return target == "active" || target == "retired"
	case "retired":
		return false
	default:
		return false
	}
}

func normalizeDeliveryAssetEnvironmentRelationType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "primary", "test", "production", "backup", "disaster_recovery", "training", "other":
		return strings.ToLower(strings.TrimSpace(value))
	case "prod":
		return "production"
	case "dr":
		return "disaster_recovery"
	default:
		return ""
	}
}

func normalizeDeliveryAssetEnvironmentDeploymentStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "planned", "provisioning", "deployed", "online", "accepted", "suspended", "removed":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func normalizeDeliveryAssetEnvironmentStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "active", "ended", "cancelled":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func deliveryAssetEnvironmentRelationTypeInput(body map[string]any, defaultValue string, keys ...string) (string, error) {
	raw := firstTextFromBodyKeys(body, keys...)
	if raw == "" {
		return defaultValue, nil
	}
	value := normalizeDeliveryAssetEnvironmentRelationType(raw)
	if value == "" {
		return "", httperror.New(http.StatusBadRequest, "delivery_asset_environment_conflict", "invalid delivery asset environment relationType")
	}
	return value, nil
}

func deliveryAssetEnvironmentDeploymentStatusInput(body map[string]any, defaultValue string, keys ...string) (string, error) {
	raw := firstTextFromBodyKeys(body, keys...)
	if raw == "" {
		return defaultValue, nil
	}
	value := normalizeDeliveryAssetEnvironmentDeploymentStatus(raw)
	if value == "" {
		return "", httperror.New(http.StatusBadRequest, "invalid_environment_transition", "invalid delivery asset environment deploymentStatus")
	}
	return value, nil
}

func deliveryAssetEnvironmentStatusInput(body map[string]any, defaultValue string, keys ...string) (string, error) {
	raw := firstTextFromBodyKeys(body, keys...)
	if raw == "" {
		return defaultValue, nil
	}
	value := normalizeDeliveryAssetEnvironmentStatus(raw)
	if value == "" {
		return "", httperror.New(http.StatusBadRequest, "invalid_environment_transition", "invalid delivery asset environment status")
	}
	return value, nil
}

func firstTextFromBodyKeys(body map[string]any, keys ...string) string {
	values := make([]string, 0, len(keys))
	for _, key := range keys {
		values = append(values, bodyText(body, key))
	}
	return firstText(values...)
}

func relationBoolInput(body map[string]any, keys ...string) bool {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			switch typed := value.(type) {
			case bool:
				return typed
			case string:
				text := strings.ToLower(strings.TrimSpace(typed))
				return text == "true" || text == "1" || text == "yes"
			default:
				return float64FromAny(value) != 0
			}
		}
	}
	return false
}

func boolIntForAssets(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

func firstPresentValue(body map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			return value
		}
	}
	return nil
}

func mapSliceFromAny(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		result := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if mapped, ok := item.(map[string]any); ok {
				result = append(result, mapped)
			}
		}
		return result
	default:
		return []map[string]any{}
	}
}
