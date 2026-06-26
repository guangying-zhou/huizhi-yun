package aims

import "testing"

func TestDefaultProjectTemplateDefinitionHasPIVRMilestones(t *testing.T) {
	definition := defaultProjectTemplateDefinition("product_dev")

	if len(definition.Milestones) != 4 {
		t.Fatalf("expected 4 default milestones, got %d", len(definition.Milestones))
	}

	stages := []string{"P", "I", "V", "R"}
	names := []string{"规划POC", "核心MVP", "商用MMP", "市场PMF"}
	for i, milestone := range definition.Milestones {
		if milestone.PivrStage != stages[i] {
			t.Fatalf("milestone %d stage = %q, want %q", i, milestone.PivrStage, stages[i])
		}
		if milestone.Name != names[i] {
			t.Fatalf("milestone %d name = %q, want %q", i, milestone.Name, names[i])
		}
		if milestone.SortOrder != i+1 {
			t.Fatalf("milestone %d sortOrder = %d, want %d", i, milestone.SortOrder, i+1)
		}
	}
}

func TestParseProjectTemplateDefinitionNormalizesEmptyFields(t *testing.T) {
	definition, err := parseProjectTemplateDefinition(`{"milestones":[{"workItems":[{"deliverables":[{}]}]}]}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	milestone := definition.Milestones[0]
	if milestone.Key != "milestone-1" || milestone.Name != "里程碑 1" || milestone.Mode != "rolling_plan" || milestone.PivrStage != "P" {
		t.Fatalf("unexpected normalized milestone: %#v", milestone)
	}
	workItem := milestone.WorkItems[0]
	if workItem.Key != "milestone-1-work-item-1" || workItem.Title != "工作项 1" || workItem.Type != "task" || workItem.Tier != "target" || workItem.Priority != "P2" {
		t.Fatalf("unexpected normalized work item: %#v", workItem)
	}
	deliverable := workItem.Deliverables[0]
	if deliverable.Key != "milestone-1-work-item-1-deliverable-1" || deliverable.Name != "交付物 1" || deliverable.DeliverableType != "document" {
		t.Fatalf("unexpected normalized deliverable: %#v", deliverable)
	}
}
