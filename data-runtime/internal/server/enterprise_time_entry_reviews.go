package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"strconv"
	"time"

	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

type enterpriseReviewBranch struct {
	Action         string                  `json:"action"`
	Scope          projectscope.Projection `json:"scope"`
	BundleVersion  string                  `json:"bundleVersion"`
	BundleHash     string                  `json:"bundleHash"`
	PolicyRevision *int64                  `json:"policyRevision"`
	ExpiresAt      int64                   `json:"expiresAt"`
}
type enterpriseReviewPermit struct {
	ActorUID   string                   `json:"actorUid"`
	Tenant     string                   `json:"tenant"`
	Deployment string                   `json:"deployment"`
	Resource   string                   `json:"resource"`
	Action     string                   `json:"action"`
	Operation  string                   `json:"operation"`
	ProjectID  string                   `json:"projectId"`
	Query      map[string]string        `json:"query"`
	Branches   []enterpriseReviewBranch `json:"branches"`
	ExpiresAt  int64                    `json:"expiresAt"`
}
type enterpriseReviewInput struct {
	Tenant        string                 `json:"tenant"`
	Deployment    string                 `json:"deployment"`
	ProjectID     string                 `json:"projectId"`
	Query         map[string]string      `json:"query"`
	Authorization enterpriseReviewPermit `json:"authorization"`
}

