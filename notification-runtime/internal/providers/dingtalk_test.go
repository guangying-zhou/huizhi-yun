package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	consoleclient "github.com/huizhi-yun/notification-runtime/internal/console"
	"github.com/huizhi-yun/notification-runtime/internal/peoplejobs"
)

type fakeDingTalkConfigClient struct{}

func TestDingTalkDateValue(t *testing.T) {
	shanghai := time.FixedZone("Asia/Shanghai", 8*60*60)
	milliseconds := time.Date(2025, 3, 4, 0, 0, 0, 0, shanghai).UnixMilli()
	tests := []struct {
		name  string
		value any
		want  string
	}{
		{name: "integer string", value: fmt.Sprint(milliseconds), want: "2025-03-04"},
		{name: "float64", value: float64(milliseconds), want: "2025-03-04"},
		{name: "scientific notation", value: fmt.Sprintf("%e", float64(milliseconds)), want: "2025-03-04"},
		{name: "nil", value: nil, want: ""},
		{name: "empty string", value: "", want: ""},
		{name: "invalid", value: "not-a-timestamp", want: ""},
		{name: "zero", value: int64(0), want: ""},
		{name: "negative", value: int64(-1), want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := dingTalkDateValue(tt.value); got != tt.want {
				t.Fatalf("dingTalkDateValue(%v) = %q, want %q", tt.value, got, tt.want)
			}
		})
	}
}

type fakeDingTalkSubtreeConfigClient struct{ fakeDingTalkConfigClient }

func (fakeDingTalkSubtreeConfigClient) Integration(context.Context, string) (consoleclient.Integration, error) {
	return consoleclient.Integration{
		IntegrationCode: "dingtalk.default", ProviderCode: "dingtalk", BaseURL: DefaultDingTalkAPIBaseURL,
		Config: map[string]any{"appKey": "ding-app", "rootDeptId": "2"}, CurrentCredential: &consoleclient.Credential{VersionNo: 3},
	}, nil
}

func (fakeDingTalkConfigClient) Integration(context.Context, string) (consoleclient.Integration, error) {
	return consoleclient.Integration{
		IntegrationCode:   "dingtalk.default",
		ProviderCode:      "dingtalk",
		BaseURL:           DefaultDingTalkAPIBaseURL,
		Config:            map[string]any{"appKey": "ding-app", "agentId": "2345185741", "oauthClientId": "unified-login-app", "corpId": "ding-corp", "robotCode": "ding-robot"},
		CurrentCredential: &consoleclient.Credential{VersionNo: 3},
	}, nil
}

type fakeDingTalkIdentityConfigClient struct{}

func (fakeDingTalkIdentityConfigClient) Integration(_ context.Context, integrationCode string) (consoleclient.Integration, error) {
	return consoleclient.Integration{
		IntegrationCode:   integrationCode,
		ProviderCode:      "dingtalk",
		BaseURL:           DefaultDingTalkAPIBaseURL,
		Config:            map[string]any{"oauthClientId": "identity-client", "corpId": "ding-corp"},
		CurrentCredential: &consoleclient.Credential{VersionNo: 7},
	}, nil
}

func (fakeDingTalkIdentityConfigClient) ResolveSecret(context.Context, string) (consoleclient.Secret, error) {
	return consoleclient.Secret{Value: "identity-client-secret", VersionNo: 7}, nil
}

func (fakeDingTalkConfigClient) ResolveSecret(context.Context, string) (consoleclient.Secret, error) {
	return consoleclient.Secret{Value: "vault-app-secret", VersionNo: 3}, nil
}

