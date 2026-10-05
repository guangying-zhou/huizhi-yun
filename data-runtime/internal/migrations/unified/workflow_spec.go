package unified

import (
	"bytes"
	"encoding/json"
	"errors"
)

// Closed source set freezes Workflow through migrations 012, 013 and 014.
// Parameters are optional in the source (template-only), never mapped as the
// Assets logical name. Foreign keys and indexes are rewritten by the existing
// shadow-copy engine; no live activated domain is installed by this function.
var workflowSourceTables = []string{"flow_schemas", "form_schemas", "flow_action_defs", "flow_routes", "flow_instances", "flow_tasks", "flow_actions", "flow_actionable_outbox", "flow_notification_outbox", "flow_callback_logs", "flow_delivery_audit", "service_command_receipt"}

func validateWorkflowClosure(tables []Table) error {
	have := map[string]bool{}
	for _, t := range tables {
		if have[t.Name] {
			return errors.New("duplicate Workflow source table")
		}
		have[t.Name] = true
	}
	for _, name := range workflowSourceTables {
		if !have[name] {
			return errors.New("Workflow source closure incomplete")
		}
		delete(have, name)
	}
	delete(have, "system_parameters")
	if len(have) != 0 {
		return errors.New("unreviewed Workflow source table")
	}
	return nil
}

// WorkflowMapping builds the opt-in Registry mapping from a reviewed plan.
func WorkflowMapping(p Plan) (map[string]string, error) {
	var tables []Table
	for _, t := range p.Tables {
		if t.Domain == "workflow" {
			tables = append(tables, t)
		}
	}
	if err := validateWorkflowClosure(tables); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, t := range tables {
		if t.Target != "workflow_"+t.Name {
			return nil, errors.New("Workflow physical name mismatch")
		}
		logical := t.Name
		if logical == "system_parameters" {
			logical = "workflow_system_parameters"
		}
		out[logical] = t.Target
	}
	return out, nil
}

// Workflow migration preserves primary IDs and every JSON byte through the
// copy/count/hash engine; these are frozen snapshots, not newly trusted actor
// or deployment inputs. Unknown JSON columns still block the reviewed plan.
// Their interpretation remains with Workflow's existing business validators.
func init() {
	for identity, kind := range map[string]byte{
		"workflow.flow_schemas.nodes": '[', "workflow.flow_schemas.config": '{',
		"workflow.form_schemas.fields": '[', "workflow.flow_routes.conditions": '{',
		"workflow.flow_instances.biz_context": '{', "workflow.flow_instances.form_data": '{', "workflow.flow_instances.attachments": '[', "workflow.flow_instances.flow_snapshot": '{',
		"workflow.flow_actionable_outbox.recipients": '[', "workflow.flow_actionable_outbox.prerequisite_notifications": '[',
		"workflow.flow_notification_outbox.notification": '{', "workflow.flow_callback_logs.payload": '{',
		"workflow.flow_actions.attachments": '[',
	} {
		expected := kind
		registeredJSONFields[identity] = true
		valueOnlyJSONFields[identity] = func(raw json.RawMessage) bool {
			raw = bytes.TrimSpace(raw)
			return json.Valid(raw) && (bytes.Equal(raw, []byte("null")) || (len(raw) > 0 && raw[0] == expected))
		}
	}
}

func validateWorkflowDeliverySchema(p Plan) error {
	required := map[string][]string{
		"flow_actionable_outbox":   {"depends_on_notification_outbox_id", "version_no", "attempt_count", "abandoned_at"},
		"flow_notification_outbox": {"version_no", "attempt_count", "abandoned_at"},
		"flow_callback_logs":       {"version_no", "attempts", "abandoned_at"},
		"flow_delivery_audit":      {"credential_id", "recovery_reason", "actor_code"},
	}
	for _, t := range p.Tables {
		if t.Domain != "workflow" {
			continue
		}
		for _, column := range required[t.Name] {
			found := false
			for _, have := range t.Columns {
				if have == column {
					found = true
				}
			}
			if !found {
				return errors.New("Workflow migration 013/014 columns missing")
			}
		}
	}
	return nil
}
