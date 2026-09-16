package providers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	consoleclient "github.com/huizhi-yun/notification-runtime/internal/console"
	"github.com/huizhi-yun/notification-runtime/internal/httperror"
	"github.com/huizhi-yun/notification-runtime/internal/peoplejobs"
)

const (
	DefaultDingTalkAPIBaseURL  = "https://api.dingtalk.com"
	DefaultDingTalkOAPIBaseURL = "https://oapi.dingtalk.com"
)

type DingTalkProvider struct {
	console weComConfigClient
	http    *http.Client
	mutex   sync.Mutex
	tokens  map[string]wecomToken
}

type dingTalkConfiguration struct {
	Integration      consoleclient.Integration
	Secret           consoleclient.Secret
	AppKey           string
	AgentID          int64
	IdentityClientID string
	CorpID           string
	RobotCode        string
}

type dingTalkConfigurationUsage string

const (
	dingTalkIdentityUsage     dingTalkConfigurationUsage = "identity"
	dingTalkNotificationUsage dingTalkConfigurationUsage = "notification"
	dingTalkPeopleUsage       dingTalkConfigurationUsage = "people"
)

type DingTalkIdentityExchangeRequest struct {
	IntegrationCode   string `json:"integrationCode"`
	AuthorizationCode string `json:"authorizationCode"`
}

type dingTalkUserTokenResponse struct {
	AccessToken string `json:"accessToken"`
	CorpID      string `json:"corpId"`
}

type dingTalkMeResponse struct {
	UnionID string `json:"unionId"`
	Visitor bool   `json:"visitor"`
}

type dingTalkAppTokenResponse struct {
	AccessToken string `json:"accessToken"`
	ExpireIn    int    `json:"expireIn"`
}

type dingTalkAPIResponseError struct {
	StatusCode int
}

func (e *dingTalkAPIResponseError) Error() string {
	return fmt.Sprintf("DingTalk API returned HTTP %d", e.StatusCode)
}

type dingTalkUserByUnionIDResponse struct {
	ErrCode int `json:"errcode"`
	Result  struct {
		UserID string `json:"userid"`
	} `json:"result"`
}

type dingTalkSendResponse struct {
	ProcessQueryKey           string   `json:"processQueryKey"`
	InvalidStaffIDList        []string `json:"invalidStaffIdList"`
	FilteredStaffIDList       []string `json:"filteredStaffIdList"`
	FlowControlledStaffIDList []string `json:"flowControlledStaffIdList"`
}

type dingTalkDepartmentListResponse struct {
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
	Result  []struct {
		DepartmentID int64  `json:"dept_id"`
		Name         string `json:"name"`
		ParentID     int64  `json:"parent_id"`
	} `json:"result"`
}

type dingTalkDepartmentDetailResponse struct {
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
	Result  struct {
		DepartmentID             int64    `json:"dept_id"`
		Name                     string   `json:"name"`
		ParentID                 int64    `json:"parent_id"`
		Order                    int64    `json:"order"`
		DepartmentManagerUserIDs []string `json:"dept_manager_userid_list"`
	} `json:"result"`
}

type dingTalkDepartmentSnapshotItem struct {
	department    peoplejobs.Department
	providerOrder int64
	depth         int
}

type dingTalkUserListResponse struct {
	ErrCode int    `json:"errcode"`
	ErrMsg  string `json:"errmsg"`
	Result  struct {
		HasMore    bool                   `json:"has_more"`
		NextCursor int64                  `json:"next_cursor"`
		List       []dingTalkUserListItem `json:"list"`
	} `json:"result"`
}

type dingTalkUserListItem struct {
	UserID        string  `json:"userid"`
	Name          string  `json:"name"`
	Email         string  `json:"email"`
	OrgEmail      string  `json:"org_email"`
	Mobile        string  `json:"mobile"`
	Title         string  `json:"title"`
	DepartmentIDs []int64 `json:"dept_id_list"`
	ManagerUserID string  `json:"manager_userid"`
	HiredDate     any     `json:"hired_date"`
	Active        *bool   `json:"active"`
	present       map[string]bool
}

func (item *dingTalkUserListItem) UnmarshalJSON(data []byte) error {
	type itemAlias dingTalkUserListItem
	var decoded itemAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	*item = dingTalkUserListItem(decoded)
	item.present = make(map[string]bool, len(fields))
	for field := range fields {
		item.present[field] = true
	}
	return nil
}

type dingTalkRosterListResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Result  []struct {
		UserID        string                    `json:"userId"`
		FieldDataList []dingTalkRosterFieldData `json:"fieldDataList"`
	} `json:"result"`
}

type dingTalkRosterFieldData struct {
	FieldCode      string                     `json:"fieldCode"`
	FieldValueList []dingTalkRosterFieldValue `json:"fieldValueList"`
}

type dingTalkRosterFieldValue struct {
	Value any    `json:"value"`
	Label string `json:"label"`
}

var dingTalkPeopleRosterFieldCodes = []string{
	"sys02-certNo",
	"sys02-birthTime",
	"sys03-highestEdu",
	"sys03-major",
	"sys03-graduateSchool",
	"sys03-graduationTime",
}

type dingTalkDismissionsResponse struct {
	NextToken  int64    `json:"nextToken"`
	HasMore    bool     `json:"hasMore"`
	UserIDList []string `json:"userIdList"`
}

type dingTalkDimissionInfoResponse struct {
	Result []dingTalkDimissionInfo `json:"result"`
}