func enterpriseReviewQuery(q map[string]string) (url.Values, error) {
	bad := httperror.New(400, "enterprise_time_entry_review_input_invalid", "Invalid review query")
	key := q["periodKey"]
	if !regexp.MustCompile(`^[0-9]{4}-W[0-9]{2}$`).MatchString(key) {
		return nil, bad
	}
	year, _ := strconv.Atoi(key[:4])
	week, _ := strconv.Atoi(key[6:])
	_, maxWeek := time.Date(year, 12, 28, 0, 0, 0, 0, time.UTC).ISOWeek()
	if year < 1970 || week < 1 || week > maxWeek {
		return nil, bad
	}
	out := url.Values{}
	for k, v := range q {
		switch k {
		case "periodKey":
		case "page", "pageSize":
			n, e := strconv.Atoi(v)
			max := 1000000
			if k == "pageSize" {
				max = 100
			}
			if e != nil || n < 1 || n > max || strconv.Itoa(n) != v {
				return nil, bad
			}
		default:
			return nil, bad
		}
		out.Set(k, v)
	}
	return out, nil
}
func validateEnterpriseReviewPermit(in enterpriseReviewInput, verified enterpriseRequestContext, now time.Time) error {
	p := in.Authorization
	forbidden := httperror.New(403, "enterprise_time_entry_review_permit_invalid", "Invalid review authorization")
	if in.Tenant != verified.Route.Binding.Tenant || in.Deployment != verified.Route.HostDeployment || p.Tenant != in.Tenant || p.Deployment != in.Deployment || p.ActorUID != verified.ActorUID || p.Resource != "time-entry-reviews" || p.Action != "view" || p.Operation != "list" || p.ProjectID != in.ProjectID || !reflect.DeepEqual(p.Query, in.Query) || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() || len(p.Branches) < 1 || len(p.Branches) > 2 {
		return forbidden
	}
	seen := map[string]bool{}
	for _, branch := range p.Branches {
		if (branch.Action != "approve" && branch.Action != "submit") || seen[branch.Action] || branch.BundleVersion == "" || branch.BundleHash == "" || branch.PolicyRevision == nil || *branch.PolicyRevision < 0 || branch.ExpiresAt < p.ExpiresAt || branch.Scope.Validate() != nil {
			return forbidden
		}
		first := p.Branches[0]
		if branch.BundleVersion != first.BundleVersion || branch.BundleHash != first.BundleHash || *branch.PolicyRevision != *first.PolicyRevision {
			return forbidden
		}
		seen[branch.Action] = true
	}
	id, e := strconv.ParseInt(in.ProjectID, 10, 64)
	if e != nil || id < 1 || strconv.FormatInt(id, 10) != in.ProjectID {
		return httperror.New(400, "enterprise_time_entry_review_input_invalid", "Invalid project ID")
	}
	_, e = enterpriseReviewQuery(in.Query)
	return e
}
func enterpriseReviewPermitCanonical(r *http.Request, p enterpriseReviewPermit) string {
	branches := []any{}
	for _, b := range p.Branches {
		branches = append(branches, []any{b.Action, b.BundleVersion, b.BundleHash, b.PolicyRevision, b.ExpiresAt, b.Scope.Version, b.Scope.ProjectCodes, b.Scope.DepartmentCodes, b.Scope.DepartmentTreeRoots, b.Scope.Masks})
	}
	return enterpriseAltocPermitFieldsCanonical([]any{"hzy-enterprise-timesheet-review-permit.v1", r.Method, r.URL.RequestURI(), p.ActorUID, p.Tenant, p.Deployment, p.Resource, p.Action, p.Operation, p.ProjectID, p.ExpiresAt, p.Query["periodKey"], p.Query["page"], p.Query["pageSize"], branches})
}
func verifyEnterpriseReviewSignature(r *http.Request, p enterpriseReviewPermit) error {
	token, signature := runtimeBearerToken(r), r.Header.Get("X-HZY-Enterprise-Timesheet-Review-Permit-Signature")
	if token != "" && signature != "" {
		mac := hmac.New(sha256.New, []byte(token))
		mac.Write([]byte(enterpriseReviewPermitCanonical(r, p)))
		if hmac.Equal([]byte(signature), []byte(base64.RawURLEncoding.EncodeToString(mac.Sum(nil)))) {
			return nil
		}
	}
	return httperror.New(403, "enterprise_time_entry_review_signature_invalid", "Invalid review permit signature")
}
func (s *Server) routeEnterpriseTimeEntryReviews(r *http.Request) (routeResult, error) {
	if !s.cfg.Enterprise.Enabled || s.aims == nil {
		return routeResult{}, httperror.New(503, "enterprise_time_entry_reviews_unavailable", "Review reads are not enabled")
	}
	route := enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: s.cfg.Tenant, Environment: s.cfg.Enterprise.Environment, RuntimeDeployment: s.cfg.Deployment}, HostDeployment: s.cfg.DeploymentBindings["enterprise"], LogicalSource: "aims", LogicalTarget: "aims"}
	verified, e := authenticateEnterpriseRequest(r, s.auth, route, s.verifyEnterpriseCredential)
	if e != nil {
		return routeResult{}, e
	}
	result := routeResult{Operation: "enterprise.aims.time-entry-reviews.list", Auth: &verified.Service}
	if r.URL.RawQuery != "" {
		return result, httperror.New(400, "enterprise_time_entry_review_input_invalid", "URL query is not accepted")
	}
	body, e := readJSONBody(r)
	if e != nil {
		return result, e
	}
	raw, e := json.Marshal(body)
	if e != nil {
		return result, e
	}
	var in enterpriseReviewInput
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if e = decoder.Decode(&in); e != nil {
		return result, httperror.New(400, "enterprise_time_entry_review_input_invalid", "Invalid review input")
	}
	if e = validateEnterpriseReviewPermit(in, verified, time.Now()); e != nil {
		return result, e
	}
	if e = verifyEnterpriseReviewSignature(r, in.Authorization); e != nil {
		return result, e
	}
	roots := []string{}
	seenRoots := map[string]bool{}
	projections := []projectscope.Projection{}
	for _, branch := range in.Authorization.Branches {
		for _, root := range branch.Scope.DepartmentTreeRoots {
			if !seenRoots[root] {
				roots = append(roots, root)
				seenRoots[root] = true
			}
		}
		projections = append(projections, branch.Scope)
	}
	descendants := map[string][]string{}
	if len(roots) > 0 {
		if s.directory == nil {
			return result, httperror.New(503, "enterprise_time_entry_review_scope_unavailable", "Review scope facts unavailable")
		}
		descendants, e = s.directory.EnterpriseProjectScopeDepartmentDescendants(r.Context(), roots)
		if e != nil {
			return result, httperror.New(503, "enterprise_time_entry_review_scope_unavailable", "Review scope facts unavailable")
		}
	}
	q, e := enterpriseReviewQuery(in.Query)
	if e != nil {
		return result, e
	}
	q.Set("current_user", verified.ActorUID)
	// Only this authenticated, body-signed route derives legacy entry flags.
	q.Set("current_user_can_review_assigned_timesheet", "1")
	for _, branch := range in.Authorization.Branches {
		if branch.Action == "approve" {
			q.Set("current_user_can_approve_timesheet", "1")
		}
	}
	ctx := aimsapp.WithEnterpriseTimeEntryReviewScopes(r.Context(), projections, descendants)
	out, operation, e := s.aims.HandleRuntime(ctx, http.MethodGet, "/v1/aims/projects/"+in.ProjectID+"/time-entry-reviews", q, map[string]any{})
	if operation != "" {
		result.Operation = "enterprise." + operation
	}
	result.Body = out
	return result, enterpriseReviewReadError(e)
}

func enterpriseReviewReadError(err error) error {
	if err == nil {
		return nil
	}
	var known httperror.Error
	if errors.As(err, &known) {
		return err
	}
	return httperror.New(503, "enterprise_time_entry_reviews_unavailable", "Review read service is unavailable")
}
