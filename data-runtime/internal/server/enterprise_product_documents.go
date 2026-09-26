package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var enterpriseProductDocumentActions = map[string]string{
	"/v1/enterprise/aims/product-documents:list":     "list",
	"/v1/enterprise/aims/product-documents:requests": "requests",
	"/v1/enterprise/aims/product-documents:search":   "search",
	"/v1/enterprise/aims/product-documents:content":  "content",
}

var enterpriseProductDocumentUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type enterpriseProductDocumentInput struct {
	ProductCode   string                 `json:"productCode"`
	Tenant        string                 `json:"tenant"`
	Deployment    string                 `json:"deployment"`
	Authorization pc.AuthorizationPermit `json:"authorization"`
	Query         struct {
		Page     int    `json:"page"`
		PageSize int    `json:"pageSize"`
		Purpose  string `json:"purpose"`
		Removed  bool   `json:"removed"`
		Search   string `json:"search"`
		BizID    string `json:"bizId"`
	} `json:"query"`
}

func productDocumentReadFailure(err error) error {
	var known httperror.Error
	if errors.As(err, &known) && (known.Status == 400 || known.Status == 403 || known.Status == 404 || known.Status == 409 || known.Status == 503) {
		return err
	}
	return httperror.New(503, "enterprise_product_document_dependency_unavailable", "Product document dependency is unavailable")
}

func validProductDocumentQuery(action string, input enterpriseProductDocumentInput) bool {
	q := input.Query
	if action == "content" {
		return enterpriseProductDocumentUUID.MatchString(q.BizID) && q.BizID != "00000000-0000-0000-0000-000000000000" && q.Page == 0 && q.PageSize == 0 && q.Purpose == "" && !q.Removed && q.Search == ""
	}
	if q.Page < 1 || q.Page > 100000 || q.PageSize < 1 || q.PageSize > 100 || q.BizID != "" {
		return false
	}
	if action == "requests" {
		return q.Purpose == "" && !q.Removed && q.Search == ""
	}
	if q.Purpose != "" {
		switch q.Purpose {
		case "product-overview", "requirements", "design", "release-notes", "user-guide", "other":
		default:
			return false
		}
	}
	return action == "list" && q.Search == "" || action == "search" && q.Search == strings.TrimSpace(q.Search) && len([]rune(q.Search)) <= 200
}

func (s *Server) routeEnterpriseProductDocuments(r *http.Request, action string) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterprisePlanning == nil {
		return routeResult{}, httperror.New(503, "enterprise_product_document_unavailable", "Product document reader is unavailable")
	}
	route := enterpriseRouteContext{
		Binding:        enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment},
		HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Capability: "aims:product-documents:read",
	}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.product-documents." + action, Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "product_document_input_invalid", "Invalid product document input")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var input enterpriseProductDocumentInput
	if err = decoder.Decode(&input); err != nil || !validProductDocumentQuery(action, input) {
		return result, httperror.New(400, "product_document_input_invalid", "Invalid product document input")
	}
	if err = validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, input.Authorization, "product_documents", "view", verified, time.Now()); err != nil {
		return result, err
	}
	if action == "requests" {
		page, err := s.enterprisePlanning.ListProductDocumentRequests(r.Context(), input.ProductCode, verified.ActorUID, input.Authorization, input.Query.Page, input.Query.PageSize)
		if err != nil {
			return result, productDocumentReadFailure(err)
		}
		result.Body = map[string]any{"code": 0, "data": page}
		return result, nil
	}
	if s.codocs == nil {
		return result, httperror.New(503, "enterprise_product_document_unavailable", "Codocs reader is unavailable")
	}
	if action == "content" {
		relation, err := s.enterprisePlanning.ReadProductDocument(r.Context(), input.ProductCode, verified.ActorUID, input.Query.BizID, input.Authorization)
		if err != nil {
			return result, productDocumentReadFailure(err)
		}
		if relation.Item.Removed {
			return result, httperror.New(404, "product_document_not_found", "Product document relation not found")
		}
		doc, err := s.codocs.ReadProductDocumentForEnterprise(r.Context(), relation.Item.DocumentUUID, verified.ActorUID, true)
		if err != nil {
			return result, productDocumentReadFailure(err)
		}
		result.Body = map[string]any{"code": 0, "data": map[string]any{"product_code": input.ProductCode, "workspace_revision": relation.WorkspaceRevision, "relation_biz_id": relation.Item.BizID, "document": doc}}
		return result, nil
	}
	page, err := s.listVisibleProductDocuments(r, input, verified.ActorUID, action == "search")
	if err != nil {
		return result, productDocumentReadFailure(err)
	}
	result.Body = map[string]any{"code": 0, "data": page}
	return result, nil
}

