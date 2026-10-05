package peoplejobs

import (
	"context"
	"encoding/json"
)

type StartRequest struct {
	Provider         string   `json:"provider"`
	IntegrationCode  string   `json:"integrationCode"`
	ObjectScopes     []string `json:"objectScopes"`
	Watermark        string   `json:"watermark,omitempty"`
	IdempotencyKey   string   `json:"idempotencyKey"`
	OriginalActorUID string   `json:"originalActorUid,omitempty"`
}

type ActionRequest struct {
	OriginalActorUID string `json:"originalActorUid"`
	IdempotencyKey   string `json:"idempotencyKey"`
}

type Department struct {
	ProviderID       string `json:"providerId"`
	Name             string `json:"name"`
	ParentProviderID string `json:"parentProviderId,omitempty"`
	SortOrder        int    `json:"sortOrder"`
	ManagerSubject   string `json:"managerSubject,omitempty"`
}

type User struct {
	ProviderSubject     string   `json:"providerSubject"`
	Name                string   `json:"name"`
	EmployeeNumber      string   `json:"employeeNumber,omitempty"`
	Email               string   `json:"email,omitempty"`
	Mobile              string   `json:"mobile,omitempty"`
	Title               string   `json:"title,omitempty"`
	DepartmentIDs       []string `json:"departmentIds,omitempty"`
	PrimaryDepartmentID string   `json:"primaryDepartmentId,omitempty"`
	ManagerSubject      string   `json:"managerSubject,omitempty"`
	EmploymentStatus    string   `json:"employmentStatus"`
	OnboardDate         string   `json:"onboardDate,omitempty"`
	IDNumber            string   `json:"idNumber,omitempty"`
	BirthDate           string   `json:"birthDate,omitempty"`
	EducationLevel      string   `json:"educationLevel,omitempty"`
	Major               string   `json:"major,omitempty"`
	GraduationSchool    string   `json:"graduationSchool,omitempty"`
	GraduationDate      string   `json:"graduationDate,omitempty"`
	LeaveDate           string   `json:"leaveDate,omitempty"`
	LeaveReason         string   `json:"leaveReason,omitempty"`
	Active              bool     `json:"active"`
	// SourceFieldStates 只控制同步 JSON 是否保留 provider 的“显式空值”。
	// absent 字段继续省略；invalid 日期保留原值，交给 People 规范化并计数。
	SourceFieldStates map[string]string `json:"-"`
}

func (u User) MarshalJSON() ([]byte, error) {
	type userAlias User
	raw, err := json.Marshal(userAlias(u))
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err = json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	values := map[string]string{
		"employeeNumber":   u.EmployeeNumber,
		"email":            u.Email,
		"mobile":           u.Mobile,
		"onboardDate":      u.OnboardDate,
		"idNumber":         u.IDNumber,
		"birthDate":        u.BirthDate,
		"educationLevel":   u.EducationLevel,
		"major":            u.Major,
		"graduationSchool": u.GraduationSchool,
		"graduationDate":   u.GraduationDate,
	}
	for field, value := range values {
		switch u.SourceFieldStates[field] {
		case "empty", "invalid":
			result[field] = value
		case "absent":
			delete(result, field)
		}
	}
	return json.Marshal(result)
}

type Batch struct {
	JobID                        string       `json:"jobId"`
	BatchNumber                  int          `json:"batchNumber"`
	Final                        bool         `json:"final"`
	Provider                     string       `json:"provider"`
	IntegrationCode              string       `json:"integrationCode"`
	ObjectScopes                 []string     `json:"objectScopes,omitempty"`
	Watermark                    string       `json:"watermark"`
	OrganizationRootDepartmentID string       `json:"organizationRootDepartmentId,omitempty"`
	OrganizationSnapshotComplete bool         `json:"organizationSnapshotComplete,omitempty"`
	OrganizationSnapshotHash     string       `json:"organizationSnapshotHash,omitempty"`
	OrganizationDepartmentCount  int          `json:"organizationDepartmentCount,omitempty"`
	Departments                  []Department `json:"departments,omitempty"`
	Users                        []User       `json:"users,omitempty"`
}

type Counts struct {
	Departments int `json:"departments"`
	Users       int `json:"users"`
	Applied     int `json:"applied"`
	Skipped     int `json:"skipped"`
	Batches     int `json:"batches"`
	// FieldCoverage 记录 provider 对每个受管字段的实际下发比例。
	// 钉钉在应用缺少权限时会整体省略 hired_date / mobile 而接口仍返回
	// errcode=0，只统计用户数无法暴露这种静默缺失。
	FieldCoverage []FieldCoverage `json:"fieldCoverage,omitempty"`
	// PartialFieldsMissing 列出本次同步一条都没有下发的受管字段。
	PartialFieldsMissing []string `json:"partialFieldsMissing,omitempty"`
}

type FieldCoverage struct {
	Field    string `json:"field"`
	Provided int    `json:"provided"`
	Empty    int    `json:"empty"`
	Absent   int    `json:"absent"`
	Invalid  int    `json:"invalid"`
	Observed int    `json:"observed"`
}

type Job struct {
	JobID            string   `json:"jobId"`
	RetryOfJobID     string   `json:"retryOfJobId,omitempty"`
	OriginalActorUID string   `json:"originalActorUid,omitempty"`
	CancelledByUID   string   `json:"cancelledByUid,omitempty"`
	Provider         string   `json:"provider"`
	IntegrationCode  string   `json:"integrationCode"`
	ObjectScopes     []string `json:"objectScopes"`
	Watermark        string   `json:"watermark"`
	Status           string   `json:"status"`
	Counts           Counts   `json:"counts"`
	ErrorCode        string   `json:"errorCode,omitempty"`
	ErrorMessage     string   `json:"errorMessage,omitempty"`
	CreatedAt        string   `json:"createdAt"`
	StartedAt        string   `json:"startedAt,omitempty"`
	FinishedAt       string   `json:"finishedAt,omitempty"`
}

type Runner interface {
	RunPeopleSync(context.Context, StartRequest, func(Batch) error) (Counts, error)
}

type Sink interface {
	Apply(context.Context, Batch) (Counts, error)
}

type FailureSink interface {
	Fail(context.Context, Batch, string, string) error
}