type dingTalkDimissionInfo struct {
	UserID          string `json:"userId"`
	LastWorkDay     int64  `json:"lastWorkDay"`
	Status          int    `json:"status"`
	MainDeptID      int64  `json:"mainDeptId"`
	ReasonMemo      string `json:"reasonMemo"`
	VoluntaryReason any    `json:"voluntaryReason"`
	PassiveReason   any    `json:"passiveReason"`
}

func NewDingTalkProvider(console *consoleclient.Client) *DingTalkProvider {
	return newDingTalkProvider(console, &http.Client{Timeout: 10 * time.Second})
}

func newDingTalkProvider(console weComConfigClient, client *http.Client) *DingTalkProvider {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &DingTalkProvider{console: console, http: client, tokens: make(map[string]wecomToken)}
}

func (p *DingTalkProvider) ExchangeIdentity(ctx context.Context, input DingTalkIdentityExchangeRequest) (IdentityExchangeResult, error) {
	integrationCode := first(input.IntegrationCode, "dingtalk.default")
	code := strings.TrimSpace(input.AuthorizationCode)
	if len(code) < 1 || len(code) > 512 {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadRequest, "invalid_authorization_code", "DingTalk authorization code is invalid")
	}
	configuration, err := p.configuration(ctx, integrationCode, dingTalkIdentityUsage)
	if err != nil {
		return IdentityExchangeResult{}, err
	}
	apiBase, err := ValidateDingTalkAPIBaseURL(first(configuration.Integration.BaseURL, stringFromMap(configuration.Integration.Config, "baseUrl"), DefaultDingTalkAPIBaseURL))
	if err != nil {
		return IdentityExchangeResult{}, err
	}

	var userToken dingTalkUserTokenResponse
	if err := p.postJSON(ctx, apiBase+"/v1.0/oauth2/userAccessToken", "", map[string]any{
		"clientId": configuration.IdentityClientID, "clientSecret": configuration.Secret.Value, "code": code, "grantType": "authorization_code",
	}, &userToken); err != nil || userToken.AccessToken == "" {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "dingtalk_identity_exchange_rejected", "DingTalk rejected the authorization code")
	}
	if configuration.CorpID != "" && userToken.CorpID != "" && userToken.CorpID != configuration.CorpID {
		return IdentityExchangeResult{}, httperror.New(http.StatusForbidden, "dingtalk_corp_mismatch", "DingTalk identity does not belong to the configured enterprise")
	}

	var me dingTalkMeResponse
	if err := p.getJSON(ctx, apiBase+"/v1.0/contact/users/me", userToken.AccessToken, &me); err != nil {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "dingtalk_identity_profile_failed", "DingTalk identity profile request failed")
	}
	unionID := strings.TrimSpace(me.UnionID)
	if me.Visitor || unionID == "" {
		return IdentityExchangeResult{}, httperror.New(http.StatusForbidden, "dingtalk_member_required", "DingTalk login requires an enterprise member")
	}

	appToken, err := p.accessToken(ctx, apiBase, integrationCode, configuration.AppKey, configuration.Secret.Value, configuration.Secret.VersionNo)
	if err != nil {
		return IdentityExchangeResult{}, err
	}
	endpoint := DefaultDingTalkOAPIBaseURL + "/topapi/user/getbyunionid?access_token=" + url.QueryEscape(appToken)
	var mapped dingTalkUserByUnionIDResponse
	if err := p.postJSON(ctx, endpoint, "", map[string]string{"unionid": unionID}, &mapped); err != nil || mapped.ErrCode != 0 {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "dingtalk_identity_mapping_failed", "DingTalk member identity could not be mapped")
	}
	userID := strings.TrimSpace(mapped.Result.UserID)
	if userID == "" || len(userID) > 255 || strings.ContainsAny(userID, "\r\n\x00") {
		return IdentityExchangeResult{}, httperror.New(http.StatusBadGateway, "dingtalk_identity_response_invalid", "DingTalk identity response was invalid")
	}
	result := IdentityExchangeResult{Provider: "dingtalk", IntegrationCode: integrationCode}
	result.Subject.ID = userID
	result.Subject.Kind = "member"
	return result, nil
}

func (p *DingTalkProvider) Send(ctx context.Context, input SendRequest) (SendResult, error) {
	normalized, err := NormalizeSendRequest(input)
	if err != nil {
		return SendResult{}, err
	}
	if normalized.Channel != "dingtalk" {
		return SendResult{}, httperror.New(http.StatusBadRequest, "unsupported_channel", "DingTalk provider requires channel=dingtalk")
	}
	integrationCode := first(normalized.IntegrationCode, "dingtalk.default")
	configuration, err := p.configuration(ctx, integrationCode, dingTalkNotificationUsage)
	if err != nil {
		return SendResult{}, err
	}
	apiBase, err := ValidateDingTalkAPIBaseURL(first(configuration.Integration.BaseURL, stringFromMap(configuration.Integration.Config, "baseUrl"), DefaultDingTalkAPIBaseURL))
	if err != nil {
		return SendResult{}, err
	}
	accessToken, err := p.accessToken(ctx, apiBase, integrationCode, configuration.AppKey, configuration.Secret.Value, configuration.Secret.VersionNo)
	if err != nil {
		return SendResult{}, err
	}
	recipients, err := NormalizeRecipientUIDs(normalized.ToUser)
	if err != nil {
		return SendResult{}, err
	}
	messageJSON, _ := json.Marshal(map[string]string{
		"title": normalized.Title,
		"text":  normalized.Description + "\n\n[" + first(normalized.ButtonText, "查看详情") + "](" + normalized.URL + ")",
	})
	var response dingTalkSendResponse
	if err := p.postJSON(ctx, apiBase+"/v1.0/robot/oToMessages/batchSend", accessToken, map[string]any{
		"robotCode": configuration.RobotCode, "userIds": recipients, "msgKey": "sampleMarkdown", "msgParam": string(messageJSON),
	}, &response); err != nil {
		return SendResult{}, httperror.New(http.StatusBadGateway, "dingtalk_send_failed", "DingTalk rejected notification request")
	}
	if response.ProcessQueryKey == "" || len(response.InvalidStaffIDList)+len(response.FlowControlledStaffIDList) > 0 {
		return SendResult{}, httperror.New(http.StatusBadGateway, "dingtalk_send_partial", "DingTalk did not accept every notification recipient")
	}
	return SendResult{Provider: "dingtalk", IntegrationCode: integrationCode, ProviderResult: map[string]any{
		"processQueryKey": response.ProcessQueryKey, "filteredCount": len(response.FilteredStaffIDList),
	}}, nil
}

