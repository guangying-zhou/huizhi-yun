package unified

import "context"

func inspectReceiptTargets(ctx context.Context, q querier, domain, schema string) ([]MigrationConflict, error) {
	rows, err := q.QueryContext(ctx, "SELECT receipt_id,operation_code,target_biz_type,target_biz_code,original_actor_uid,idempotency_key FROM "+qualified(schema, "service_command_receipt")+" WHERE status='succeeded' ORDER BY receipt_id")
	if err != nil {
		return nil, err
	}
	type target struct{ id, operation, kind, code, actor, key string }
	targets := []target{}
	for rows.Next() {
		var t target
		var kind, code *string
		var operation *string
		var actor, key *string
		if err = rows.Scan(&t.id, &operation, &kind, &code, &actor, &key); err != nil {
			rows.Close()
			return nil, err
		}
		if kind != nil {
			t.kind = *kind
		}
		if operation != nil {
			t.operation = *operation
		}
		if actor != nil {
			t.actor = *actor
		}
		if key != nil {
			t.key = *key
		}
		if code != nil {
			t.code = *code
		}
		targets = append(targets, t)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	issues := []MigrationConflict{}
	for _, t := range targets {
		table, condition := "", ""
		registered := map[string]string{
			"enterprise.aims.work-items.complete.v1":          "aims:work_item_completion_request",
			"enterprise.aims.work-items.completion-replay.v1": "aims:work_item_completion_request",
			"enterprise.aims.project-members.remove.v1":       "aims:project_member",
			"enterprise.aims.projects.create.v1":              "aims:project", "enterprise.aims.projects.update.v1": "aims:project", "altoc.contract-activation.aims-project.v1": "aims:project", "altoc.contract-activation.aims-milestones.v1": "aims:project_milestones", "enterprise.aims.project-members.add.v1": "aims:project_member", "enterprise.aims.project-members.role.v1": "aims:project_member", "altoc.service-ticket.aims-work-item.v1": "aims:work_item", "altoc.aims.product-request.create-from-feedback.v1": "aims:product_request",
			"assets.products.create.v1": "assets:product_asset", "assets.products.edit.v1": "assets:product_asset", "assets.products.link-base.v1": "assets:product_asset", "assets.products.link-asset.v1": "assets:product_asset", "assets.products.link-document.v1": "assets:product_asset", "assets.product-categories.save.v1": "assets:asset_category_group", "people.offboarding.assets-recovery-sync.v1": "assets:offboarding_recovery_case",
		}
		if registered[t.operation] != domain+":"+t.kind {
			kind := "receipt_target_contract_unknown"
			issues = append(issues, MigrationConflict{Kind: kind, Source: domain + ".service_command_receipt", KeySHA256: redactedBusinessKey(kind, t.id), RowCount: 1})
			continue
		}
		switch domain + ":" + t.kind {
		case "aims:work_item_completion_request":
			table = "work_item_completion_requests"
			condition = "CAST(id AS CHAR)=?"
		case "aims:project", "aims:project_milestones":
			table = "aims_projects"
			condition = "BINARY project_code=BINARY ? OR CAST(id AS CHAR)=?"
		case "aims:project_member":
			// Remove receipts require the new append-only audit/tombstone contract;
			// absence of the current member is expected and is not proof of loss.
			if t.operation == "enterprise.aims.project-members.remove.v1" {
				table = "project_activity_logs"
				condition = "object_type='member' AND action='remove' AND CONCAT(project_id,':',object_code)=? AND BINARY actor_uid=BINARY ? AND BINARY request_id=BINARY ? AND JSON_VALID(changes)=1 AND CAST(JSON_UNQUOTE(JSON_EXTRACT(changes,'$.projectId')) AS UNSIGNED)=project_id AND BINARY JSON_UNQUOTE(JSON_EXTRACT(changes,'$.uid'))=BINARY object_code AND JSON_UNQUOTE(JSON_EXTRACT(changes,'$.action'))='remove' AND EXISTS (SELECT 1 FROM " + qualified(schema, "aims_projects") + " p WHERE p.id=project_id)"
			} else {
				table = "aims_project_members"
				condition = "CONCAT(project_id,':',uid)=?"
			}
		case "aims:work_item":
			table = "work_items"
			condition = "BINARY item_key=BINARY ?"
		case "aims:product_request":
			table = "product_requests"
			condition = "BINARY biz_id=BINARY ?"
		case "assets:product_asset":
			table = "product_assets"
			condition = "CAST(id AS CHAR)=?"
		case "assets:asset_category_group":
			table = "asset_category_groups"
			condition = "CAST(id AS CHAR)=?"
		case "assets:offboarding_recovery_case":
			table = "asset_offboarding_recovery_cases"
			condition = "BINARY case_code=BINARY ?"
		}
		kind := "receipt_target_contract_unknown"
		if table != "" {
			ok, e := tableInPlanSchema(ctx, q, schema, table)
			if e != nil {
				return nil, e
			}
			if ok {
				args := []any{t.code}
				if t.operation == "enterprise.aims.project-members.remove.v1" {
					args = append(args, t.actor, t.key)
				}
				if t.kind == "project" || t.kind == "project_milestones" {
					args = append(args, t.code)
				}
				r, e := q.QueryContext(ctx, "SELECT 1 FROM "+qualified(schema, table)+" WHERE "+condition+" LIMIT 1", args...)
				if e != nil {
					return nil, e
				}
				exists := r.Next()
				e = r.Err()
				r.Close()
				if e != nil {
					return nil, e
				}
				if exists {
					continue
				}
				kind = "receipt_target_object_missing"
			}
		}
		issues = append(issues, MigrationConflict{Kind: kind, Source: domain + ".service_command_receipt", KeySHA256: redactedBusinessKey(kind, t.id), RowCount: 1})
	}
	return issues, nil
}
