package altoc

import "testing"

func TestProductFeedbackSnapshot(t *testing.T) {
	ticket := map[string]any{"code": "ST-1", "product_code": "P1", "ticket_type": "requirement", "title": "需求", "description": "多行\n说明", "priority": "urgent", "reported_by_phone": "private"}
	snapshot, original, err := altocProductFeedbackSnapshot(ticket)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot) != 5 {
		t.Fatal("snapshot leaked unrelated ticket facts")
	}
	ticket["priority"] = "low"
	_, digest, err := altocProductFeedbackSnapshot(ticket)
	if err != nil || digest != original {
		t.Fatal("service priority changed product snapshot")
	}
	ticket["title"] = "新需求"
	_, digest, err = altocProductFeedbackSnapshot(ticket)
	if err != nil || digest == original {
		t.Fatal("changed source title must invalidate snapshot")
	}
	ticket["description"] = nil
	snapshot, _, err = altocProductFeedbackSnapshot(ticket)
	if err != nil || snapshot["description"] != "" {
		t.Fatal("nullable description must become empty text")
	}
	for _, change := range []struct {
		key   string
		value any
	}{{"product_code", ""}, {"product_code", "P/1"}, {"ticket_type", "incident"}, {"title", "bad\ntext"}, {"description", "bad\x00text"}} {
		prior := ticket[change.key]
		ticket[change.key] = change.value
		if _, _, err := altocProductFeedbackSnapshot(ticket); err == nil {
			t.Errorf("accepted invalid %s", change.key)
		}
		ticket[change.key] = prior
	}
}
