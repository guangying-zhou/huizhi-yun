package assets

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) createAsset(ctx context.Context, body map[string]any, operatorUID string) (map[string]any, error) {
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		category := coalesceText(body, "asset_category", "physical")
		physicalDetails := mapField(body, "physical_details")
		resourceDetails := mapField(body, "resource_details")
		assetPurpose := coalesceText(body, "asset_purpose", "self_use")
		if err := assertProjectPurpose(assetPurpose, bodyText(body, "project_code"), "资产"); err != nil {
			return nil, err
		}

		publicID := generateUUID()
		assetCode := bodyText(body, "asset_code")
		if assetCode == "" {
			if category == "physical" {
				itemType := firstText(bodyText(physicalDetails, "physical_item_type"), bodyText(physicalDetails, "physical_type"))
				subtypeToken, itemTypeToken, err := a.getPhysicalAssetCodeTokens(ctx, bodyText(body, "asset_subtype"), itemType)
				if err != nil {
					return nil, err
				}
				assetCode = buildPhysicalAssetCode(bodyText(body, "asset_subtype"), itemType, subtypeToken, itemTypeToken)
			} else {
				assetCode = buildCode("RS")
			}
		}

		insert, err := tx.ExecContext(ctx, `
			INSERT INTO asset_items (
			  public_id, asset_code, asset_name, asset_category, asset_subtype, asset_purpose, ownership_type, dept_code,
			  project_code, customer_code, contract_code, environment_id, owner_uid, user_uid, custodian_uid,
			  status, source_type, source_no, cost_bearer, finance_subject, sensitivity_level,
			  is_external_exposed, is_key_business_asset, tags, notes, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			publicID,
			assetCode,
			coalesceText(body, "asset_name", assetCode),
			category,
			coalesceText(body, "asset_subtype", "未分类"),
			assetPurpose,
			coalesceText(body, "ownership_type", "internal"),
			coalesceText(body, "dept_code", "UNKNOWN"),
			nullableBodyText(body, "project_code"),
			nullableBodyText(body, "customer_code"),
			nullableBodyText(body, "contract_code"),
			nullableBodyInt64(body, "environment_id"),
			nullableBodyText(body, "owner_uid"),
			nullableBodyText(body, "user_uid"),
			nullableBodyText(body, "custodian_uid"),
			firstText(bodyText(body, "status"), map[string]string{"resource": "active"}[category], "in_stock"),
			coalesceText(body, "source_type", "manual"),
			nullableBodyText(body, "source_no"),
			coalesceText(body, "cost_bearer", "company"),
			nullableBodyText(body, "finance_subject"),
			coalesceText(body, "sensitivity_level", "normal"),
			boolIntFromAny(body["is_external_exposed"]),
			boolIntFromAny(body["is_key_business_asset"]),
			jsonOrNil(body["tags"]),
			nullableBodyText(body, "notes"),
			nullableString(operatorUID),
			nullableString(operatorUID),
		)
		if err != nil {
			return nil, err
		}
		assetID, err := insert.LastInsertId()
		if err != nil {
			return nil, err
		}

		if category == "physical" {
			itemType := firstText(bodyText(physicalDetails, "physical_item_type"), bodyText(physicalDetails, "physical_type"), "未细分")
			qrCode := firstText(bodyText(physicalDetails, "qr_code"), "HZY-ASSET:"+publicID)
			hasConfigDetail, columnErr := a.physicalConfigDetailColumnExists(ctx)
			if columnErr != nil {
				return nil, columnErr
			}
			if hasConfigDetail {
				_, err = tx.ExecContext(ctx, `
					INSERT INTO asset_physical_details (
					  asset_id, physical_type, brand, model, config_detail, serial_number, location, purchased_at,
					  purchase_amount, expected_service_years, inventory_status, claim_status, qr_code
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					assetID,
					itemType,
					nullableBodyText(physicalDetails, "brand"),
					nullableBodyText(physicalDetails, "model"),
					nullableBodyText(physicalDetails, "config_detail"),
					nullableBodyText(physicalDetails, "serial_number"),
					nullableBodyText(physicalDetails, "location"),
					nullableBodyText(physicalDetails, "purchased_at"),
					nullableBodyFloat(physicalDetails, "purchase_amount"),
					nullableBodyInt64(physicalDetails, "expected_service_years"),
					coalesceText(physicalDetails, "inventory_status", "in_stock"),
					coalesceText(physicalDetails, "claim_status", "unclaimed"),
					qrCode,
				)
			} else {
				_, err = tx.ExecContext(ctx, `
					INSERT INTO asset_physical_details (
					  asset_id, physical_type, brand, model, serial_number, location, purchased_at,
					  purchase_amount, expected_service_years, inventory_status, claim_status, qr_code
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					assetID,
					itemType,
					nullableBodyText(physicalDetails, "brand"),
					nullableBodyText(physicalDetails, "model"),
					nullableBodyText(physicalDetails, "serial_number"),
					nullableBodyText(physicalDetails, "location"),
					nullableBodyText(physicalDetails, "purchased_at"),
					nullableBodyFloat(physicalDetails, "purchase_amount"),
					nullableBodyInt64(physicalDetails, "expected_service_years"),
					coalesceText(physicalDetails, "inventory_status", "in_stock"),
					coalesceText(physicalDetails, "claim_status", "unclaimed"),
					qrCode,
				)
			}
			if err != nil {
				return nil, err
			}
		}

		if category == "resource" {
			_, err = tx.ExecContext(ctx, `
				INSERT INTO asset_resource_details (
				  asset_id, resource_type, provider, instance_identifier, spec_summary, deployment_mode,
				  billing_mode, billing_cycle, effective_at, expires_at, auto_renew, monthly_cost, usage_mode,
				  purchased_quantity, assigned_quantity, available_quantity, tenant_account, credential_ciphertext,
				  credential_masked, credential_updated_at, last_synced_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				assetID,
				coalesceText(resourceDetails, "resource_type", "infrastructure"),
				nullableBodyText(resourceDetails, "provider"),
				nullableBodyText(resourceDetails, "instance_identifier"),
				nullableBodyText(resourceDetails, "spec_summary"),
				coalesceText(resourceDetails, "deployment_mode", "public_cloud"),
				coalesceText(resourceDetails, "billing_mode", "subscription"),
				coalesceText(resourceDetails, "billing_cycle", "monthly"),
				nullableBodyText(resourceDetails, "effective_at"),
				nullableBodyText(resourceDetails, "expires_at"),
				boolIntFromAny(resourceDetails["auto_renew"]),
				nullableBodyFloat(resourceDetails, "monthly_cost"),
				coalesceText(resourceDetails, "usage_mode", "resource"),
				nullableBodyFloat(resourceDetails, "purchased_quantity"),
				float64FromAny(resourceDetails["assigned_quantity"]),
				nullableBodyFloat(resourceDetails, "available_quantity"),
				nullableBodyText(resourceDetails, "tenant_account"),
				nullableBodyText(resourceDetails, "credential_ciphertext"),
				nullableBodyText(resourceDetails, "credential_masked"),
				nullableBodyText(resourceDetails, "credential_updated_at"),
				nullableBodyText(resourceDetails, "last_synced_at"),
			)
			if err != nil {
				return nil, err
			}
		}

		if err := insertEvent(ctx, tx, "asset", assetID, "created", operatorUID, map[string]any{
			"summary":    "资产已创建",
			"asset_code": assetCode,
			"public_id":  publicID,
		}); err != nil {
			return nil, err
		}
		return map[string]any{"id": assetID, "public_id": publicID}, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(map[string]any), nil
}

func (a *Adapter) updateAsset(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	if err := assertProjectPurpose(bodyText(body, "asset_purpose"), bodyText(body, "project_code"), "资产"); err != nil {
		return err
	}
	_, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		_, err := tx.ExecContext(ctx, `
			UPDATE asset_items
			SET asset_name = COALESCE(?, asset_name),
			    asset_subtype = COALESCE(?, asset_subtype),
			    asset_purpose = COALESCE(?, asset_purpose),
			    ownership_type = COALESCE(?, ownership_type),
			    dept_code = COALESCE(?, dept_code),
			    project_code = ?,
			    customer_code = ?,
			    contract_code = ?,
			    environment_id = ?,
			    owner_uid = ?,
			    user_uid = ?,
			    custodian_uid = ?,
			    source_no = ?,
			    cost_bearer = COALESCE(?, cost_bearer),
			    finance_subject = ?,
			    sensitivity_level = COALESCE(?, sensitivity_level),
			    is_external_exposed = COALESCE(?, is_external_exposed),
			    is_key_business_asset = COALESCE(?, is_key_business_asset),
			    tags = COALESCE(?, tags),
			    notes = ?,
			    updated_by = ?
			WHERE id = ?`,
			nullableBodyText(body, "asset_name"),
			nullableBodyText(body, "asset_subtype"),
			nullableBodyText(body, "asset_purpose"),
			nullableBodyText(body, "ownership_type"),
			nullableBodyText(body, "dept_code"),
			nullableBodyText(body, "project_code"),
			nullableBodyText(body, "customer_code"),
			nullableBodyText(body, "contract_code"),
			nullableBodyInt64(body, "environment_id"),
			nullableBodyText(body, "owner_uid"),
			nullableBodyText(body, "user_uid"),
			nullableBodyText(body, "custodian_uid"),
			nullableBodyText(body, "source_no"),
			nullableBodyText(body, "cost_bearer"),
			nullableBodyText(body, "finance_subject"),
			nullableBodyText(body, "sensitivity_level"),
			boolIntFromAny(body["is_external_exposed"]),
			boolIntFromAny(body["is_key_business_asset"]),
			jsonOrNil(body["tags"]),
			nullableBodyText(body, "notes"),
			nullableString(operatorUID),
			id,
		)
		if err != nil {
			return nil, err
		}

		if details, ok := body["physical_details"].(map[string]any); ok {
			hasConfigDetail, columnErr := a.physicalConfigDetailColumnExists(ctx)
			if columnErr != nil {
				return nil, columnErr
			}
			if hasConfigDetail {
				_, err = tx.ExecContext(ctx, `
					UPDATE asset_physical_details
					SET physical_type = COALESCE(?, physical_type),
					    brand = ?,
					    model = ?,
					    config_detail = ?,
					    serial_number = ?,
					    location = ?,
					    purchased_at = ?,
					    purchase_amount = ?,
					    expected_service_years = ?,
					    inventory_status = COALESCE(?, inventory_status),
					    claim_status = COALESCE(?, claim_status),
					    qr_code = ?
					WHERE asset_id = ?`,
					firstText(bodyText(details, "physical_item_type"), bodyText(details, "physical_type")),
					nullableBodyText(details, "brand"),
					nullableBodyText(details, "model"),
					nullableBodyText(details, "config_detail"),
					nullableBodyText(details, "serial_number"),
					nullableBodyText(details, "location"),
					nullableBodyText(details, "purchased_at"),
					nullableBodyFloat(details, "purchase_amount"),
					nullableBodyInt64(details, "expected_service_years"),
					nullableBodyText(details, "inventory_status"),
					nullableBodyText(details, "claim_status"),
					nullableBodyText(details, "qr_code"),
					id,
				)
			} else {
				_, err = tx.ExecContext(ctx, `
					UPDATE asset_physical_details
					SET physical_type = COALESCE(?, physical_type),
					    brand = ?,
					    model = ?,
					    serial_number = ?,
					    location = ?,
					    purchased_at = ?,
					    purchase_amount = ?,
					    expected_service_years = ?,
					    inventory_status = COALESCE(?, inventory_status),
					    claim_status = COALESCE(?, claim_status),
					    qr_code = ?
					WHERE asset_id = ?`,
					firstText(bodyText(details, "physical_item_type"), bodyText(details, "physical_type")),
					nullableBodyText(details, "brand"),
					nullableBodyText(details, "model"),
					nullableBodyText(details, "serial_number"),
					nullableBodyText(details, "location"),
					nullableBodyText(details, "purchased_at"),
					nullableBodyFloat(details, "purchase_amount"),
					nullableBodyInt64(details, "expected_service_years"),
					nullableBodyText(details, "inventory_status"),
					nullableBodyText(details, "claim_status"),
					nullableBodyText(details, "qr_code"),
					id,
				)
			}
			if err != nil {
				return nil, err
			}
		}

		if details, ok := body["resource_details"].(map[string]any); ok {
			_, err = tx.ExecContext(ctx, `
				UPDATE asset_resource_details
				SET resource_type = COALESCE(?, resource_type),
				    provider = ?,
				    instance_identifier = ?,
				    spec_summary = ?,
				    deployment_mode = COALESCE(?, deployment_mode),
				    billing_mode = COALESCE(?, billing_mode),
				    billing_cycle = COALESCE(?, billing_cycle),
				    effective_at = ?,
				    expires_at = ?,
				    auto_renew = COALESCE(?, auto_renew),
				    monthly_cost = ?,
				    usage_mode = COALESCE(?, usage_mode),
				    purchased_quantity = ?,
				    assigned_quantity = ?,
				    available_quantity = ?,
				    tenant_account = ?,
				    credential_ciphertext = ?,
				    credential_masked = ?,
				    credential_updated_at = ?,
				    last_synced_at = ?
				WHERE asset_id = ?`,
				nullableBodyText(details, "resource_type"),
				nullableBodyText(details, "provider"),
				nullableBodyText(details, "instance_identifier"),
				nullableBodyText(details, "spec_summary"),
				nullableBodyText(details, "deployment_mode"),
				nullableBodyText(details, "billing_mode"),
				nullableBodyText(details, "billing_cycle"),
				nullableBodyText(details, "effective_at"),
				nullableBodyText(details, "expires_at"),
				boolIntFromAny(details["auto_renew"]),
				nullableBodyFloat(details, "monthly_cost"),
				nullableBodyText(details, "usage_mode"),
				nullableBodyFloat(details, "purchased_quantity"),
				nullableBodyFloat(details, "assigned_quantity"),
				nullableBodyFloat(details, "available_quantity"),
				nullableBodyText(details, "tenant_account"),
				nullableBodyText(details, "credential_ciphertext"),
				nullableBodyText(details, "credential_masked"),
				nullableBodyText(details, "credential_updated_at"),
				nullableBodyText(details, "last_synced_at"),
				id,
			)
			if err != nil {
				return nil, err
			}
		}

		if err := insertEvent(ctx, tx, "asset", id, "updated", operatorUID, map[string]any{"summary": "资产信息已更新"}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	return err
}

func (a *Adapter) changeAssetStatus(ctx context.Context, id int64, status string, operatorUID string) error {
	_, err := a.DB().ExecContext(ctx, `UPDATE asset_items SET status = ?, updated_by = ? WHERE id = ?`, status, nullableString(operatorUID), id)
	return err
}

func (a *Adapter) linkDocument(ctx context.Context, objectType string, objectID int64, body map[string]any, operatorUID string) error {
	documentID := firstText(bodyText(body, "document_id"), bodyText(body, "documentUuid"), bodyText(body, "document_uuid"))
	if documentID == "" {
		return httperror.New(http.StatusBadRequest, "missing_document_id", "缺少 document_id")
	}
	documentType := normalizeAssetDocumentType(coalesceText(body, "document_type", "other"))
	hasArtifactType, err := a.tableColumnExists(ctx, "asset_documents", "artifact_type")
	if err != nil {
		return err
	}
	hasSourceContext, err := a.tableColumnExists(ctx, "asset_documents", "source_context")
	if err != nil {
		return err
	}

	columns := []string{"object_type", "object_id", "document_id", "document_type"}
	placeholders := []string{"?", "?", "?", "?"}
	args := []any{objectType, objectID, documentID, documentType}
	updates := []string{"document_type = VALUES(document_type)"}

	if hasArtifactType {
		columns = append(columns, "artifact_type")
		placeholders = append(placeholders, "?")
		args = append(args, nullableString(firstText(bodyText(body, "artifact_type"), bodyText(body, "artifactType"))))
		updates = append(updates, "artifact_type = VALUES(artifact_type)")
	}
	if hasSourceContext {
		columns = append(columns, "source_context")
		placeholders = append(placeholders, "?")
		args = append(args, jsonOrNil(body["source_context"]))
		updates = append(updates, "source_context = COALESCE(VALUES(source_context), source_context)")
	}

	columns = append(columns, "remark", "linked_by")
	placeholders = append(placeholders, "?", "?")
	args = append(args, nullableBodyText(body, "remark"), nullableString(operatorUID))
	updates = append(updates, "remark = VALUES(remark)", "linked_by = VALUES(linked_by)", "linked_at = CURRENT_TIMESTAMP")

	query := `
		INSERT INTO asset_documents (` + strings.Join(columns, ", ") + `)
		VALUES (` + strings.Join(placeholders, ", ") + `)
		ON DUPLICATE KEY UPDATE ` + strings.Join(updates, ", ")
	_, err = a.DB().ExecContext(ctx, query, args...)
	return err
}

func (a *Adapter) createEnvironment(ctx context.Context, body map[string]any, operatorUID string) (int64, error) {
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO asset_environments (
			  environment_code, environment_name, environment_type, project_code, customer_code, contract_code,
			  status, dept_code, owner_uid, maintainer_uid, topology_summary, notes, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			coalesceText(body, "environment_code", buildCode("ENV")),
			coalesceText(body, "environment_name", firstText(bodyText(body, "environment_code"), "未命名环境")),
			coalesceText(body, "environment_type", "test"),
			coalesceText(body, "project_code", "UNKNOWN"),
			nullableBodyText(body, "customer_code"),
			nullableBodyText(body, "contract_code"),
			coalesceText(body, "status", "planning"),
			nullableBodyText(body, "dept_code"),
			nullableBodyText(body, "owner_uid"),
			nullableBodyText(body, "maintainer_uid"),
			nullableBodyText(body, "topology_summary"),
			nullableBodyText(body, "notes"),
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
		if err := insertEvent(ctx, tx, "environment", id, "created", operatorUID, map[string]any{"summary": "环境已创建"}); err != nil {
			return nil, err
		}
		return id, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) updateEnvironment(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	_, err := a.DB().ExecContext(ctx, `
		UPDATE asset_environments
		SET environment_name = COALESCE(?, environment_name),
		    environment_type = COALESCE(?, environment_type),
		    project_code = COALESCE(?, project_code),
		    customer_code = ?,
		    contract_code = ?,
		    status = COALESCE(?, status),
		    dept_code = ?,
		    owner_uid = ?,
		    maintainer_uid = ?,
		    topology_summary = ?,
		    notes = ?,
		    updated_by = ?
		WHERE id = ?`,
		nullableBodyText(body, "environment_name"),
		nullableBodyText(body, "environment_type"),
		nullableBodyText(body, "project_code"),
		nullableBodyText(body, "customer_code"),
		nullableBodyText(body, "contract_code"),
		nullableBodyText(body, "status"),
		nullableBodyText(body, "dept_code"),
		nullableBodyText(body, "owner_uid"),
		nullableBodyText(body, "maintainer_uid"),
		nullableBodyText(body, "topology_summary"),
		nullableBodyText(body, "notes"),
		nullableString(operatorUID),
		id,
	)
	return err
}

func (a *Adapter) bindEnvironmentAsset(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	assetID, err := requireIDBody(body, "asset_id", "缺少 asset_id")
	if err != nil {
		return err
	}
	_, err = a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO asset_environment_assets (environment_id, asset_id, relation_type, is_primary, created_by)
			VALUES (?, ?, ?, ?, ?)`,
			id, assetID, coalesceText(body, "relation_type", "other"), boolIntFromAny(body["is_primary"]), nullableString(operatorUID),
		)
		if err != nil {
			return nil, err
		}
		if asInt(boolIntFromAny(body["is_primary"])) == 1 {
			if _, err := tx.ExecContext(ctx, `UPDATE asset_items SET environment_id = ?, updated_by = ? WHERE id = ?`, id, nullableString(operatorUID), assetID); err != nil {
				return nil, err
			}
		}
		if err := insertEvent(ctx, tx, "environment", id, "asset_bound", operatorUID, map[string]any{"summary": "环境已绑定资产", "asset_id": assetID}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	return err
}

func (a *Adapter) createProduct(ctx context.Context, body map[string]any, operatorUID string) (int64, error) {
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO product_assets (
			  product_code, product_name, product_line, customer_domain, business_domain, product_level,
			  asset_level, status, build_stage, current_version, target_version, productization_value_level,
			  supported_terminals, summary, built_at, business_owner_uid, technical_owner_uid, project_code,
			  covered_legacy_systems, notes, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			coalesceText(body, "product_code", buildCode("PROD")),
			coalesceText(body, "product_name", "未命名产品"),
			coalesceText(body, "product_line", "FC"),
			jsonStringListOrFallback(body["customer_domain"], []string{"G"}),
			coalesceText(body, "business_domain", "pending"),
			nullableBodyText(body, "product_level"),
			nullableBodyText(body, "asset_level"),
			coalesceText(body, "status", "mvp"),
			nullableBodyText(body, "build_stage"),
			nullableBodyText(body, "current_version"),
			nullableBodyText(body, "target_version"),
			nullableBodyText(body, "productization_value_level"),
			jsonStringListOrNil(body["supported_terminals"]),
			nullableBodyText(body, "summary"),
			nullableBodyText(body, "built_at"),
			nullableBodyText(body, "business_owner_uid"),
			nullableBodyText(body, "technical_owner_uid"),
			nullableBodyText(body, "project_code"),
			jsonStringListOrNil(body["covered_legacy_systems"]),
			nullableBodyText(body, "notes"),
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
		if err := insertEvent(ctx, tx, "product_asset", id, "created", operatorUID, map[string]any{"summary": "产品主档已创建"}); err != nil {
			return nil, err
		}
		return id, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) updateProduct(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	_, err := a.DB().ExecContext(ctx, `
		UPDATE product_assets
		SET product_code = COALESCE(?, product_code),
		    product_name = COALESCE(?, product_name),
		    product_line = COALESCE(?, product_line),
		    customer_domain = COALESCE(?, customer_domain),
		    business_domain = COALESCE(?, business_domain),
		    product_level = ?,
		    asset_level = ?,
		    status = COALESCE(?, status),
		    build_stage = ?,
		    current_version = ?,
		    target_version = ?,
		    productization_value_level = ?,
		    supported_terminals = ?,
		    summary = ?,
		    built_at = COALESCE(?, built_at),
		    business_owner_uid = COALESCE(?, business_owner_uid),
		    technical_owner_uid = COALESCE(?, technical_owner_uid),
		    project_code = COALESCE(?, project_code),
		    covered_legacy_systems = ?,
		    notes = ?,
		    updated_by = ?
		WHERE id = ?`,
		nullableBodyText(body, "product_code"),
		nullableBodyText(body, "product_name"),
		nullableBodyText(body, "product_line"),
		jsonStringListOrNil(body["customer_domain"]),
		nullableBodyText(body, "business_domain"),
		nullableBodyText(body, "product_level"),
		nullableBodyText(body, "asset_level"),
		nullableBodyText(body, "status"),
		nullableBodyText(body, "build_stage"),
		nullableBodyText(body, "current_version"),
		nullableBodyText(body, "target_version"),
		nullableBodyText(body, "productization_value_level"),
		jsonStringListOrNil(body["supported_terminals"]),
		nullableBodyText(body, "summary"),
		nullableBodyText(body, "built_at"),
		nullableBodyText(body, "business_owner_uid"),
		nullableBodyText(body, "technical_owner_uid"),
		nullableBodyText(body, "project_code"),
		jsonStringListOrNil(body["covered_legacy_systems"]),
		nullableBodyText(body, "notes"),
		nullableString(operatorUID),
		id,
	)
	return err
}

func (a *Adapter) linkProductBase(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	baseID, err := requireIDBody(body, "technology_base_id", "缺少 technology_base_id")
	if err != nil {
		return err
	}
	_, err = a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO product_asset_bases (product_asset_id, technology_base_id, created_by) VALUES (?, ?, ?)`,
			id, baseID, nullableString(operatorUID),
		); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "product_asset", id, "base_bound", operatorUID, map[string]any{"summary": "产品已关联技术底座", "technology_base_id": baseID}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	return err
}

func (a *Adapter) linkProductAsset(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	assetID, err := requireIDBody(body, "asset_id", "缺少 asset_id")
	if err != nil {
		return err
	}
	_, err = a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO product_asset_resources (product_asset_id, asset_id, relation_type, is_primary, created_by)
			VALUES (?, ?, ?, ?, ?)`,
			id, assetID, coalesceText(body, "relation_type", "runtime"), boolIntFromAny(body["is_primary"]), nullableString(operatorUID),
		); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "product_asset", id, "asset_bound", operatorUID, map[string]any{"summary": "产品已关联资产", "asset_id": assetID}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	return err
}

func (a *Adapter) createTechnologyBase(ctx context.Context, body map[string]any, operatorUID string) (int64, error) {
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO technology_bases (
			  base_code, base_name, base_type, status, service_targets, owner_uid,
			  technical_owner_uid, project_code, asset_level, notes, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			coalesceText(body, "base_code", buildCode("TB")),
			coalesceText(body, "base_name", "未命名底座"),
			coalesceText(body, "base_type", "platform"),
			coalesceText(body, "status", "active"),
			nullableBodyText(body, "service_targets"),
			nullableBodyText(body, "owner_uid"),
			nullableBodyText(body, "technical_owner_uid"),
			nullableBodyText(body, "project_code"),
			nullableBodyText(body, "asset_level"),
			nullableBodyText(body, "notes"),
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
		if err := insertEvent(ctx, tx, "technology_base", id, "created", operatorUID, map[string]any{"summary": "技术底座已创建"}); err != nil {
			return nil, err
		}
		return id, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) updateTechnologyBase(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	_, err := a.DB().ExecContext(ctx, `
		UPDATE technology_bases
		SET base_code = COALESCE(?, base_code),
		    base_name = COALESCE(?, base_name),
		    base_type = COALESCE(?, base_type),
		    status = COALESCE(?, status),
		    service_targets = ?,
		    owner_uid = COALESCE(?, owner_uid),
		    technical_owner_uid = COALESCE(?, technical_owner_uid),
		    project_code = COALESCE(?, project_code),
		    asset_level = ?,
		    notes = ?,
		    updated_by = ?
		WHERE id = ?`,
		nullableBodyText(body, "base_code"),
		nullableBodyText(body, "base_name"),
		nullableBodyText(body, "base_type"),
		nullableBodyText(body, "status"),
		nullableBodyText(body, "service_targets"),
		nullableBodyText(body, "owner_uid"),
		nullableBodyText(body, "technical_owner_uid"),
		nullableBodyText(body, "project_code"),
		nullableBodyText(body, "asset_level"),
		nullableBodyText(body, "notes"),
		nullableString(operatorUID),
		id,
	)
	return err
}

func (a *Adapter) createIpAsset(ctx context.Context, body map[string]any, operatorUID string) (int64, error) {
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO ip_assets (
			  ip_code, ip_name, ip_type, registration_no, right_holder, apply_date, effective_date,
			  expires_at, status, owner_uid, notes, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			coalesceText(body, "ip_code", buildCode("IP")),
			coalesceText(body, "ip_name", "未命名知识产权"),
			coalesceText(body, "ip_type", "software_copyright"),
			nullableBodyText(body, "registration_no"),
			firstText(bodyText(body, "right_holder"), "汇智云科技有限公司"),
			nullableBodyText(body, "apply_date"),
			nullableBodyText(body, "effective_date"),
			nullableBodyText(body, "expires_at"),
			coalesceText(body, "status", "active"),
			nullableBodyText(body, "owner_uid"),
			nullableBodyText(body, "notes"),
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
		if err := insertEvent(ctx, tx, "ip_asset", id, "created", operatorUID, map[string]any{"summary": "知识产权资产已创建"}); err != nil {
			return nil, err
		}
		return id, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) updateIpAsset(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	_, err := a.DB().ExecContext(ctx, `
		UPDATE ip_assets
		SET ip_name = COALESCE(?, ip_name),
		    ip_type = COALESCE(?, ip_type),
		    registration_no = ?,
		    right_holder = ?,
		    apply_date = ?,
		    effective_date = ?,
		    expires_at = ?,
		    status = COALESCE(?, status),
		    owner_uid = ?,
		    notes = ?,
		    updated_by = ?
		WHERE id = ?`,
		nullableBodyText(body, "ip_name"),
		nullableBodyText(body, "ip_type"),
		nullableBodyText(body, "registration_no"),
		nullableBodyText(body, "right_holder"),
		nullableBodyText(body, "apply_date"),
		nullableBodyText(body, "effective_date"),
		nullableBodyText(body, "expires_at"),
		nullableBodyText(body, "status"),
		nullableBodyText(body, "owner_uid"),
		nullableBodyText(body, "notes"),
		nullableString(operatorUID),
		id,
	)
	return err
}

func (a *Adapter) linkIpAssetProduct(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	productID, err := requireIDBody(body, "product_asset_id", "缺少 product_asset_id")
	if err != nil {
		return err
	}
	_, err = a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO ip_asset_products (ip_asset_id, product_asset_id, created_by) VALUES (?, ?, ?)`,
			id, productID, nullableString(operatorUID),
		); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "ip_asset", id, "product_bound", operatorUID, map[string]any{"summary": "知识产权已关联产品", "product_asset_id": productID}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	return err
}

func (a *Adapter) createDigitalAsset(ctx context.Context, body map[string]any, operatorUID string) (int64, error) {
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO digital_assets (
			  digital_code, digital_name, digital_type, storage_location, owner_uid, access_scope,
			  project_code, environment_id, status, notes, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			coalesceText(body, "digital_code", buildCode("DA")),
			coalesceText(body, "digital_name", "未命名数字资产"),
			coalesceText(body, "digital_type", "document"),
			nullableBodyText(body, "storage_location"),
			nullableBodyText(body, "owner_uid"),
			coalesceText(body, "access_scope", "project"),
			nullableBodyText(body, "project_code"),
			nullableBodyInt64(body, "environment_id"),
			coalesceText(body, "status", "active"),
			nullableBodyText(body, "notes"),
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
		if err := insertEvent(ctx, tx, "digital_asset", id, "created", operatorUID, map[string]any{"summary": "数字资产已创建"}); err != nil {
			return nil, err
		}
		return id, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) updateDigitalAsset(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	_, err := a.DB().ExecContext(ctx, `
		UPDATE digital_assets
		SET digital_name = COALESCE(?, digital_name),
		    digital_type = COALESCE(?, digital_type),
		    storage_location = ?,
		    owner_uid = ?,
		    access_scope = COALESCE(?, access_scope),
		    project_code = ?,
		    environment_id = ?,
		    status = COALESCE(?, status),
		    notes = ?,
		    updated_by = ?
		WHERE id = ?`,
		nullableBodyText(body, "digital_name"),
		nullableBodyText(body, "digital_type"),
		nullableBodyText(body, "storage_location"),
		nullableBodyText(body, "owner_uid"),
		nullableBodyText(body, "access_scope"),
		nullableBodyText(body, "project_code"),
		nullableBodyInt64(body, "environment_id"),
		nullableBodyText(body, "status"),
		nullableBodyText(body, "notes"),
		nullableString(operatorUID),
		id,
	)
	return err
}

func (a *Adapter) linkDigitalAssetProduct(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	productID, err := requireIDBody(body, "product_asset_id", "缺少 product_asset_id")
	if err != nil {
		return err
	}
	_, err = a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO digital_asset_products (digital_asset_id, product_asset_id, created_by) VALUES (?, ?, ?)`,
			id, productID, nullableString(operatorUID),
		); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "digital_asset", id, "product_bound", operatorUID, map[string]any{"summary": "数字资产已关联产品", "product_asset_id": productID}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	return err
}

func (a *Adapter) createDelivery(ctx context.Context, body map[string]any, operatorUID string) (int64, error) {
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO asset_delivery_views (
			  delivery_code, delivery_name, customer_code, contract_code, project_code, status, owner_uid,
			  go_live_at, accepted_at, notes, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			coalesceText(body, "delivery_code", buildCode("DLV")),
			coalesceText(body, "delivery_name", firstText(bodyText(body, "delivery_code"), "未命名交付视图")),
			coalesceText(body, "customer_code", "UNKNOWN"),
			nullableBodyText(body, "contract_code"),
			coalesceText(body, "project_code", "UNKNOWN"),
			coalesceText(body, "status", "preparing"),
			nullableBodyText(body, "owner_uid"),
			nullableBodyText(body, "go_live_at"),
			nullableBodyText(body, "accepted_at"),
			nullableBodyText(body, "notes"),
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
		if err := insertEvent(ctx, tx, "delivery_view", id, "created", operatorUID, map[string]any{"summary": "交付视图已创建"}); err != nil {
			return nil, err
		}
		return id, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) updateDelivery(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	_, err := a.DB().ExecContext(ctx, `
		UPDATE asset_delivery_views
		SET delivery_name = COALESCE(?, delivery_name),
		    customer_code = COALESCE(?, customer_code),
		    contract_code = ?,
		    project_code = COALESCE(?, project_code),
		    status = COALESCE(?, status),
		    owner_uid = ?,
		    go_live_at = ?,
		    accepted_at = ?,
		    notes = ?,
		    updated_by = ?
		WHERE id = ?`,
		nullableBodyText(body, "delivery_name"),
		nullableBodyText(body, "customer_code"),
		nullableBodyText(body, "contract_code"),
		nullableBodyText(body, "project_code"),
		nullableBodyText(body, "status"),
		nullableBodyText(body, "owner_uid"),
		nullableBodyText(body, "go_live_at"),
		nullableBodyText(body, "accepted_at"),
		nullableBodyText(body, "notes"),
		nullableString(operatorUID),
		id,
	)
	return err
}

func (a *Adapter) linkDeliveryProduct(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	productID, err := requireIDBody(body, "product_asset_id", "缺少 product_asset_id")
	if err != nil {
		return err
	}
	_, err = a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO asset_delivery_products (delivery_view_id, product_asset_id, relation_type, created_by)
			VALUES (?, ?, ?, ?)`,
			id, productID, coalesceText(body, "relation_type", "delivered_product"), nullableString(operatorUID),
		); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "delivery_view", id, "product_bound", operatorUID, map[string]any{"summary": "交付视图已关联产品", "product_asset_id": productID}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	return err
}

func (a *Adapter) linkDeliveryEnvironment(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	environmentID, err := requireIDBody(body, "environment_id", "缺少 environment_id")
	if err != nil {
		return err
	}
	_, err = a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO asset_delivery_environments (delivery_view_id, environment_id, relation_type)
			VALUES (?, ?, ?)`,
			id, environmentID, coalesceText(body, "relation_type", "primary"),
		); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "delivery_view", id, "environment_bound", operatorUID, map[string]any{"summary": "交付视图已关联环境", "environment_id": environmentID}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	return err
}

func (a *Adapter) createSupplier(ctx context.Context, body map[string]any, operatorUID string) (int64, error) {
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO suppliers (
			  supplier_code, supplier_name, credit_code, supplier_type, contact_name, contact_phone,
			  contact_email, invoice_info, status, notes, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			coalesceText(body, "supplier_code", buildCode("SUP")),
			coalesceText(body, "supplier_name", "未命名供应商"),
			nullableBodyText(body, "credit_code"),
			coalesceText(body, "supplier_type", "service"),
			nullableBodyText(body, "contact_name"),
			nullableBodyText(body, "contact_phone"),
			nullableBodyText(body, "contact_email"),
			nullableBodyText(body, "invoice_info"),
			coalesceText(body, "status", "active"),
			nullableBodyText(body, "notes"),
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
		if err := insertEvent(ctx, tx, "supplier", id, "created", operatorUID, map[string]any{"summary": "供应商已创建"}); err != nil {
			return nil, err
		}
		return id, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) updateSupplier(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	_, err := a.DB().ExecContext(ctx, `
		UPDATE suppliers
		SET supplier_name = COALESCE(?, supplier_name),
		    credit_code = ?,
		    supplier_type = COALESCE(?, supplier_type),
		    contact_name = ?,
		    contact_phone = ?,
		    contact_email = ?,
		    invoice_info = ?,
		    status = COALESCE(?, status),
		    notes = ?,
		    updated_by = ?
		WHERE id = ?`,
		nullableBodyText(body, "supplier_name"),
		nullableBodyText(body, "credit_code"),
		nullableBodyText(body, "supplier_type"),
		nullableBodyText(body, "contact_name"),
		nullableBodyText(body, "contact_phone"),
		nullableBodyText(body, "contact_email"),
		nullableBodyText(body, "invoice_info"),
		nullableBodyText(body, "status"),
		nullableBodyText(body, "notes"),
		nullableString(operatorUID),
		id,
	)
	return err
}

func (a *Adapter) createPurchaseOrder(ctx context.Context, body map[string]any, operatorUID string) (int64, error) {
	purposeType := coalesceText(body, "purpose_type", "self_use")
	if err := assertProjectPurpose(purposeType, bodyText(body, "project_code"), "采购单"); err != nil {
		return 0, err
	}
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO purchase_orders (
			  order_no, purchase_type, purpose_type, applicant_uid, applicant_dept_code, project_code, customer_code,
			  contract_code, environment_id, supplier_id, budget_amount, actual_amount, status, workflow_instance_id,
			  reason, attachments
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			coalesceText(body, "order_no", buildCode("PO")),
			coalesceText(body, "purchase_type", "physical"),
			purposeType,
			firstText(bodyText(body, "applicant_uid"), operatorUID, "system"),
			coalesceText(body, "applicant_dept_code", "UNKNOWN"),
			nullableBodyText(body, "project_code"),
			nullableBodyText(body, "customer_code"),
			nullableBodyText(body, "contract_code"),
			nullableBodyInt64(body, "environment_id"),
			nullableBodyInt64(body, "supplier_id"),
			float64FromAny(body["budget_amount"]),
			nullableBodyFloat(body, "actual_amount"),
			coalesceText(body, "status", "draft"),
			nullableBodyText(body, "workflow_instance_id"),
			nullableBodyText(body, "reason"),
			jsonOrNil(body["attachments"]),
		)
		if err != nil {
			return nil, err
		}
		id, err := insert.LastInsertId()
		if err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "purchase_order", id, "created", operatorUID, map[string]any{"summary": "采购单已创建"}); err != nil {
			return nil, err
		}
		return id, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) updatePurchaseOrder(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	_ = operatorUID
	if err := assertProjectPurpose(bodyText(body, "purpose_type"), bodyText(body, "project_code"), "采购单"); err != nil {
		return err
	}
	_, err := a.DB().ExecContext(ctx, `
		UPDATE purchase_orders
		SET purchase_type = COALESCE(?, purchase_type),
		    purpose_type = COALESCE(?, purpose_type),
		    applicant_uid = COALESCE(?, applicant_uid),
		    applicant_dept_code = COALESCE(?, applicant_dept_code),
		    project_code = ?,
		    customer_code = ?,
		    contract_code = ?,
		    environment_id = ?,
		    supplier_id = ?,
		    budget_amount = COALESCE(?, budget_amount),
		    actual_amount = ?,
		    status = COALESCE(?, status),
		    workflow_instance_id = ?,
		    reason = ?,
		    attachments = COALESCE(?, attachments),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?`,
		nullableBodyText(body, "purchase_type"),
		nullableBodyText(body, "purpose_type"),
		nullableBodyText(body, "applicant_uid"),
		nullableBodyText(body, "applicant_dept_code"),
		nullableBodyText(body, "project_code"),
		nullableBodyText(body, "customer_code"),
		nullableBodyText(body, "contract_code"),
		nullableBodyInt64(body, "environment_id"),
		nullableBodyInt64(body, "supplier_id"),
		nullableBodyFloat(body, "budget_amount"),
		nullableBodyFloat(body, "actual_amount"),
		nullableBodyText(body, "status"),
		nullableBodyText(body, "workflow_instance_id"),
		nullableBodyText(body, "reason"),
		jsonOrNil(body["attachments"]),
		id,
	)
	return err
}

func (a *Adapter) syncPurchaseOrderBudget(ctx context.Context, tx *sql.Tx, purchaseOrderID int64) error {
	var total sql.NullFloat64
	if err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(SUM(total_price), 0) AS total FROM purchase_order_items WHERE purchase_order_id = ?`,
		purchaseOrderID,
	).Scan(&total); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE purchase_orders SET budget_amount = ? WHERE id = ?`, total.Float64, purchaseOrderID)
	return err
}

func (a *Adapter) createPurchaseOrderItem(ctx context.Context, purchaseOrderID int64, body map[string]any, operatorUID string) (int64, error) {
	itemName := bodyText(body, "item_name")
	if itemName == "" {
		return 0, httperror.New(http.StatusBadRequest, "missing_item_name", "缺少 item_name")
	}
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		var nextLine sql.NullInt64
		if err := tx.QueryRowContext(ctx,
			`SELECT COALESCE(MAX(line_no), 0) + 1 AS next_line_no FROM purchase_order_items WHERE purchase_order_id = ?`,
			purchaseOrderID,
		).Scan(&nextLine); err != nil {
			return nil, err
		}
		lineNo := bodyInt64(body, "line_no")
		if lineNo == 0 {
			lineNo = nextLine.Int64
		}
		quantity := float64FromAny(body["quantity"])
		if quantity == 0 {
			quantity = 1
		}
		var unitPrice any = nil
		if _, ok := body["unit_price"]; ok && body["unit_price"] != nil {
			unitPrice = float64FromAny(body["unit_price"])
		}
		totalPrice := float64FromAny(body["total_price"])
		if _, ok := body["total_price"]; !ok {
			if unitPrice != nil {
				totalPrice = quantity * unitPrice.(float64)
			}
		}
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO purchase_order_items (
			  purchase_order_id, line_no, asset_category, asset_subtype, item_name, specification, quantity, unit,
			  unit_price, total_price, effective_at, expires_at, target_type, target_ref, remark
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			purchaseOrderID,
			lineNo,
			coalesceText(body, "asset_category", "physical"),
			coalesceText(body, "asset_subtype", "未分类"),
			itemName,
			nullableBodyText(body, "specification"),
			quantity,
			nullableBodyText(body, "unit"),
			unitPrice,
			totalPrice,
			nullableBodyText(body, "effective_at"),
			nullableBodyText(body, "expires_at"),
			coalesceText(body, "target_type", "none"),
			nullableBodyText(body, "target_ref"),
			nullableBodyText(body, "remark"),
		)
		if err != nil {
			return nil, err
		}
		itemID, err := insert.LastInsertId()
		if err != nil {
			return nil, err
		}
		if err := a.syncPurchaseOrderBudget(ctx, tx, purchaseOrderID); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "purchase_order", purchaseOrderID, "item_added", operatorUID, map[string]any{
			"summary":                "采购明细已新增",
			"purchase_order_item_id": itemID,
			"item_name":              itemName,
		}); err != nil {
			return nil, err
		}
		return itemID, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) updatePurchaseOrderItem(ctx context.Context, purchaseOrderID int64, itemID int64, body map[string]any, operatorUID string) error {
	_, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		row, err := a.queryRowMap(ctx,
			`SELECT id, quantity, unit_price, total_price FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?`,
			itemID, purchaseOrderID,
		)
		if err != nil {
			return nil, err
		}
		if row == nil {
			return nil, notFound("采购明细不存在")
		}
		quantity := asFloat(row["quantity"])
		if _, ok := body["quantity"]; ok {
			quantity = float64FromAny(body["quantity"])
		}
		var unitPrice any = nil
		if row["unit_price"] != nil {
			unitPrice = asFloat(row["unit_price"])
		}
		if _, ok := body["unit_price"]; ok {
			if body["unit_price"] == nil {
				unitPrice = nil
			} else {
				unitPrice = float64FromAny(body["unit_price"])
			}
		}
		totalPrice := asFloat(row["total_price"])
		if _, ok := body["total_price"]; ok {
			totalPrice = float64FromAny(body["total_price"])
		} else if _, hasQuantity := body["quantity"]; hasQuantity {
			if unitPrice != nil {
				totalPrice = quantity * unitPrice.(float64)
			} else {
				totalPrice = 0
			}
		} else if _, hasUnitPrice := body["unit_price"]; hasUnitPrice {
			if unitPrice != nil {
				totalPrice = quantity * unitPrice.(float64)
			} else {
				totalPrice = 0
			}
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE purchase_order_items
			SET line_no = COALESCE(?, line_no),
			    asset_category = COALESCE(?, asset_category),
			    asset_subtype = COALESCE(?, asset_subtype),
			    item_name = COALESCE(?, item_name),
			    specification = ?,
			    quantity = ?,
			    unit = ?,
			    unit_price = ?,
			    total_price = ?,
			    effective_at = ?,
			    expires_at = ?,
			    target_type = COALESCE(?, target_type),
			    target_ref = ?,
			    remark = ?
			WHERE id = ? AND purchase_order_id = ?`,
			nullableBodyInt64(body, "line_no"),
			nullableBodyText(body, "asset_category"),
			nullableBodyText(body, "asset_subtype"),
			nullableBodyText(body, "item_name"),
			nullableBodyText(body, "specification"),
			quantity,
			nullableBodyText(body, "unit"),
			unitPrice,
			totalPrice,
			nullableBodyText(body, "effective_at"),
			nullableBodyText(body, "expires_at"),
			nullableBodyText(body, "target_type"),
			nullableBodyText(body, "target_ref"),
			nullableBodyText(body, "remark"),
			itemID,
			purchaseOrderID,
		); err != nil {
			return nil, err
		}
		if err := a.syncPurchaseOrderBudget(ctx, tx, purchaseOrderID); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "purchase_order", purchaseOrderID, "item_updated", operatorUID, map[string]any{
			"summary":                "采购明细已更新",
			"purchase_order_item_id": itemID,
		}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	return err
}

