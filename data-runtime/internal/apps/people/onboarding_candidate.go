package people

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// 入职候选写入。
//
// 候选不是 employee：它不参与员工列表默认统计、任职、成本、绩效、资产、
// 项目成员或权限范围计算，只有在 canonical UID 真正可用之后才升格。钉钉
// 重放按 (provider_code, provider_subject) 天然键收敛，不重复建单。
const onboardingCodePrefix = "ONB"

// dingTalkManagedCandidateFields 是允许由钉钉持续管理的候选字段。
// HR 已确认的 canonical 事实（部门、岗位、职级、UID、邮箱）不在其中，
// 钉钉重放不得覆盖。
var dingTalkManagedCandidateFields = []string{
	"candidate_name", "mobile", "source_onboard_date", "manager_provider_subject",
}

func onboardingCodeFor(providerCode, providerSubject string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(providerCode) + ":" + strings.TrimSpace(providerSubject)))
	return onboardingCodePrefix + "-" + strings.ToUpper(hex.EncodeToString(sum[:8]))
}

// candidateSourceHash 只覆盖钉钉管理的字段。无关字段变化不应把一张已经
// 由 HR 确认过的入职单打回待完善。
func candidateSourceHash(candidate map[string]any) string {
	normalized := make(map[string]string, len(dingTalkManagedCandidateFields))
	for _, field := range dingTalkManagedCandidateFields {
		normalized[field] = strings.TrimSpace(fmt.Sprint(candidate[field]))
	}
	keys := make([]string, 0, len(normalized))
	for key := range normalized {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	builder := strings.Builder{}
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteString("=")
		builder.WriteString(normalized[key])
		builder.WriteString(";")
	}
	sum := sha256.Sum256([]byte(builder.String()))
	return hex.EncodeToString(sum[:])
}

// upsertOnboardingCandidates 写入或刷新钉钉入职候选。
//
// 关键约束：这里绝不写 people_employees，也绝不冻结生命周期 operation。
// 未命中既有身份的员工在 canonical UID 落地前不得进入跨应用业务链路。
func (a *Adapter) upsertOnboardingCandidates(ctx context.Context, candidates []map[string]any, sourceRevision string) (int, error) {
	if len(candidates) == 0 {
		return 0, nil
	}
	if len(sourceRevision) > 128 {
		sourceRevision = sourceRevision[:128]
	}

	applied := 0
	for _, candidate := range candidates {
		providerCode := cleanBodyString(candidate, "provider_code")
		if providerCode == "" {
			providerCode = "dingtalk"
		}
		providerSubject := cleanBodyString(candidate, "provider_subject")
		candidateName := cleanBodyString(candidate, "candidate_name")
		if providerSubject == "" || candidateName == "" {
			continue
		}

		fieldStatus := newDirectoryFieldStatusCounter()
		mobilePresent := sourceTextFieldWritable(candidate, []string{"mobile"})
		fieldStatus.observe("mobile", candidate, cleanBodyString(candidate, "mobile"), []string{"mobile"})
		fieldStatus.observe("email", candidate, cleanBodyString(candidate, "email"), []string{"email"})
		rawOnboardDate := cleanBodyString(candidate, "source_onboard_date")
		onboardDate := normalizeDirectoryDate(rawOnboardDate)
		fieldStatus.observeDate("onboard_date", candidate, rawOnboardDate, onboardDate, []string{"source_onboard_date"})
		onboardDateWritable := sourceDateFieldWritable(candidate, rawOnboardDate, onboardDate, []string{"source_onboard_date"})
		statusJSON, err := json.Marshal(fieldStatus.summary())
		if err != nil {
			return applied, err
		}

		// 钉钉只更新它管理的字段。HR 已确认的部门、岗位、职级、UID 和邮箱
		// 不在 upsert 的更新列表里，重放不会把确认过的资料冲掉。
		// 关键事实变化（姓名、入职日期）会使已确认的入职单回到待完善。
		if _, err := a.DB().ExecContext(ctx, `
			INSERT INTO people_onboarding_cases (
				onboarding_code, provider_code, provider_subject,
				source_revision, source_hash, candidate_name,
				mobile, source_onboard_date, source_field_status,
				manager_provider_subject, status, created_by, updated_by
			)
			VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), CAST(? AS JSON),
				NULLIF(?, ''), 'awaiting_profile', 'connector-runtime', 'connector-runtime')
			ON DUPLICATE KEY UPDATE
				source_revision = VALUES(source_revision),
				candidate_name = VALUES(candidate_name),
				mobile = CASE WHEN ? THEN VALUES(mobile) ELSE people_onboarding_cases.mobile END,
				source_onboard_date = CASE WHEN ? THEN VALUES(source_onboard_date) ELSE people_onboarding_cases.source_onboard_date END,
				source_field_status = VALUES(source_field_status),
				manager_provider_subject = COALESCE(VALUES(manager_provider_subject), people_onboarding_cases.manager_provider_subject),
				status = CASE
					WHEN people_onboarding_cases.status IN ('cancelled', 'completed') THEN people_onboarding_cases.status
					WHEN people_onboarding_cases.source_hash <> VALUES(source_hash)
						AND people_onboarding_cases.status = 'ready_for_provisioning'
						THEN 'awaiting_profile'
					ELSE people_onboarding_cases.status
				END,
				object_version = CASE
					WHEN people_onboarding_cases.source_hash <> VALUES(source_hash)
						THEN people_onboarding_cases.object_version + 1
					ELSE people_onboarding_cases.object_version
				END,
				source_hash = VALUES(source_hash),
				updated_by = VALUES(updated_by),
				updated_at = NOW()
		`,
			onboardingCodeFor(providerCode, providerSubject), providerCode, providerSubject,
			nullableString(sourceRevision), candidateSourceHash(candidate), candidateName,
			cleanBodyString(candidate, "mobile"), onboardDate, string(statusJSON),
			cleanBodyString(candidate, "manager_provider_subject"),
			mobilePresent, onboardDateWritable,
		); err != nil {
			return applied, err
		}
		applied++
	}
	return applied, nil
}
