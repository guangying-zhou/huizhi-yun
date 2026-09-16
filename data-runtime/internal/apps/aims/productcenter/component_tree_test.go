package productcenter

import "testing"

func TestProductComponentMoveValidatesWholeSubtree(t *testing.T) {
	ptr := func(n int64) *int64 { return &n }
	nodes := []ComponentTreeNode{{ID: 1}, {ID: 2, ParentID: ptr(1)}, {ID: 3, ParentID: ptr(2)}, {ID: 4}}
	if err := ValidateProductComponentMove(nodes, 2, ptr(4)); err != nil {
		t.Fatal(err)
	}
	if err := ValidateProductComponentMove(nodes, 2, nil); err != nil {
		t.Fatal(err)
	}
	requireProductRule(t, ValidateProductComponentMove(nodes, 1, ptr(3)), "product_component_cycle")
	requireProductRule(t, ValidateProductComponentMove(nodes, 2, ptr(2)), "product_component_cycle")
	requireProductRule(t, ValidateProductComponentMove(nodes, 2, ptr(999)), "product_component_parent_invalid")
	if *nodes[1].ParentID != 1 {
		t.Fatal("validation mutated original tree")
	}
	chain := []ComponentTreeNode{{ID: 1}}
	for i := int64(2); i <= 3; i++ {
		chain = append(chain, ComponentTreeNode{ID: i, ParentID: ptr(i - 1)})
	}
	chain = append(chain, ComponentTreeNode{ID: 4}, ComponentTreeNode{ID: 5, ParentID: ptr(4)})
	// Moving a two-level subtree below level 2 makes its descendant level 4.
	requireProductRule(t, ValidateProductComponentMove(chain, 4, ptr(2)), "product_component_depth_exceeded")
	if err := ValidateProductComponentMove(chain, 4, ptr(1)); err != nil {
		t.Fatal(err)
	}
	requireProductRule(t, ValidateProductComponentMove([]ComponentTreeNode{{ID: 1}, {ID: 1}}, 1, nil), "product_component_tree_invalid")
	requireProductRule(t, ValidateProductComponentMove([]ComponentTreeNode{{ID: 1}, {ID: 2, ParentID: ptr(999)}}, 1, nil), "product_component_tree_invalid")
}