func (s *Server) listVisibleProductDocuments(r *http.Request, input enterpriseProductDocumentInput, actor string, search bool) (map[string]any, error) {
	q := input.Query
	items := []map[string]any{}
	total, candidateTotal, revision := 0, -1, uint64(0)
	start := (q.Page - 1) * q.PageSize
	for candidatePage := 1; ; candidatePage++ {
		candidates, err := s.enterprisePlanning.ListProductDocuments(r.Context(), input.ProductCode, actor, input.Authorization, pc.ProductDocumentQuery{Purpose: q.Purpose, Removed: q.Removed, Page: candidatePage, PageSize: 100})
		if err != nil {
			return nil, err
		}
		if candidatePage == 1 {
			candidateTotal, revision = candidates.Total, candidates.WorkspaceRevision
		}
		if candidates.Total != candidateTotal || candidates.WorkspaceRevision != revision || len(candidates.Items) != min(100, max(0, candidateTotal-(candidatePage-1)*100)) {
			return nil, httperror.New(409, "product_document_changed", "Product document relations changed")
		}
		for _, relation := range candidates.Items {
			doc, err := s.codocs.ReadProductDocumentForEnterprise(r.Context(), relation.DocumentUUID, actor, false)
			if err != nil {
				var denied httperror.Error
				if errors.As(err, &denied) && (denied.Status == 403 || denied.Status == 404) {
					continue
				}
				return nil, err
			}
			if search && !strings.Contains(strings.ToLower(doc["title"].(string)), strings.ToLower(q.Search)) {
				continue
			}
			if total >= start && len(items) < q.PageSize {
				items = append(items, map[string]any{"biz_id": relation.BizID, "product_code": relation.ProductCode, "document_uuid": relation.DocumentUUID, "purpose": relation.Purpose, "revision": relation.Revision, "removed": relation.Removed, "metadata": doc})
			}
			total++
		}
		if candidatePage*100 >= candidateTotal {
			break
		}
	}
	return map[string]any{"product_code": input.ProductCode, "workspace_revision": revision, "items": items, "total": total, "page": q.Page, "pageSize": q.PageSize}, nil
}

// Linking stores an Aims relation only. Codocs ACL is checked independently
// before the domain command, and is never widened by the new relation.
func (s *Server) routeEnterpriseProductDocumentLink(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.enterprisePlanning == nil || s.codocs == nil {
		return routeResult{}, httperror.New(503, "enterprise_product_document_unavailable", "Product document writer is unavailable")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims", Capability: "aims:product-documents:create"}
	verified, err := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if err != nil {
		return routeResult{}, err
	}
	result := routeResult{Operation: "enterprise.aims.product-documents.link", Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "product_document_input_invalid", "Query parameters are not supported")
	}
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if key == "" || len(key) > 191 {
		return result, httperror.New(400, "product_document_key_invalid", "Idempotency-Key is required")
	}
	body, err := readJSONBody(r)
	if err != nil {
		return result, err
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return result, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var input struct {
		ProductCode   string                   `json:"productCode"`
		Tenant        string                   `json:"tenant"`
		Deployment    string                   `json:"deployment"`
		Authorization pc.AuthorizationPermit   `json:"authorization"`
		Input         pc.ProductDocumentCreate `json:"input"`
	}
	if decoder.Decode(&input) != nil {
		return result, httperror.New(400, "product_document_input_invalid", "Invalid product document input")
	}
	if err = validateEnterpriseProductPermit(input.ProductCode, input.Tenant, input.Deployment, input.Authorization, "product_documents", "edit", verified, time.Now()); err != nil {
		return result, err
	}
	if err = pc.ValidateProductDocumentCreate(input.Input); err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	if _, err = s.codocs.ReadProductDocumentForEnterprise(r.Context(), input.Input.DocumentUUID, verified.ActorUID, false); err != nil {
		return result, productDocumentReadFailure(err)
	}
	id := pc.CommandIdentity{ProductCode: input.ProductCode, ActorUID: verified.ActorUID, Action: "product_documents:create", IdempotencyKey: key}
	out, err := s.enterprisePlanning.LinkProductDocument(r.Context(), id, input.Authorization, input.Input)
	if err != nil {
		return result, aimsapp.EnterpriseProductCommandError(err)
	}
	result.Body = map[string]any{"code": 0, "data": out}
	return result, nil
}