func (a *Adapter) submitPurchaseOrder(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	_, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		if _, err := tx.ExecContext(ctx, `
			UPDATE purchase_orders
			SET status = 'pending_approval',
			    workflow_instance_id = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`,
			nullableBodyText(body, "workflow_instance_id"), id,
		); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "purchase_order", id, "submitted", operatorUID, map[string]any{"summary": "采购单已提交审批"}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	return err
}

func (a *Adapter) syncPurchaseOrderWorkflow(ctx context.Context, id int64, body map[string]any, operatorUID string) (map[string]any, error) {
	workflowStatus := firstText(bodyText(body, "workflowStatus"), bodyText(body, "workflow_status"), bodyText(body, "status"))
	nextStatus := purchaseOrderStatusFromWorkflow(workflowStatus)
	if nextStatus == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_workflow_status", "不支持的审批状态")
	}
	_, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		result, err := tx.ExecContext(ctx, `
			UPDATE purchase_orders
			SET status = ?,
			    workflow_instance_id = COALESCE(?, workflow_instance_id),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`,
			nextStatus,
			nullableString(firstText(bodyText(body, "workflowInstanceId"), bodyText(body, "workflow_instance_id"), bodyText(body, "instanceNo"), bodyText(body, "instance_no"))),
			id,
		)
		if err != nil {
			return nil, err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		if affected == 0 {
			return nil, notFound("采购单不存在")
		}
		if err := insertEvent(ctx, tx, "purchase_order", id, "workflow_synced", operatorUID, map[string]any{
			"summary":         "采购单审批状态已同步",
			"workflow_status": workflowStatus,
			"status":          nextStatus,
		}); err != nil {
			return nil, err
		}
		return nil, nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "status": nextStatus}, nil
}