func TestDingTalkIdentityExchangeReturnsOnlyDirectoryMemberID(t *testing.T) {
	paths := make([]string, 0, 4)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		paths = append(paths, request.URL.Host+request.URL.Path)
		switch request.URL.Path {
		case "/v1.0/oauth2/userAccessToken":
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["clientId"] != "unified-login-app" || body["clientSecret"] != "vault-app-secret" {
				t.Fatalf("identity exchange did not use the dedicated OAuth client: %#v", body)
			}
			return jsonResponse(`{"accessToken":"user-token","refreshToken":"must-not-escape","corpId":"ding-corp"}`), nil
		case "/v1.0/contact/users/me":
			if request.Header.Get("x-acs-dingtalk-access-token") != "user-token" {
				t.Fatal("missing user access token")
			}
			return jsonResponse(`{"unionId":"union-1","openId":"must-not-escape","visitor":false}`), nil
		case "/v1.0/oauth2/accessToken":
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["appKey"] != "ding-app" || body["appSecret"] != "vault-app-secret" {
				t.Fatalf("app access token did not keep the application AppKey: %#v", body)
			}
			return jsonResponse(`{"accessToken":"app-token","expireIn":7200}`), nil
		case "/topapi/user/getbyunionid":
			return jsonResponse(`{"errcode":0,"result":{"userid":"staff-1001"}}`), nil
		default:
			t.Fatalf("unexpected DingTalk path: %s", request.URL.Path)
			return nil, nil
		}
	})}
	provider := newDingTalkProvider(fakeDingTalkConfigClient{}, client)
	result, err := provider.ExchangeIdentity(context.Background(), DingTalkIdentityExchangeRequest{AuthorizationCode: "one-time-code"})
	if err != nil {
		t.Fatalf("ExchangeIdentity error: %v", err)
	}
	encoded, _ := json.Marshal(result)
	if result.Provider != "dingtalk" || result.IntegrationCode != "dingtalk.default" || result.Subject.ID != "staff-1001" || result.Subject.Kind != "member" {
		t.Fatalf("unexpected identity result: %+v", result)
	}
	if strings.Contains(string(encoded), "token") || strings.Contains(string(encoded), "union-1") || strings.Contains(string(encoded), "openId") {
		t.Fatalf("provider credential or raw identity escaped: %s", encoded)
	}
	if strings.Join(paths, ",") != "api.dingtalk.com/v1.0/oauth2/userAccessToken,api.dingtalk.com/v1.0/contact/users/me,api.dingtalk.com/v1.0/oauth2/accessToken,oapi.dingtalk.com/topapi/user/getbyunionid" {
		t.Fatalf("unexpected fixed endpoint sequence: %v", paths)
	}
}

func TestDingTalkIdentityIntegrationDoesNotRequireRobotConfiguration(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Path {
		case "/v1.0/oauth2/userAccessToken":
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["clientId"] != "identity-client" || body["clientSecret"] != "identity-client-secret" {
				t.Fatalf("dedicated identity credential was not used: %#v", body)
			}
			return jsonResponse(`{"accessToken":"user-token","corpId":"ding-corp"}`), nil
		case "/v1.0/contact/users/me":
			return jsonResponse(`{"unionId":"union-identity","visitor":false}`), nil
		case "/v1.0/oauth2/accessToken":
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["appKey"] != "identity-client" || body["appSecret"] != "identity-client-secret" {
				t.Fatalf("identity mapping did not use its own application credential: %#v", body)
			}
			return jsonResponse(`{"accessToken":"app-token","expireIn":7200}`), nil
		case "/topapi/user/getbyunionid":
			return jsonResponse(`{"errcode":0,"result":{"userid":"staff-identity"}}`), nil
		default:
			t.Fatalf("unexpected DingTalk path: %s", request.URL.Path)
			return nil, nil
		}
	})}
	provider := newDingTalkProvider(fakeDingTalkIdentityConfigClient{}, client)
	result, err := provider.ExchangeIdentity(context.Background(), DingTalkIdentityExchangeRequest{
		IntegrationCode: "dingtalk.identity", AuthorizationCode: "one-time-code",
	})
	if err != nil {
		t.Fatalf("ExchangeIdentity error: %v", err)
	}
	if result.IntegrationCode != "dingtalk.identity" || result.Subject.ID != "staff-identity" {
		t.Fatalf("unexpected identity result: %+v", result)
	}
}

