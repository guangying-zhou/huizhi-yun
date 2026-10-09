package productcenter

import (
	"context"
	"database/sql"
)

// ComponentTreeNode is a product-scoped hierarchy snapshot. Callers must load
// it under the product root lock before validating and mutating the tree.
type ComponentTreeNode struct {
	ID       int64
	ParentID *int64
}

const MaxProductComponentDepth = 3

// ValidateProductComponentMove validates the entire resulting hierarchy,
// including descendants whose depth changes when a subtree is moved.
func ValidateProductComponentMove(nodes []ComponentTreeNode, componentID int64, parentID *int64) error {
	if componentID <= 0 || (parentID != nil && *parentID <= 0) {
		return invalid("product_component_tree_invalid", "模块标识无效")
	}
	parents := make(map[int64]*int64, len(nodes))
	for _, node := range nodes {
		if node.ID <= 0 {
			return invalid("product_component_tree_invalid", "模块树标识无效")
		}
		if _, exists := parents[node.ID]; exists {
			return invalid("product_component_tree_invalid", "模块树包含重复标识")
		}
		parents[node.ID] = node.ParentID
	}
	if _, exists := parents[componentID]; !exists {
		return invalid("product_component_not_found", "模块不存在")
	}
	if parentID != nil {
		if _, exists := parents[*parentID]; !exists {
			return invalid("product_component_parent_invalid", "父模块不属于当前产品")
		}
	}
	parents[componentID] = parentID
	for id := range parents {
		seen := map[int64]bool{}
		current := id
		for depth := 1; ; depth++ {
			if seen[current] {
				return invalid("product_component_cycle", "模块不能移到自身或后代之下")
			}
			seen[current] = true
			if depth > MaxProductComponentDepth {
				return invalid("product_component_depth_exceeded", "模块层级不能超过 3 层")
			}
			parent, exists := parents[current]
			if !exists {
				return invalid("product_component_tree_invalid", "模块树存在缺失父节点")
			}
			if parent == nil {
				break
			}
			current = *parent
		}
	}
	return nil
}

// Caller holds the product root lock for a consistent hierarchy snapshot.
func loadProductComponentTree(ctx context.Context, tx *sql.Tx, code string) ([]ComponentTreeNode, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id,parent_id FROM product_components WHERE BINARY product_code=BINARY ? ORDER BY id LIMIT 10001`, code)
	if err != nil {
		return nil, err
	}
	nodes := []ComponentTreeNode{}
	for rows.Next() {
		var node ComponentTreeNode
		if err = rows.Scan(&node.ID, &node.ParentID); err != nil {
			rows.Close()
			return nil, err
		}
		nodes = append(nodes, node)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(nodes) > 10000 {
		return nil, invalid("product_component_tree_too_large", "模块树超过当前支持的 10000 个节点，未执行变更")
	}

	return nodes, nil
}