// RunPeopleSync implements the reviewed DingTalk organization/people allowlist.
// It emits normalized bounded batches and never exposes provider access tokens.
func (p *DingTalkProvider) RunPeopleSync(ctx context.Context, input peoplejobs.StartRequest, emit func(peoplejobs.Batch) error) (peoplejobs.Counts, error) {
	integrationCode := first(input.IntegrationCode, "dingtalk.default")
	configuration, err := p.configuration(ctx, integrationCode, dingTalkPeopleUsage)
	if err != nil {
		return peoplejobs.Counts{}, err
	}
	if hasObjectScope(input.ObjectScopes, "people") && configuration.AgentID <= 0 {
		return peoplejobs.Counts{}, httperror.New(http.StatusConflict, "dingtalk_people_agent_id_missing", "DingTalk People sync requires the application's numeric Agent ID to read Smart HR roster fields")
	}
	apiBase, err := ValidateDingTalkAPIBaseURL(first(configuration.Integration.BaseURL, stringFromMap(configuration.Integration.Config, "baseUrl"), DefaultDingTalkAPIBaseURL))
	if err != nil {
		return peoplejobs.Counts{}, err
	}
	token, err := p.accessToken(ctx, apiBase, integrationCode, configuration.AppKey, configuration.Secret.Value, configuration.Secret.VersionNo)
	if err != nil {
		return peoplejobs.Counts{}, err
	}
	rootDepartmentID := int64(1)
	if rawRoot, configured := configuration.Integration.Config["rootDeptId"]; configured && rawRoot != nil {
		value := strings.TrimSpace(fmt.Sprint(rawRoot))
		parsedRoot, parseErr := strconv.ParseInt(value, 10, 64)
		if parseErr != nil {
			return peoplejobs.Counts{}, httperror.New(http.StatusConflict, "dingtalk_people_root_invalid", "People HR source rootDeptId must be a valid DingTalk department ID")
		}
		rootDepartmentID = parsedRoot
	}
	if rootDepartmentID != 1 {
		return peoplejobs.Counts{}, httperror.New(http.StatusConflict, "dingtalk_people_root_unsupported", "People HR source sync requires the DingTalk provider root department")
	}
	departments, err := p.loadDingTalkDepartmentSnapshot(ctx, token, rootDepartmentID)
	if err != nil {
		return peoplejobs.Counts{}, err
	}
	counts := peoplejobs.Counts{Departments: len(departments)}
	batchNo := 0
	if hasObjectScope(input.ObjectScopes, "organization") {
		for start := 0; start < len(departments); start += 100 {
			end := start + 100
			if end > len(departments) {
				end = len(departments)
			}
			batchNo++
			if err := emit(peoplejobs.Batch{
				BatchNumber:                  batchNo,
				OrganizationRootDepartmentID: fmt.Sprint(rootDepartmentID),
				Departments:                  departments[start:end],
			}); err != nil {
				return counts, err
			}
			counts.Batches++
		}
	}
	if hasObjectScope(input.ObjectScopes, "people") || hasObjectScope(input.ObjectScopes, "directory_profiles") {
		seen := map[string]bool{}
		users := make([]peoplejobs.User, 0)
		for _, department := range departments {
			deptID := int64(0)
			_, _ = fmt.Sscan(department.ProviderID, &deptID)
			cursor := int64(0)
			for {
				endpoint := DefaultDingTalkOAPIBaseURL + "/topapi/v2/user/list?access_token=" + url.QueryEscape(token)
				var response dingTalkUserListResponse
				if err := p.postJSON(ctx, endpoint, "", map[string]any{"dept_id": deptID, "cursor": cursor, "size": 100, "language": "zh_CN"}, &response); err != nil || response.ErrCode != 0 {
					return counts, httperror.New(http.StatusBadGateway, "dingtalk_users_failed", dingTalkProviderFailureMessage("DingTalk user list request failed", err, response.ErrCode, "qyapi_get_department_member"))
				}
				for _, item := range response.Result.List {
					subject := strings.TrimSpace(item.UserID)
					if subject == "" || seen[subject] {
						continue
					}
					seen[subject] = true
					deptIDs := make([]string, 0, len(item.DepartmentIDs))
					for _, id := range item.DepartmentIDs {
						deptIDs = append(deptIDs, fmt.Sprint(id))
					}
					onboardDate, onboardState := dingTalkOnboardDateState(item)
					users = append(users, peoplejobs.User{
						ProviderSubject:  subject,
						Name:             strings.TrimSpace(item.Name),
						Email:            first(item.Email, item.OrgEmail),
						Mobile:           strings.TrimSpace(item.Mobile),
						Title:            strings.TrimSpace(item.Title),
						DepartmentIDs:    deptIDs,
						ManagerSubject:   strings.TrimSpace(item.ManagerUserID),
						EmploymentStatus: "active",
						OnboardDate:      onboardDate,
						Active:           true,
						SourceFieldStates: map[string]string{
							"email":            dingTalkTextFieldState(item.present["email"] || item.present["org_email"], first(item.Email, item.OrgEmail)),
							"mobile":           dingTalkTextFieldState(item.present["mobile"], item.Mobile),
							"onboardDate":      onboardState,
							"idNumber":         "absent",
							"birthDate":        "absent",
							"educationLevel":   "absent",
							"major":            "absent",
							"graduationSchool": "absent",
							"graduationDate":   "absent",
						},
					})
				}
				if !response.Result.HasMore {
					break
				}
				cursor = response.Result.NextCursor
			}
		}
		if hasObjectScope(input.ObjectScopes, "people") {
			if err := p.enrichDingTalkRosterFacts(ctx, apiBase, token, configuration.AgentID, users); err != nil {
				return counts, err
			}
			users, err = p.enrichDingTalkEmploymentFacts(ctx, apiBase, token, users)
			if err != nil {
				return counts, err
			}
		}
		counts.Users = len(users)
		counts.FieldCoverage, counts.PartialFieldsMissing = dingTalkFieldCoverage(users)
		emailCounts := make(map[string]int)
		for _, user := range users {
			email := strings.ToLower(strings.TrimSpace(user.Email))
			if email != "" {
				emailCounts[email]++
			}
		}
		for index := range users {
			email := strings.ToLower(strings.TrimSpace(users[index].Email))
			if emailCounts[email] > 1 {
				// Email is the only approved matching key for Console Directory profile
				// projection. Remove ambiguous values before batching so duplicates
				// split across different batches can never race-update one user.
				users[index].Email = ""
			}
		}
		for start := 0; start < len(users); start += 100 {
			end := start + 100
			if end > len(users) {
				end = len(users)
			}
			batchNo++
			if err := emit(peoplejobs.Batch{BatchNumber: batchNo, Users: users[start:end]}); err != nil {
				return counts, err
			}
			counts.Batches++
		}
	}
	batchNo++
	finalBatch := peoplejobs.Batch{BatchNumber: batchNo, Final: true}
	if hasObjectScope(input.ObjectScopes, "organization") {
		finalBatch.OrganizationRootDepartmentID = fmt.Sprint(rootDepartmentID)
		finalBatch.OrganizationSnapshotComplete = true
		finalBatch.OrganizationSnapshotHash = dingTalkOrganizationSnapshotHash(departments)
		finalBatch.OrganizationDepartmentCount = len(departments)
	}
	if err := emit(finalBatch); err != nil {
		return counts, err
	}
	counts.Batches++
	return counts, nil
}

