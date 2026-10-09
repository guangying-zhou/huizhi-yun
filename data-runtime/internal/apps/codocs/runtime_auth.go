package codocs

import "net/url"

var codocsRuntimeAuthKeys = map[string]bool{
	"current_user":        true,
	"currentUser":         true,
	"operator_uid":        true,
	"operatorUid":         true,
	"actor_uid":           true,
	"actorUid":            true,
	"owner_uid":           true,
	"ownerUid":            true,
	"editor_uid":          true,
	"editorUid":           true,
	"lastEditorUid":       true,
	"last_editor_uid":     true,
	"created_by":          true,
	"createdBy":           true,
	"updated_by":          true,
	"updatedBy":           true,
	"serverAuthorized":    true,
	"server_authorized":   true,
	"actorProjectCodes":   true,
	"actor_project_codes": true,
	"actorDeptCodes":      true,
	"actor_dept_codes":    true,
	"actorRoles":          true,
	"actor_roles":         true,
}

func codocsRuntimeBodyFromRequest(query url.Values, body map[string]any) map[string]any {
	actor := codocsRuntimeActorFromQuery(query)
	if actor == "" {
		return body
	}

	result := map[string]any{}
	for key, value := range body {
		if codocsRuntimeAuthKeys[key] {
			continue
		}
		result[key] = value
	}
	result["current_user"] = actor
	result["currentUser"] = actor
	result["operator_uid"] = actor
	result["operatorUid"] = actor
	result["actorUid"] = actor
	result["actor_uid"] = actor
	result["created_by"] = actor
	result["createdBy"] = actor
	result["updated_by"] = actor
	result["updatedBy"] = actor
	return result
}

func codocsRuntimeActorFromQuery(query url.Values) string {
	if query == nil {
		return ""
	}
	return firstNonEmpty(
		query.Get("current_user"),
		query.Get("currentUser"),
		query.Get("operator_uid"),
		query.Get("operatorUid"),
		query.Get("actorUid"),
		query.Get("actor_uid"),
	)
}
