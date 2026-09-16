package assets

import "testing"

func TestAssetsStatusRevisionHandlesOnlineSuspendedOnlineAndSameFactReplay(t *testing.T) {
	revision, changed := nextAssetsStatusRevision(0, "", "online-a")
	if revision != 1 || !changed {
		t.Fatalf("first online = %d,%v", revision, changed)
	}
	same, changed := nextAssetsStatusRevision(revision, "online-a", "online-a")
	if same != 1 || changed {
		t.Fatalf("same fact replay = %d,%v", same, changed)
	}
	revision, changed = nextAssetsStatusRevision(same, "online-a", "suspended")
	if revision != 2 || !changed {
		t.Fatalf("suspended = %d,%v", revision, changed)
	}
	revision, changed = nextAssetsStatusRevision(revision, "suspended", "online-b")
	if revision != 3 || !changed {
		t.Fatalf("second online = %d,%v", revision, changed)
	}
}