func (p *DingTalkProvider) loadDingTalkDepartmentSnapshot(ctx context.Context, token string, rootDepartmentID int64) ([]peoplejobs.Department, error) {
	root, err := p.dingTalkDepartmentDetail(ctx, token, rootDepartmentID)
	if err != nil {
		return nil, err
	}
	root.ParentProviderID = ""
	records := []dingTalkDepartmentSnapshotItem{{department: root, depth: 0}}
	queue := []int64{rootDepartmentID}
	depthByID := map[int64]int{rootDepartmentID: 0}
	seen := map[int64]bool{rootDepartmentID: true}

	for len(queue) > 0 {
		parent := queue[0]
		queue = queue[1:]
		endpoint := DefaultDingTalkOAPIBaseURL + "/topapi/v2/department/listsub?access_token=" + url.QueryEscape(token)
		var response dingTalkDepartmentListResponse
		if err := p.postJSON(ctx, endpoint, "", map[string]any{"dept_id": parent, "language": "zh_CN"}, &response); err != nil || response.ErrCode != 0 {
			return nil, httperror.New(http.StatusBadGateway, "dingtalk_departments_failed", dingTalkProviderFailureMessage("DingTalk department list request failed", err, response.ErrCode, "qyapi_get_department_list"))
		}
		for _, listed := range response.Result {
			if listed.DepartmentID <= 0 || seen[listed.DepartmentID] {
				return nil, httperror.New(http.StatusBadGateway, "dingtalk_department_tree_invalid", "DingTalk department tree contains a duplicate or invalid department")
			}
			detail, detailErr := p.dingTalkDepartmentDetail(ctx, token, listed.DepartmentID)
			if detailErr != nil {
				return nil, detailErr
			}
			if detail.ParentProviderID != fmt.Sprint(parent) || strings.TrimSpace(detail.Name) == "" {
				return nil, httperror.New(http.StatusBadGateway, "dingtalk_department_tree_invalid", "DingTalk department parent relationship is inconsistent")
			}
			seen[listed.DepartmentID] = true
			depth := depthByID[parent] + 1
			depthByID[listed.DepartmentID] = depth
			records = append(records, dingTalkDepartmentSnapshotItem{
				department:    detail,
				providerOrder: detailSortOrder(detail),
				depth:         depth,
			})
			queue = append(queue, listed.DepartmentID)
		}
	}

	sort.SliceStable(records, func(i, j int) bool {
		if records[i].depth != records[j].depth {
			return records[i].depth < records[j].depth
		}
		if records[i].department.ParentProviderID != records[j].department.ParentProviderID {
			return records[i].department.ParentProviderID < records[j].department.ParentProviderID
		}
		if records[i].providerOrder != records[j].providerOrder {
			return records[i].providerOrder < records[j].providerOrder
		}
		return records[i].department.ProviderID < records[j].department.ProviderID
	})
	siblingPosition := map[string]int{}
	departments := make([]peoplejobs.Department, 0, len(records))
	for _, record := range records {
		parent := record.department.ParentProviderID
		siblingPosition[parent]++
		record.department.SortOrder = siblingPosition[parent] * 10
		departments = append(departments, record.department)
	}
	return departments, nil
}