func purchaseOrderStatusFromWorkflow(workflowStatus string) string {
	switch strings.ToLower(strings.TrimSpace(workflowStatus)) {
	case "approved", "pass", "passed", "completed", "success":
		return "approved"
	case "rejected", "reject":
		return "rejected"
	case "cancelled", "canceled":
		return "closed"
	default:
		return ""
	}
}

func (a *Adapter) createReceipt(ctx context.Context, purchaseOrderID int64, body map[string]any, operatorUID string) (int64, error) {
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		status := coalesceText(body, "status", "draft")
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO asset_receipts (
			  receipt_no, purchase_order_id, receipt_type, status, operator_uid, processed_at, note
			) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			coalesceText(body, "receipt_no", buildCode("RC")),
			purchaseOrderID,
			coalesceText(body, "receipt_type", "resource_registration"),
			status,
			nullableString(operatorUID),
			nullableBodyText(body, "processed_at"),
			nullableBodyText(body, "note"),
		)
		if err != nil {
			return nil, err
		}
		receiptID, err := insert.LastInsertId()
		if err != nil {
			return nil, err
		}
		nextStatus := "received"
		if status == "processed" {
			nextStatus = "stocked"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE purchase_orders SET status = ? WHERE id = ?`, nextStatus, purchaseOrderID); err != nil {
			return nil, err
		}
		if err := insertEvent(ctx, tx, "purchase_order", purchaseOrderID, "receipt_created", operatorUID, map[string]any{"summary": "入库/激活记录已创建", "receipt_id": receiptID}); err != nil {
			return nil, err
		}
		return receiptID, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) createAssignment(ctx context.Context, body map[string]any, operatorUID string) (int64, error) {
	assetID, err := requireIDBody(body, "asset_id", "缺少 asset_id")
	if err != nil {
		return 0, err
	}
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		var assetCategory string
		if err := tx.QueryRowContext(ctx, `SELECT asset_category FROM asset_items WHERE id = ? LIMIT 1`, assetID).Scan(&assetCategory); err != nil {
			if err == sql.ErrNoRows {
				return nil, notFound("资产不存在")
			}
			return nil, err
		}
		actionType := coalesceText(body, "action_type", "assign")
		targetType := coalesceText(body, "target_type", "none")
		targetRef := bodyText(body, "target_ref")
		if (actionType == "assign" || actionType == "claim" || actionType == "transfer") && targetType == "none" {
			return nil, httperror.New(http.StatusBadRequest, "target_type_required", "该操作必须指定目标类型")
		}
		if targetType != "none" && targetRef == "" {
			return nil, httperror.New(http.StatusBadRequest, "target_ref_required", "缺少 target_ref")
		}
		status := bodyText(body, "status")
		if status == "" {
			status = "pending"
		}
		insert, err := tx.ExecContext(ctx, `
			INSERT INTO asset_assignments (
			  assignment_no, asset_id, action_type, source_type, source_ref, target_type, target_ref, quantity,
			  status, workflow_instance_id, requested_by, approved_by, effective_at, ended_at, note
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			coalesceText(body, "assignment_no", buildCode("OP")),
			assetID,
			actionType,
			coalesceText(body, "source_type", "stock"),
			nullableBodyText(body, "source_ref"),
			targetType,
			nullableString(targetRef),
			nullableBodyFloat(body, "quantity"),
			status,
			nullableBodyText(body, "workflow_instance_id"),
			nullableString(operatorUID),
			nullableBodyText(body, "approved_by"),
			nullableBodyText(body, "effective_at"),
			nullableBodyText(body, "ended_at"),
			nullableBodyText(body, "note"),
		)
		if err != nil {
			return nil, err
		}
		assignmentID, err := insert.LastInsertId()
		if err != nil {
			return nil, err
		}

		if assignmentStatusApplies(status) {
			if err := applyAssignmentEffect(ctx, tx, assetID, assetCategory, actionType, targetType, targetRef, operatorUID); err != nil {
				return nil, err
			}
		}
		if err := insertEvent(ctx, tx, "assignment", assignmentID, actionType, operatorUID, map[string]any{"summary": "资产操作记录已创建", "asset_id": assetID}); err != nil {
			return nil, err
		}
		return assignmentID, nil
	})
	if err != nil {
		return 0, err
	}
	return result.(int64), nil
}