func TestDingTalkSendUsesTypedRobotMessageAndRejectsDynamicOrigin(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Path {
		case "/v1.0/oauth2/accessToken":
			return jsonResponse(`{"accessToken":"app-token","expireIn":7200}`), nil
		case "/v1.0/robot/oToMessages/batchSend":
			if request.Header.Get("x-acs-dingtalk-access-token") != "app-token" {
				t.Fatal("missing app access token")
			}
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["robotCode"] != "ding-robot" || body["msgKey"] != "sampleMarkdown" {
				t.Fatalf("unexpected body: %#v", body)
			}
			return jsonResponse(`{"processQueryKey":"process-1","invalidStaffIdList":[],"flowControlledStaffIdList":[]}`), nil
		default:
			t.Fatalf("unexpected DingTalk path: %s", request.URL.Path)
			return nil, nil
		}
	})}
	provider := newDingTalkProvider(fakeDingTalkConfigClient{}, client)
	result, err := provider.Send(context.Background(), SendRequest{
		Channel: "dingtalk", IntegrationCode: "dingtalk.default", ToUser: []string{"staff-1001"},
		Title: "审批待处理", Description: "你有一个审批任务", URL: "https://wiztek.huizhi.yun/workflow/tasks/1", IdempotencyKey: "task:1",
	})
	if err != nil || result.ProviderResult["processQueryKey"] != "process-1" {
		t.Fatalf("send result=%+v err=%v", result, err)
	}
	if _, err := ValidateDingTalkAPIBaseURL("https://attacker.example"); err == nil {
		t.Fatal("dynamic DingTalk origin was accepted")
	}
}

func TestDingTalkPeopleSyncReturnsSafeProviderErrorCode(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Path {
		case "/v1.0/oauth2/accessToken":
			return jsonResponse(`{"accessToken":"app-token","expireIn":7200}`), nil
		case "/topapi/v2/department/get":
			return jsonResponse(`{"errcode":0,"result":{"dept_id":1,"name":"测试企业","parent_id":0,"order":1}}`), nil
		case "/topapi/v2/department/listsub":
			return jsonResponse(`{"errcode":60011,"errmsg":"no permission for department"}`), nil
		default:
			t.Fatalf("unexpected DingTalk path: %s", request.URL.Path)
			return nil, nil
		}
	})}
	provider := newDingTalkProvider(fakeDingTalkConfigClient{}, client)
	_, err := provider.RunPeopleSync(context.Background(), peoplejobs.StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"organization", "people"},
	}, func(peoplejobs.Batch) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "provider code 60011") {
		t.Fatalf("expected safe provider error code, got %v", err)
	}
	if strings.Contains(err.Error(), "app-token") || strings.Contains(err.Error(), "no permission for department") {
		t.Fatalf("provider secret or untrusted message escaped: %v", err)
	}
}

func TestDingTalkPeopleSyncRequiresApplicationAgentIDBeforeProviderCalls(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		t.Fatalf("DingTalk must not be called without a configured application Agent ID: %s", request.URL.Path)
		return nil, nil
	})}
	provider := newDingTalkProvider(fakeDingTalkIdentityConfigClient{}, client)
	_, err := provider.RunPeopleSync(context.Background(), peoplejobs.StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"people"},
	}, func(peoplejobs.Batch) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "numeric Agent ID") {
		t.Fatalf("expected actionable Agent ID error, got %v", err)
	}
}

func TestDingTalkPeopleSyncMapsRequiredDirectoryPermissions(t *testing.T) {
	tests := []struct {
		name               string
		departmentResponse string
		userResponse       string
		permission         string
	}{
		{
			name:               "department list",
			departmentResponse: `{"errcode":88,"errmsg":"permission denied"}`,
			permission:         "qyapi_get_department_list",
		},
		{
			name:               "department member list",
			departmentResponse: `{"errcode":0,"result":[]}`,
			userResponse:       `{"errcode":88,"errmsg":"permission denied"}`,
			permission:         "qyapi_get_department_member",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
				switch request.URL.Path {
				case "/v1.0/oauth2/accessToken":
					return jsonResponse(`{"accessToken":"app-token","expireIn":7200}`), nil
				case "/topapi/v2/department/get":
					return jsonResponse(`{"errcode":0,"result":{"dept_id":1,"name":"测试企业","parent_id":0,"order":1}}`), nil
				case "/topapi/v2/department/listsub":
					return jsonResponse(tt.departmentResponse), nil
				case "/topapi/v2/user/list":
					return jsonResponse(tt.userResponse), nil
				default:
					t.Fatalf("unexpected DingTalk path: %s", request.URL.Path)
					return nil, nil
				}
			})}
			provider := newDingTalkProvider(fakeDingTalkConfigClient{}, client)
			_, err := provider.RunPeopleSync(context.Background(), peoplejobs.StartRequest{
				Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"organization", "people"},
			}, func(peoplejobs.Batch) error { return nil })
			if err == nil || !strings.Contains(err.Error(), "requires DingTalk permission "+tt.permission) {
				t.Fatalf("expected actionable permission %s, got %v", tt.permission, err)
			}
			if strings.Contains(err.Error(), "app-token") || strings.Contains(err.Error(), "permission denied") {
				t.Fatalf("provider secret or untrusted message escaped: %v", err)
			}
		})
	}
}