func (p *DingTalkProvider) dingTalkDepartmentDetail(ctx context.Context, token string, departmentID int64) (peoplejobs.Department, error) {
	endpoint := DefaultDingTalkOAPIBaseURL + "/topapi/v2/department/get?access_token=" + url.QueryEscape(token)
	var response dingTalkDepartmentDetailResponse
	if err := p.postJSON(ctx, endpoint, "", map[string]any{"dept_id": departmentID, "language": "zh_CN"}, &response); err != nil || response.ErrCode != 0 {
		return peoplejobs.Department{}, httperror.New(http.StatusBadGateway, "dingtalk_department_detail_failed", dingTalkProviderFailureMessage("DingTalk department detail request failed", err, response.ErrCode, "qyapi_get_department_list"))
	}
	if response.Result.DepartmentID != departmentID || strings.TrimSpace(response.Result.Name) == "" {
		return peoplejobs.Department{}, httperror.New(http.StatusBadGateway, "dingtalk_department_detail_invalid", "DingTalk department detail response is invalid")
	}
	managerSubject := ""
	for _, subject := range response.Result.DepartmentManagerUserIDs {
		subject = strings.TrimSpace(subject)
		if subject != "" && len(subject) <= 255 && !strings.ContainsAny(subject, "\r\n\x00") {
			managerSubject = subject
			break
		}
	}
	return peoplejobs.Department{
		ProviderID:       fmt.Sprint(response.Result.DepartmentID),
		Name:             strings.TrimSpace(response.Result.Name),
		ParentProviderID: positiveDingTalkDepartmentID(response.Result.ParentID),
		ManagerSubject:   managerSubject,
		SortOrder:        int(response.Result.Order),
	}, nil
}

func positiveDingTalkDepartmentID(value int64) string {
	if value <= 0 {
		return ""
	}
	return fmt.Sprint(value)
}

func detailSortOrder(department peoplejobs.Department) int64 {
	return int64(department.SortOrder)
}

func dingTalkDepartmentSnapshotLeaf(department peoplejobs.Department) string {
	canonical := strings.Join([]string{
		strings.TrimSpace(department.ProviderID),
		strings.TrimSpace(department.Name),
		strings.TrimSpace(department.ParentProviderID),
		fmt.Sprint(department.SortOrder),
		strings.TrimSpace(department.ManagerSubject),
	}, "\n")
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}

func dingTalkOrganizationSnapshotHash(departments []peoplejobs.Department) string {
	entries := make([]string, 0, len(departments))
	for _, department := range departments {
		entries = append(entries, strings.TrimSpace(department.ProviderID)+"\n"+dingTalkDepartmentSnapshotLeaf(department))
	}
	sort.Strings(entries)
	sum := sha256.Sum256([]byte(strings.Join(entries, "\n")))
	return hex.EncodeToString(sum[:])
}

func (p *DingTalkProvider) enrichDingTalkRosterFacts(ctx context.Context, apiBase, token string, agentID int64, users []peoplejobs.User) error {
	bySubject := make(map[string]int, len(users))
	subjects := make([]string, 0, len(users))
	for index := range users {
		subject := strings.TrimSpace(users[index].ProviderSubject)
		if subject == "" {
			continue
		}
		bySubject[subject] = index
		subjects = append(subjects, subject)
	}

	for start := 0; start < len(subjects); start += 50 {
		end := start + 50
		if end > len(subjects) {
			end = len(subjects)
		}
		var response dingTalkRosterListResponse
		err := p.postJSON(ctx, apiBase+"/v1.0/hrm/rosters/lists/query", token, map[string]any{
			"userIdList":         subjects[start:end],
			"fieldFilterList":    dingTalkPeopleRosterFieldCodes,
			"appAgentId":         agentID,
			"text2SelectConvert": true,
		}, &response)
		if err != nil || strings.TrimSpace(response.Code) != "" {
			return httperror.New(http.StatusBadGateway, "dingtalk_roster_fields_failed", dingTalkProviderFailureMessage("DingTalk Smart HR roster request failed; verify the application Agent ID and grant permission to read employee roster information", err, 0, ""))
		}
		for _, roster := range response.Result {
			index, exists := bySubject[strings.TrimSpace(roster.UserID)]
			if !exists {
				continue
			}
			for _, field := range roster.FieldDataList {
				applyDingTalkRosterField(&users[index], field)
			}
		}
	}
	return nil
}