func (a *Adapter) syncAssignmentWorkflow(ctx context.Context, id int64, body map[string]any, operatorUID string) (map[string]any, error) {
	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		row, err := queryAssignmentForUpdate(ctx, tx, id)
		if err != nil {
			return nil, err
		}
		if row == nil {
			return nil, notFound("资产操作记录不存在")
		}
		workflowStatus := firstText(bodyText(body, "workflowStatus"), bodyText(body, "workflow_status"), bodyText(body, "status"))
		nextStatus := assignmentStatusFromWorkflow(workflowStatus, cleanAnyString(row["action_type"]))
		if nextStatus == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_workflow_status", "不支持的审批状态")
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE asset_assignments
			SET status = ?,
			    workflow_instance_id = COALESCE(?, workflow_instance_id),
			    approved_by = COALESCE(?, approved_by),
			    effective_at = CASE WHEN ? IN ('active', 'completed', 'returned', 'released') THEN COALESCE(effective_at, CURRENT_TIMESTAMP) ELSE effective_at END,
			    ended_at = CASE WHEN ? IN ('returned', 'released', 'completed', 'cancelled') THEN COALESCE(ended_at, CURRENT_TIMESTAMP) ELSE ended_at END
			WHERE id = ?`,
			nextStatus,
			nullableString(firstText(bodyText(body, "workflowInstanceId"), bodyText(body, "workflow_instance_id"), bodyText(body, "instanceNo"), bodyText(body, "instance_no"))),
			nullableString(firstText(bodyText(body, "approvedBy"), bodyText(body, "approved_by"), operatorUID)),
			nextStatus,
			nextStatus,
			id,
		); err != nil {
			return nil, err
		}
		if assignmentStatusApplies(nextStatus) {
			if err := applyAssignmentEffect(
				ctx,
				tx,
				asInt(row["asset_id"]),
				cleanAnyString(row["asset_category"]),
				cleanAnyString(row["action_type"]),
				cleanAnyString(row["target_type"]),
				cleanAnyString(row["target_ref"]),
				operatorUID,
			); err != nil {
				return nil, err
			}
		}
		if err := insertEvent(ctx, tx, "assignment", id, "workflow_synced", operatorUID, map[string]any{
			"summary":         "资产操作审批状态已同步",
			"workflow_status": workflowStatus,
			"status":          nextStatus,
		}); err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "status": nextStatus}, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(map[string]any), nil
}

func queryAssignmentForUpdate(ctx context.Context, tx *sql.Tx, id int64) (map[string]any, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT assignment.id, assignment.asset_id, assignment.action_type, assignment.target_type, assignment.target_ref,
		       assignment.status, asset.asset_category
		FROM asset_assignments assignment
		INNER JOIN asset_items asset ON asset.id = assignment.asset_id
		WHERE assignment.id = ?
		LIMIT 1
		FOR UPDATE`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, nil
	}
	return items[0], nil
}

