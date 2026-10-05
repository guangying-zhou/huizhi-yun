package integrationoperation

import "testing"

// Shared golden for codocs/test/companyWeeklySummaryCommandDigest.test.ts.
// Keep this command shape aligned with the W40 publication command.
func TestCompanyWeeklySummaryCommandDigestContract(t *testing.T) {
	command := map[string]any{
		"periodKey": "2026-W40",
		"summaryId": int64(17),
		"summaryVersionId": int64(23),
		"revisionNo": 3,
		"title": "公司汇总 & 进展",
		"markdownSha256": "a8b2597965989c0ce74f320695fdc2d63da08983502124addd34280aee9d59db",
		"recipientUids": []string{},
		"documentType": "company",
		"idempotencyKey": "aims:company-weekly-summary:2026-W40:r3:publish:v1",
		"operatorUid": "zhouguangying",
	}
	digest, err := ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	const golden = "19505b89b3d61d1cf29e62bc5a88f914c9880017f98011f8b98133bdf1bfdfcf"
	if digest != golden {
		t.Fatalf("Go company summary digest changed: got %s want %s", digest, golden)
	}
}