func applyDingTalkRosterField(user *peoplejobs.User, field dingTalkRosterFieldData) {
	if user == nil {
		return
	}
	if user.SourceFieldStates == nil {
		user.SourceFieldStates = make(map[string]string)
	}
	value, present := dingTalkRosterFieldValueText(field.FieldValueList)
	state := dingTalkTextFieldState(present, value)
	switch strings.TrimSpace(field.FieldCode) {
	case "sys02-certNo":
		user.IDNumber = value
		user.SourceFieldStates["idNumber"] = state
	case "sys02-birthTime":
		user.BirthDate, user.SourceFieldStates["birthDate"] = dingTalkRosterDate(value, present, false)
	case "sys03-highestEdu":
		user.EducationLevel = value
		user.SourceFieldStates["educationLevel"] = state
	case "sys03-major":
		user.Major = value
		user.SourceFieldStates["major"] = state
	case "sys03-graduateSchool":
		user.GraduationSchool = value
		user.SourceFieldStates["graduationSchool"] = state
	case "sys03-graduationTime":
		user.GraduationDate, user.SourceFieldStates["graduationDate"] = dingTalkRosterDate(value, present, true)
	}
}

func dingTalkRosterFieldValueText(values []dingTalkRosterFieldValue) (string, bool) {
	if len(values) == 0 {
		return "", true
	}
	for _, item := range values {
		value := strings.TrimSpace(fmt.Sprint(item.Value))
		if value == "<nil>" {
			value = ""
		}
		if value == "" {
			value = strings.TrimSpace(item.Label)
		}
		if value != "" {
			return value, true
		}
	}
	return "", true
}

func dingTalkRosterDate(value string, present, allowMonth bool) (string, string) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", dingTalkTextFieldState(present, "")
	}
	if normalized := dingTalkDateValue(raw); normalized != "" {
		return normalized, "provided"
	}
	if normalized := normalizeDingTalkRosterTextDate(raw, allowMonth); normalized != "" {
		return normalized, "provided"
	}
	return raw, "invalid"
}

// normalizeDingTalkRosterTextDate accepts the textual representations emitted by
// Smart HR for date fields. Graduation time may be configured with month
// precision, while birth date must always include a calendar day.
func normalizeDingTalkRosterTextDate(value string, allowMonth bool) string {
	candidate := strings.TrimSpace(value)
	if separator := strings.IndexAny(candidate, "T "); separator >= 0 {
		candidate = candidate[:separator]
	}
	candidate = strings.NewReplacer("年", "-", "月", "-", "日", "", "/", "-", ".", "-").Replace(candidate)
	candidate = strings.TrimSuffix(candidate, "-")
	parts := strings.Split(candidate, "-")
	if len(parts) != 3 && !(allowMonth && len(parts) == 2) {
		return ""
	}
	year, yearErr := strconv.Atoi(parts[0])
	month, monthErr := strconv.Atoi(parts[1])
	if yearErr != nil || monthErr != nil {
		return ""
	}
	if len(parts) == 2 {
		normalized := fmt.Sprintf("%04d-%02d", year, month)
		if _, err := time.Parse("2006-01", normalized); err != nil {
			return ""
		}
		return normalized
	}
	day, dayErr := strconv.Atoi(parts[2])
	if dayErr != nil {
		return ""
	}
	normalized := fmt.Sprintf("%04d-%02d-%02d", year, month, day)
	if _, err := time.Parse("2006-01-02", normalized); err != nil {
		return ""
	}
	return normalized
}

func (p *DingTalkProvider) enrichDingTalkEmploymentFacts(ctx context.Context, apiBase, token string, users []peoplejobs.User) ([]peoplejobs.User, error) {
	bySubject := make(map[string]int, len(users))
	subjects := make([]string, 0, len(users))
	for index := range users {
		subject := strings.TrimSpace(users[index].ProviderSubject)
		if subject == "" {
			continue
		}
		bySubject[subject] = index
		subjects = append(subjects, subject)
	}

	nextToken := int64(0)
	for {
		query := url.Values{}
		query.Set("nextToken", fmt.Sprint(nextToken))
		query.Set("maxResults", "50")
		var response dingTalkDismissionsResponse
		if err := p.getJSON(ctx, apiBase+"/v1.0/hrm/employees/dismissions?"+query.Encode(), token, &response); err != nil {
			return nil, httperror.New(http.StatusBadGateway, "dingtalk_dismissions_failed", dingTalkProviderFailureMessage("DingTalk resigned employee list request failed; grant the application permission to read employee resignation information", err, 0, ""))
		}
		for _, rawSubject := range response.UserIDList {
			subject := strings.TrimSpace(rawSubject)
			if subject == "" {
				continue
			}
			if _, exists := bySubject[subject]; !exists {
				bySubject[subject] = len(users)
				users = append(users, peoplejobs.User{ProviderSubject: subject, EmploymentStatus: "left", Active: false})
				subjects = append(subjects, subject)
			}
		}
		if !response.HasMore {
			break
		}
		if response.NextToken <= nextToken {
			return nil, httperror.New(http.StatusBadGateway, "dingtalk_dismissions_cursor_invalid", "DingTalk resigned employee list returned an invalid pagination cursor")
		}
		nextToken = response.NextToken
	}

	for start := 0; start < len(subjects); start += 50 {
		end := start + 50
		if end > len(subjects) {
			end = len(subjects)
		}
		encodedSubjects, err := json.Marshal(subjects[start:end])
		if err != nil {
			return nil, err
		}
		query := url.Values{}
		query.Set("userIdList", string(encodedSubjects))
		var response dingTalkDimissionInfoResponse
		if err := p.getJSON(ctx, apiBase+"/v1.0/hrm/employees/dimissionInfos?"+query.Encode(), token, &response); err != nil {
			return nil, httperror.New(http.StatusBadGateway, "dingtalk_dimission_info_failed", dingTalkProviderFailureMessage("DingTalk employee resignation detail request failed; grant the application permission to read employee resignation information", err, 0, ""))
		}
		for _, fact := range response.Result {
			index, exists := bySubject[strings.TrimSpace(fact.UserID)]
			if !exists {
				continue
			}
			switch fact.Status {
			case 1:
				users[index].EmploymentStatus = "leaving"
				users[index].Active = true
			case 2:
				users[index].EmploymentStatus = "left"
				users[index].Active = false
			default:
				users[index].EmploymentStatus = "active"
				users[index].Active = true
			}
			if fact.Status == 1 || fact.Status == 2 {
				users[index].LeaveDate = dingTalkDate(fact.LastWorkDay)
				users[index].LeaveReason = first(fact.ReasonMemo, dingTalkReasonText(fact.VoluntaryReason), dingTalkReasonText(fact.PassiveReason))
				if fact.MainDeptID > 0 {
					users[index].PrimaryDepartmentID = fmt.Sprint(fact.MainDeptID)
				}
			}
		}
	}
	return users, nil
}