func assignmentStatusApplies(status string) bool {
	switch status {
	case "active", "completed", "returned", "released":
		return true
	default:
		return false
	}
}

func assignmentStatusFromWorkflow(workflowStatus string, actionType string) string {
	switch strings.ToLower(strings.TrimSpace(workflowStatus)) {
	case "approved", "pass", "passed", "completed", "success":
		switch actionType {
		case "return":
			return "returned"
		case "release":
			return "released"
		case "scrap", "repair", "renew", "revoke_access", "rotate_secret":
			return "completed"
		default:
			return "active"
		}
	case "rejected", "reject", "cancelled", "canceled":
		return "cancelled"
	default:
		return ""
	}
}

func applyAssignmentEffect(ctx context.Context, tx *sql.Tx, assetID int64, assetCategory string, actionType string, targetType string, targetRef string, operatorUID string) error {
	if targetType == "user" && targetRef != "" && (actionType == "assign" || actionType == "claim" || actionType == "transfer") {
		if _, err := tx.ExecContext(ctx, `UPDATE asset_items SET user_uid = ?, updated_by = ? WHERE id = ?`, targetRef, nullableString(operatorUID), assetID); err != nil {
			return err
		}
	}
	if (actionType == "assign" || actionType == "claim" || actionType == "transfer") && assetCategory == "physical" {
		if _, err := tx.ExecContext(ctx, `UPDATE asset_items SET status = 'in_use', updated_by = ? WHERE id = ?`, nullableString(operatorUID), assetID); err != nil {
			return err
		}
	}
	if actionType == "return" || actionType == "release" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE asset_items
			SET user_uid = NULL,
			    status = CASE WHEN ? = 'physical' THEN 'in_stock' ELSE status END,
			    updated_by = ?
			WHERE id = ?`,
			assetCategory, nullableString(operatorUID), assetID,
		); err != nil {
			return err
		}
	}
	if actionType == "scrap" {
		if _, err := tx.ExecContext(ctx, `
			UPDATE asset_items
			SET user_uid = NULL,
			    status = CASE WHEN ? = 'physical' THEN 'scrapped' ELSE 'inactive' END,
			    updated_by = ?
			WHERE id = ?`,
			assetCategory, nullableString(operatorUID), assetID,
		); err != nil {
			return err
		}
	}
	if actionType == "renew" && assetCategory == "resource" {
		if _, err := tx.ExecContext(ctx, `UPDATE asset_items SET status = 'active', updated_by = ? WHERE id = ?`, nullableString(operatorUID), assetID); err != nil {
			return err
		}
	}
	return nil
}

func (a *Adapter) handleAlert(ctx context.Context, id int64, body map[string]any, operatorUID string) error {
	_, err := a.DB().ExecContext(ctx, `
		UPDATE asset_alerts
		SET status = COALESCE(?, status),
		    resolution = ?,
		    next_remind_at = ?,
		    handled_by = ?,
		    handled_at = CURRENT_TIMESTAMP
		WHERE id = ?`,
		nullableBodyText(body, "status"),
		nullableBodyText(body, "resolution"),
		nullableBodyText(body, "next_remind_at"),
		nullableString(operatorUID),
		id,
	)
	return err
}
