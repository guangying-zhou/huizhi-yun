package aims

import "testing"

func TestRequirementBelongsToProjectFailsClosed(t *testing.T) {
	if requirementBelongsToProject(nil, 12) || requirementBelongsToProject(&requirementDetailData{ProjectID: 13}, 12) || requirementBelongsToProject(&requirementDetailData{ProjectID: 12}, 0) {
		t.Fatal("cross-project or missing requirement binding was accepted")
	}
	if !requirementBelongsToProject(&requirementDetailData{ProjectID: 12}, 12) {
		t.Fatal("matching requirement binding was rejected")
	}
}