func dingTalkDate(milliseconds int64) string {
	if milliseconds <= 0 {
		return ""
	}
	shanghai := time.FixedZone("Asia/Shanghai", 8*60*60)
	return time.UnixMilli(milliseconds).In(shanghai).Format("2006-01-02")
}

// dingTalkFieldCoverage 统计受管字段的下发覆盖率。钉钉通讯录和智能人事接口
// 对无权读取或未配置的字段可能直接省略，因此“整批一条都没有”是权限缺失
// 最直接、也是唯一可得的信号。
// 只统计在职用户：离职补录条目本来就只带 providerSubject。
func dingTalkFieldCoverage(users []peoplejobs.User) ([]peoplejobs.FieldCoverage, []string) {
	fields := []struct {
		name  string
		value func(peoplejobs.User) string
	}{
		{"onboardDate", func(user peoplejobs.User) string { return user.OnboardDate }},
		{"mobile", func(user peoplejobs.User) string { return user.Mobile }},
		{"email", func(user peoplejobs.User) string { return user.Email }},
		{"idNumber", func(user peoplejobs.User) string { return user.IDNumber }},
		{"birthDate", func(user peoplejobs.User) string { return user.BirthDate }},
		{"educationLevel", func(user peoplejobs.User) string { return user.EducationLevel }},
		{"major", func(user peoplejobs.User) string { return user.Major }},
		{"graduationSchool", func(user peoplejobs.User) string { return user.GraduationSchool }},
		{"graduationDate", func(user peoplejobs.User) string { return user.GraduationDate }},
	}

	coverage := make([]peoplejobs.FieldCoverage, 0, len(fields))
	missing := []string{}
	for _, field := range fields {
		observed, provided, empty, absent, invalid := 0, 0, 0, 0, 0
		for _, user := range users {
			if !user.Active {
				continue
			}
			observed++
			state := user.SourceFieldStates[field.name]
			if state == "" {
				if strings.TrimSpace(field.value(user)) != "" {
					state = "provided"
				} else {
					state = "absent"
				}
			}
			switch state {
			case "provided":
				provided++
			case "empty":
				empty++
			case "invalid":
				invalid++
			default:
				absent++
			}
		}
		coverage = append(coverage, peoplejobs.FieldCoverage{
			Field: field.name, Provided: provided, Empty: empty,
			Absent: absent, Invalid: invalid, Observed: observed,
		})
		if observed > 0 && absent == observed {
			missing = append(missing, field.name)
		}
	}
	if len(missing) == 0 {
		return coverage, nil
	}
	return coverage, missing
}

func dingTalkTextFieldState(present bool, value string) string {
	if strings.TrimSpace(value) != "" {
		return "provided"
	}
	if present {
		return "empty"
	}
	return "absent"
}

func dingTalkOnboardDateState(item dingTalkUserListItem) (string, string) {
	normalized := dingTalkDateValue(item.HiredDate)
	if normalized != "" {
		return normalized, "provided"
	}
	raw := strings.TrimSpace(fmt.Sprint(item.HiredDate))
	if raw != "" && raw != "<nil>" {
		return raw, "invalid"
	}
	if item.present["hired_date"] {
		return "", "empty"
	}
	return "", "absent"
}

func dingTalkDateValue(value any) string {
	raw := strings.TrimSpace(fmt.Sprint(value))
	if raw == "" || raw == "<nil>" {
		return ""
	}
	if milliseconds, err := strconv.ParseInt(raw, 10, 64); err == nil {
		return dingTalkDate(milliseconds)
	}
	milliseconds, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return ""
	}
	return dingTalkDate(int64(milliseconds))
}

func dingTalkReasonText(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []string:
		return strings.Join(typed, "、")
	case []any:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			if normalized := strings.TrimSpace(fmt.Sprint(item)); normalized != "" {
				values = append(values, normalized)
			}
		}
		return strings.Join(values, "、")
	default:
		return ""
	}
}

