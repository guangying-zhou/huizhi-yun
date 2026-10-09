package productcenter

import (
	"context"
	"testing"
)

func TestRoadmapCommitmentInputBoundary(t *testing.T) {
	identity := CommandIdentity{Action: "product_roadmaps:commit"}
	valid := RoadmapCommitmentInput{ItemBizID: "00000000-0000-4000-8000-000000000001", CycleBizID: "00000000-0000-4000-8000-000000000002", ExpectedRevision: 1, ExpectedItemRevision: 1, ExpectedCycleRevision: 1, ExpectedQueueRevision: 1, Reason: "确认承诺"}
	for _, change := range []func(*RoadmapCommitmentInput){func(v *RoadmapCommitmentInput) { v.CycleBizID = "invalid" }, func(v *RoadmapCommitmentInput) { v.ExpectedCycleRevision = 0 }, func(v *RoadmapCommitmentInput) { v.ExpectedQueueRevision = 0 }} {
		input := valid
		change(&input)
		_, err := CommitRoadmap(context.Background(), nil, identity, AuthorizationPermit{}, input)
		requireProductRule(t, err, "product_roadmap_commitment_invalid")
	}
	identity.Action = "product_roadmaps:window-edit"
	_, err := CommitRoadmap(context.Background(), nil, identity, AuthorizationPermit{}, valid)
	requireProductRule(t, err, "product_command_identity_invalid")
}