func TestDingTalkPeopleSyncUsesExplicitResignationFacts(t *testing.T) {
	hiredDate := time.Date(2025, 3, 4, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 8*60*60)).UnixMilli()
	lastWorkDay := time.Date(2026, 7, 31, 0, 0, 0, 0, time.FixedZone("Asia/Shanghai", 8*60*60)).UnixMilli()
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Path {
		case "/v1.0/oauth2/accessToken":
			return jsonResponse(`{"accessToken":"app-token","expireIn":7200}`), nil
		case "/topapi/v2/department/get":
			return jsonResponse(`{"errcode":0,"result":{"dept_id":1,"name":"测试企业","parent_id":0,"order":1}}`), nil
		case "/topapi/v2/department/listsub":
			return jsonResponse(`{"errcode":0,"result":[]}`), nil
		case "/topapi/v2/user/list":
			return jsonResponse(fmt.Sprintf(`{"errcode":0,"result":{"has_more":false,"list":[{"userid":"staff-active","name":"张三","job_number":"E001","email":"zhangsan@example.com","dept_id_list":[1],"hired_date":%d}]}}`, hiredDate)), nil
		case "/v1.0/hrm/rosters/lists/query":
			if request.Header.Get("x-acs-dingtalk-access-token") != "app-token" {
				t.Fatal("missing DingTalk app access token for roster query")
			}
			var body struct {
				UserIDList         []string `json:"userIdList"`
				FieldFilterList    []string `json:"fieldFilterList"`
				AppAgentID         int64    `json:"appAgentId"`
				Text2SelectConvert bool     `json:"text2SelectConvert"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(body.UserIDList, []string{"staff-active"}) || !slices.Equal(body.FieldFilterList, dingTalkPeopleRosterFieldCodes) || body.AppAgentID != 2345185741 || !body.Text2SelectConvert {
				t.Fatalf("unexpected roster query: %#v", body)
			}
			return jsonResponse(`{"result":[{"userId":"staff-active","fieldDataList":[
				{"fieldCode":"sys02-certNo","fieldValueList":[{"value":"110101199001011234"}]},
				{"fieldCode":"sys02-birthTime","fieldValueList":[{"value":"1990-01-02"}]},
				{"fieldCode":"sys03-highestEdu","fieldValueList":[{"value":"本科"}]},
				{"fieldCode":"sys03-major","fieldValueList":[{"value":"计算机科学与技术"}]},
				{"fieldCode":"sys03-graduateSchool","fieldValueList":[{"value":"测试大学"}]},
				{"fieldCode":"sys03-graduationTime","fieldValueList":[{"value":"2012年6月"}]}
			]}]}`), nil
		case "/v1.0/hrm/employees/dismissions":
			if request.URL.Query().Get("maxResults") != "50" {
				t.Fatalf("unexpected dismission page size: %s", request.URL.RawQuery)
			}
			return jsonResponse(`{"nextToken":0,"hasMore":false,"userIdList":["staff-left"]}`), nil
		case "/v1.0/hrm/employees/dimissionInfos":
			var subjects []string
			if err := json.Unmarshal([]byte(request.URL.Query().Get("userIdList")), &subjects); err != nil {
				t.Fatalf("invalid resignation subject query: %v", err)
			}
			if strings.Join(subjects, ",") != "staff-active,staff-left" {
				t.Fatalf("unexpected resignation subjects: %v", subjects)
			}
			return jsonResponse(fmt.Sprintf(`{"result":[
				{"userId":"staff-active","lastWorkDay":%d,"status":1,"mainDeptId":1,"voluntaryReason":["个人原因","家庭原因"]},
				{"userId":"staff-left","lastWorkDay":%d,"status":2,"mainDeptId":1,"reasonMemo":"completed"}
			]}`, lastWorkDay, lastWorkDay)), nil
		default:
			t.Fatalf("unexpected DingTalk path: %s", request.URL.Path)
			return nil, nil
		}
	})}
	provider := newDingTalkProvider(fakeDingTalkConfigClient{}, client)
	var emitted []peoplejobs.Batch
	counts, err := provider.RunPeopleSync(context.Background(), peoplejobs.StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default",
		ObjectScopes: []string{"organization", "people"},
	}, func(batch peoplejobs.Batch) error {
		emitted = append(emitted, batch)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	var users []peoplejobs.User
	for _, batch := range emitted {
		users = append(users, batch.Users...)
	}
	if counts.Users != 2 || len(users) != 2 {
		t.Fatalf("counts=%#v users=%#v", counts, users)
	}
	if users[0].EmploymentStatus != "leaving" || !users[0].Active || users[0].OnboardDate != "2025-03-04" ||
		users[0].LeaveDate != "2026-07-31" || users[0].LeaveReason != "个人原因、家庭原因" || users[0].PrimaryDepartmentID != "1" {
		t.Fatalf("pending departure was not preserved: %#v", users[0])
	}
	if users[0].IDNumber != "110101199001011234" || users[0].BirthDate != "1990-01-02" || users[0].EducationLevel != "本科" ||
		users[0].Major != "计算机科学与技术" || users[0].GraduationSchool != "测试大学" || users[0].GraduationDate != "2012-06" {
		t.Fatalf("Smart HR roster facts were not mapped: %#v", users[0])
	}
	if users[0].EmployeeNumber != "" {
		t.Fatalf("DingTalk job number must not become a People employee number: %#v", users[0])
	}
	for _, field := range counts.FieldCoverage {
		if field.Field == "employeeNumber" {
			t.Fatalf("DingTalk employee number must not be reported as a managed field: %#v", counts.FieldCoverage)
		}
	}
	if users[1].ProviderSubject != "staff-left" || users[1].EmploymentStatus != "left" || users[1].Active || users[1].LeaveDate != "2026-07-31" {
		t.Fatalf("completed departure was not emitted: %#v", users[1])
	}
}

func TestDingTalkPeopleSyncEmitsCompleteOrganizationSnapshotEvidence(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		switch request.URL.Path {
		case "/v1.0/oauth2/accessToken":
			return jsonResponse(`{"accessToken":"app-token","expireIn":7200}`), nil
		case "/topapi/v2/department/get":
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if fmt.Sprint(body["dept_id"]) == "2" {
				return jsonResponse(`{"errcode":0,"result":{"dept_id":2,"name":"研发部","parent_id":1,"order":200,"dept_manager_userid_list":["staff-manager"]}}`), nil
			}
			return jsonResponse(`{"errcode":0,"result":{"dept_id":1,"name":"测试企业","parent_id":0,"order":100,"dept_manager_userid_list":["staff-root"]}}`), nil
		case "/topapi/v2/department/listsub":
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if fmt.Sprint(body["dept_id"]) == "1" {
				return jsonResponse(`{"errcode":0,"result":[{"dept_id":2,"name":"研发部","parent_id":1}]}`), nil
			}
			return jsonResponse(`{"errcode":0,"result":[]}`), nil
		default:
			t.Fatalf("unexpected DingTalk path: %s", request.URL.Path)
			return nil, nil
		}
	})}
	provider := newDingTalkProvider(fakeDingTalkConfigClient{}, client)
	var emitted []peoplejobs.Batch
	counts, err := provider.RunPeopleSync(context.Background(), peoplejobs.StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"organization"},
	}, func(batch peoplejobs.Batch) error {
		emitted = append(emitted, batch)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if counts.Departments != 2 || len(emitted) != 2 {
		t.Fatalf("counts=%#v batches=%#v", counts, emitted)
	}
	if emitted[0].OrganizationRootDepartmentID != "1" || len(emitted[0].Departments) != 2 {
		t.Fatalf("organization batch metadata missing: %#v", emitted[0])
	}
	root, child := emitted[0].Departments[0], emitted[0].Departments[1]
	if root.Name != "测试企业" || root.SortOrder != 10 || root.ManagerSubject != "staff-root" {
		t.Fatalf("root department detail not normalized: %#v", root)
	}
	if child.ParentProviderID != "1" || child.SortOrder != 10 || child.ManagerSubject != "staff-manager" {
		t.Fatalf("child department detail not normalized: %#v", child)
	}
	final := emitted[1]
	if !final.Final || !final.OrganizationSnapshotComplete || final.OrganizationDepartmentCount != 2 || final.OrganizationRootDepartmentID != "1" || len(final.OrganizationSnapshotHash) != 64 {
		t.Fatalf("final organization evidence invalid: %#v", final)
	}
}

func TestDingTalkPeopleSyncRejectsSubtreeAsCompleteHRSource(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/v1.0/oauth2/accessToken" {
			t.Fatalf("subtree must be rejected before reading departments: %s", request.URL.Path)
		}
		return jsonResponse(`{"accessToken":"app-token","expireIn":7200}`), nil
	})}
	provider := newDingTalkProvider(fakeDingTalkSubtreeConfigClient{}, client)
	_, err := provider.RunPeopleSync(context.Background(), peoplejobs.StartRequest{
		Provider: "dingtalk", IntegrationCode: "dingtalk.default", ObjectScopes: []string{"organization"},
	}, func(peoplejobs.Batch) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "provider root department") {
		t.Fatalf("subtree error=%v", err)
	}
}

func TestDingTalkFieldCoverageFlagsSilentlyMissingPermissionFields(t *testing.T) {
	// 钉钉缺少「员工手机号」「员工入职信息」权限时，字段被整体省略而
	// 接口仍返回 errcode=0。整批零下发是唯一可得的信号。
	coverage, missing := dingTalkFieldCoverage([]peoplejobs.User{
		{ProviderSubject: "u1", Name: "Alice", Email: "a@example.com", Active: true,
			SourceFieldStates: map[string]string{"onboardDate": "absent", "mobile": "absent", "email": "provided"}},
		{ProviderSubject: "u2", Name: "Bob", Email: "b@example.com", Active: true,
			SourceFieldStates: map[string]string{"onboardDate": "absent", "mobile": "absent", "email": "provided"}},
	})

	if !slices.Equal(missing, []string{"onboardDate", "mobile", "idNumber", "birthDate", "educationLevel", "major", "graduationSchool", "graduationDate"}) {
		t.Fatalf("missing=%v", missing)
	}
	for _, item := range coverage {
		switch item.Field {
		case "onboardDate", "mobile", "idNumber", "birthDate", "educationLevel", "major", "graduationSchool", "graduationDate":
			if item.Provided != 0 || item.Absent != 2 || item.Empty != 0 || item.Invalid != 0 || item.Observed != 2 {
				t.Fatalf("%s coverage=%#v", item.Field, item)
			}
		case "email":
			if item.Provided != 2 || item.Observed != 2 {
				t.Fatalf("%s coverage=%#v", item.Field, item)
			}
		}
	}
}

func TestDingTalkFieldCoverageIgnoresDismissedPlaceholdersAndPartialRows(t *testing.T) {
	coverage, missing := dingTalkFieldCoverage([]peoplejobs.User{
		{ProviderSubject: "u1", Email: "a@example.com", Mobile: "13800000000", OnboardDate: "2025-03-04", Active: true,
			SourceFieldStates: map[string]string{"onboardDate": "provided", "mobile": "provided", "email": "provided", "idNumber": "provided", "birthDate": "provided", "educationLevel": "provided", "major": "provided", "graduationSchool": "provided", "graduationDate": "provided"}},
		{ProviderSubject: "u2", Email: "b@example.com", Active: true,
			SourceFieldStates: map[string]string{"onboardDate": "invalid", "mobile": "empty", "email": "provided", "idNumber": "empty", "birthDate": "empty", "educationLevel": "empty", "major": "empty", "graduationSchool": "empty", "graduationDate": "empty"}},
		// 离职补录条目只带 providerSubject，不应把整批拉成“字段缺失”。
		{ProviderSubject: "u3", EmploymentStatus: "left", Active: false},
	})

	if missing != nil {
		t.Fatalf("missing=%v, want nil when at least one active user carries each field", missing)
	}
	for _, item := range coverage {
		if item.Observed != 2 {
			t.Fatalf("%s observed=%d, want only active users counted", item.Field, item.Observed)
		}
		if item.Field == "mobile" && item.Provided != 1 {
			t.Fatalf("mobile coverage=%#v", item)
		}
		if item.Field == "mobile" && item.Empty != 1 {
			t.Fatalf("mobile empty coverage=%#v", item)
		}
		if item.Field == "onboardDate" && item.Invalid != 1 {
			t.Fatalf("onboard date invalid coverage=%#v", item)
		}
	}
}

func TestDingTalkUserPresencePreservesAbsentEmptyAndInvalidFields(t *testing.T) {
	var response dingTalkUserListResponse
	if err := json.Unmarshal([]byte(`{"result":{"list":[{"userid":"u1","name":"Alice","mobile":"","hired_date":"not-a-date"}]}}`), &response); err != nil {
		t.Fatal(err)
	}
	item := response.Result.List[0]
	onboardDate, onboardState := dingTalkOnboardDateState(item)
	user := peoplejobs.User{
		ProviderSubject: item.UserID,
		Name:            item.Name,
		Mobile:          item.Mobile,
		OnboardDate:     onboardDate,
		Active:          true,
		SourceFieldStates: map[string]string{
			"email":       dingTalkTextFieldState(item.present["email"] || item.present["org_email"], first(item.Email, item.OrgEmail)),
			"mobile":      dingTalkTextFieldState(item.present["mobile"], item.Mobile),
			"onboardDate": onboardState,
		},
	}
	encoded, err := json.Marshal(user)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err = json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	if _, ok := payload["email"]; ok {
		t.Fatalf("absent email must stay absent: %s", encoded)
	}
	if _, ok := payload["employeeNumber"]; ok {
		t.Fatalf("DingTalk employee number must stay absent: %s", encoded)
	}
	if value, ok := payload["mobile"]; !ok || value != "" {
		t.Fatalf("explicit empty mobile must survive JSON: %s", encoded)
	}
	if payload["onboardDate"] != "not-a-date" {
		t.Fatalf("invalid date must reach People field validation: %s", encoded)
	}
}

func TestDingTalkRosterFieldMappingPreservesEmptyAndInvalidStates(t *testing.T) {
	user := peoplejobs.User{SourceFieldStates: map[string]string{}}
	applyDingTalkRosterField(&user, dingTalkRosterFieldData{FieldCode: "sys03-highestEdu", FieldValueList: []dingTalkRosterFieldValue{{Label: "本科"}}})
	applyDingTalkRosterField(&user, dingTalkRosterFieldData{FieldCode: "sys02-certNo", FieldValueList: []dingTalkRosterFieldValue{}})
	applyDingTalkRosterField(&user, dingTalkRosterFieldData{FieldCode: "sys02-birthTime", FieldValueList: []dingTalkRosterFieldValue{{Value: "not-a-date"}}})
	if user.EducationLevel != "本科" || user.SourceFieldStates["educationLevel"] != "provided" {
		t.Fatalf("selection label was not mapped: %#v", user)
	}
	if user.IDNumber != "" || user.SourceFieldStates["idNumber"] != "empty" {
		t.Fatalf("explicit empty roster field was not preserved: %#v", user)
	}
	if user.BirthDate != "not-a-date" || user.SourceFieldStates["birthDate"] != "invalid" {
		t.Fatalf("invalid roster date was not preserved: %#v", user)
	}
}

func TestDingTalkRosterDateNormalizesTextFormatsAndGraduationMonth(t *testing.T) {
	tests := []struct {
		name       string
		value      string
		allowMonth bool
		want       string
		wantState  string
	}{
		{name: "slash date", value: "2012/6/30", want: "2012-06-30", wantState: "provided"},
		{name: "Chinese date", value: "2012年6月30日", want: "2012-06-30", wantState: "provided"},
		{name: "graduation month", value: "2012-06", allowMonth: true, want: "2012-06", wantState: "provided"},
		{name: "birth month remains invalid", value: "1990-01", want: "1990-01", wantState: "invalid"},
		{name: "invalid calendar date", value: "2012/2/31", want: "2012/2/31", wantState: "invalid"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, gotState := dingTalkRosterDate(test.value, true, test.allowMonth)
			if got != test.want || gotState != test.wantState {
				t.Fatalf("dingTalkRosterDate(%q)=(%q,%q), want (%q,%q)", test.value, got, gotState, test.want, test.wantState)
			}
		})
	}
}