func hasObjectScope(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func dingTalkProviderFailureMessage(message string, err error, providerCode int, requiredPermission string) string {
	if providerCode == 88 && requiredPermission != "" {
		return fmt.Sprintf("%s (requires DingTalk permission %s; provider code %d)", message, requiredPermission, providerCode)
	}
	if providerCode != 0 {
		return fmt.Sprintf("%s (provider code %d)", message, providerCode)
	}
	if responseErr, ok := err.(*dingTalkAPIResponseError); ok {
		return fmt.Sprintf("%s (HTTP %d)", message, responseErr.StatusCode)
	}
	return message
}

func (p *DingTalkProvider) configuration(ctx context.Context, integrationCode string, usage dingTalkConfigurationUsage) (dingTalkConfiguration, error) {
	integration, err := p.console.Integration(ctx, integrationCode)
	if err != nil {
		return dingTalkConfiguration{}, err
	}
	if integration.ProviderCode != "" && integration.ProviderCode != "dingtalk" {
		return dingTalkConfiguration{}, httperror.New(http.StatusBadGateway, "dingtalk_integration_invalid", "DingTalk integration provider is invalid")
	}
	if integration.CurrentCredential == nil {
		return dingTalkConfiguration{}, httperror.New(http.StatusBadGateway, "dingtalk_secret_unconfigured", "DingTalk integration credential is not configured")
	}
	secret, err := p.console.ResolveSecret(ctx, integrationCode)
	if err != nil {
		return dingTalkConfiguration{}, err
	}
	identityClientID := first(stringFromMap(integration.Config, "oauthClientId"), stringFromMap(integration.Config, "loginClientId"), stringFromMap(integration.Config, "clientId"), stringFromMap(integration.Config, "appId"), stringFromMap(integration.Config, "appKey"))
	appKey := first(stringFromMap(integration.Config, "appKey"), stringFromMap(integration.Config, "clientId"), stringFromMap(integration.Config, "appId"), identityClientID)
	corpID := first(stringFromMap(integration.Config, "corpId"), stringFromMap(integration.Config, "corp_id"))
	robotCode := first(stringFromMap(integration.Config, "robotCode"), appKey)
	agentID := int64(0)
	if rawAgentID := first(stringFromMap(integration.Config, "agentId"), stringFromMap(integration.Config, "appAgentId"), stringFromMap(integration.Config, "agentid"), stringFromMap(integration.Config, "agent_id")); rawAgentID != "" {
		parsedAgentID, parseErr := strconv.ParseInt(rawAgentID, 10, 64)
		if parseErr == nil && parsedAgentID > 0 {
			agentID = parsedAgentID
		}
	}
	if secret.Value == "" || appKey == "" {
		return dingTalkConfiguration{}, httperror.New(http.StatusBadGateway, "dingtalk_config_incomplete", "DingTalk application identifier or client secret is missing")
	}
	if usage == dingTalkIdentityUsage && identityClientID == "" {
		return dingTalkConfiguration{}, httperror.New(http.StatusBadGateway, "dingtalk_identity_config_incomplete", "DingTalk OAuth client ID is missing")
	}
	if usage == dingTalkNotificationUsage && robotCode == "" {
		return dingTalkConfiguration{}, httperror.New(http.StatusBadGateway, "dingtalk_notification_config_incomplete", "DingTalk robotCode is missing")
	}
	return dingTalkConfiguration{
		Integration: integration, Secret: secret, AppKey: appKey, AgentID: agentID,
		IdentityClientID: identityClientID, CorpID: corpID, RobotCode: robotCode,
	}, nil
}

func ValidateDingTalkAPIBaseURL(value string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "api.dingtalk.com" || (parsed.Port() != "" && parsed.Port() != "443") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.EscapedPath() != "" && parsed.EscapedPath() != "/") {
		return "", httperror.New(http.StatusBadGateway, "dingtalk_endpoint_not_allowed", "DingTalk integration endpoint is not allowed")
	}
	return DefaultDingTalkAPIBaseURL, nil
}

func (p *DingTalkProvider) accessToken(ctx context.Context, baseURL, integrationCode, appKey, appSecret string, versionNo int) (string, error) {
	cacheKey := fmt.Sprintf("%s|%d", integrationCode, versionNo)
	p.mutex.Lock()
	cached := p.tokens[cacheKey]
	p.mutex.Unlock()
	if cached.AccessToken != "" && cached.ExpiresAt.After(time.Now().Add(60*time.Second)) {
		return cached.AccessToken, nil
	}
	var response dingTalkAppTokenResponse
	if err := p.postJSON(ctx, baseURL+"/v1.0/oauth2/accessToken", "", map[string]string{"appKey": appKey, "appSecret": appSecret}, &response); err != nil || response.AccessToken == "" {
		return "", httperror.New(http.StatusBadGateway, "dingtalk_token_error", "DingTalk app token request was rejected")
	}
	expiresIn := response.ExpireIn
	if expiresIn <= 0 {
		expiresIn = 7200
	}
	p.mutex.Lock()
	p.tokens[cacheKey] = wecomToken{AccessToken: response.AccessToken, ExpiresAt: time.Now().Add(time.Duration(expiresIn) * time.Second)}
	p.mutex.Unlock()
	return response.AccessToken, nil
}

func (p *DingTalkProvider) postJSON(ctx context.Context, endpoint, accessToken string, input any, output any) error {
	body, _ := json.Marshal(input)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if accessToken != "" {
		req.Header.Set("x-acs-dingtalk-access-token", accessToken)
	}
	return p.doJSON(req, output)
}

func (p *DingTalkProvider) getJSON(ctx context.Context, endpoint, accessToken string, output any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("x-acs-dingtalk-access-token", accessToken)
	return p.doJSON(req, output)
}

func (p *DingTalkProvider) doJSON(req *http.Request, output any) error {
	resp, err := p.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return httperror.New(http.StatusBadGateway, "dingtalk_response_invalid", "DingTalk API returned an invalid response")
	}
	if resp.StatusCode >= 400 {
		return &dingTalkAPIResponseError{StatusCode: resp.StatusCode}
	}
	if err := json.Unmarshal(body, output); err != nil {
		return httperror.New(http.StatusBadGateway, "dingtalk_response_invalid", "DingTalk API returned an invalid response")
	}
	return nil
}
