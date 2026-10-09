package aims

import (
	"context"
	"net/http"
	"net/url"
	"strings"
)

var projectScopedGenericCollections = map[string]struct{}{
	"repos":                {},
	"milestones":           {},
	"work-items":           {},
	"requirements":         {},
	"requirement-contents": {},
	"requirement-reviews":  {},
	"gitlab-commits":       {},
}

var projectScopedGenericWriteCollections = map[string]struct{}{
	"repos":                {},
	"milestones":           {},
	"work-items":           {},
	"requirements":         {},
	"requirement-contents": {},
	"requirement-reviews":  {},
}

func projectScopedGenericCollection(path string) (string, string, bool) {
	const prefix = "/v1/aims/projects/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	rest := strings.TrimPrefix(path, prefix)
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", "", false
	}
	collection := strings.TrimSpace(parts[1])
	if _, ok := projectScopedGenericCollections[collection]; !ok {
		return "", "", false
	}
	return strings.TrimSpace(parts[0]), collection, true
}

func projectScopedGenericCollectionSupportsWrite(collection string) bool {
	_, ok := projectScopedGenericWriteCollections[strings.TrimSpace(collection)]
	return ok
}

func (a *Adapter) handleProjectScopedGenericRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (any, string, bool, error) {
	projectID, collection, ok := projectScopedGenericCollection(path)
	if !ok {
		return nil, "", false, nil
	}

	switch method {
	case http.MethodGet:
		if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
			return nil, "", true, err
		}
	case http.MethodPost:
		if !projectScopedGenericCollectionSupportsWrite(collection) {
			return nil, "", false, nil
		}
		if err := a.requireProjectUpdateAccess(ctx, path, query, body, projectID); err != nil {
			return nil, "", true, err
		}
	default:
		return nil, "", false, nil
	}

	data, operation, err := a.Adapter.HandleRuntime(ctx, method, path, query, body)
	return data, operation, true, err
}
