//! Tree-sitter enhanced code graph (R2-2).
//! Provides precise AST-based symbol extraction and cross-file callee tracing (R2-3).

use crate::code_graph::{Symbol, SymbolKind};
use std::collections::{HashSet, VecDeque};
use std::path::Path;
use tree_sitter::Parser;

/// Extract symbols from a Rust source file using tree-sitter.
pub fn parse_rust_symbols(file_path: &str, source: &str) -> Vec<Symbol> {
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_rust::language())
        .expect("Failed to load Rust grammar");

    let tree = parser.parse(source, None);
    if tree.is_none() {
        return vec![];
    }
    let tree = tree.unwrap();
    let root = tree.root_node();

    let mut symbols = Vec::new();
    extract_symbols_recursive(root, source, file_path, &mut symbols);
    symbols
}

fn extract_symbols_recursive(
    node: tree_sitter::Node,
    source: &str,
    file_path: &str,
    symbols: &mut Vec<Symbol>,
) {
    let kind = node.kind();
    let (symbol_kind, name) = match kind {
        "function_item" | "function_signature_item" => {
            let name = child_text_by_field(node, "name", source);
            (SymbolKind::Function, name)
        }
        "impl_item" => {
            // impl block — recurse into children for methods
            for i in 0..node.child_count() {
                if let Some(child) = node.child(i) {
                    extract_symbols_recursive(child, source, file_path, symbols);
                }
            }
            return;
        }
        "struct_item" => {
            let name = child_text_by_field(node, "name", source);
            (SymbolKind::Class, name)
        }
        "enum_item" => {
            let name = child_text_by_field(node, "name", source);
            (SymbolKind::Type, name)
        }
        "trait_item" => {
            let name = child_text_by_field(node, "name", source);
            (SymbolKind::Interface, name)
        }
        "type_item" => {
            let name = child_text_by_field(node, "name", source);
            (SymbolKind::Type, name)
        }
        "mod_item" => {
            let name = child_text_by_field(node, "name", source);
            (SymbolKind::Module, name)
        }
        "const_item" => {
            let name = child_text_by_field(node, "name", source);
            (SymbolKind::Constant, name)
        }
        "let_declaration" | "static_item" => {
            let name_node = node.child_by_field_name("pattern");
            let name = name_node.map_or("", |n| &source[n.start_byte()..n.end_byte()]).to_string();
            (SymbolKind::Variable, name)
        }
        _ => return,
    };

    if !name.is_empty() {
        symbols.push(Symbol {
            name,
            kind: symbol_kind,
            file: file_path.to_string(),
            line: node.start_position().row + 1,
            signature: Some(source[node.start_byte()..node.end_byte()].lines().next().unwrap_or("").to_string()),
            doc_comment: None,
            body: None,
            exports: false,
        });
    }

    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            extract_symbols_recursive(child, source, file_path, symbols);
        }
    }
}

fn child_text_by_field(node: tree_sitter::Node, field: &str, source: &str) -> String {
    node.child_by_field_name(field)
        .map(|n| source[n.start_byte()..n.end_byte()].to_string())
        .unwrap_or_default()
}

/// Cross-file callee tracing: find all functions called from a given symbol.
/// Uses BFS with configurable max depth (R2-3).
pub fn trace_callees(
    project_root: &Path,
    file_path: &str,
    symbol_name: &str,
    max_depth: usize,
) -> Result<Vec<CalleeNode>, String> {
    let source = std::fs::read_to_string(project_root.join(file_path))
        .map_err(|e| format!("Failed to read {}: {}", file_path, e))?;

    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_rust::language())
        .expect("Failed to load Rust grammar");

    let tree = parser.parse(&source, None).ok_or("Parse failed")?;

    // Find the target function node
    let root = tree.root_node();
    let target_fn = find_function_node(root, &source, symbol_name)
        .ok_or(format!("Function '{}' not found in {}", symbol_name, file_path))?;

    // Extract direct callees
    let callees = extract_callee_names(target_fn, &source);

    // BFS across files up to max_depth
    let mut queue: VecDeque<CalleeNode> = callees
        .into_iter()
        .map(|name| CalleeNode {
            name,
            file: file_path.to_string(),
            depth: 1,
            caller: symbol_name.to_string(),
        })
        .collect();

    let mut visited: HashSet<String> = HashSet::new();
    visited.insert(symbol_name.to_string());
    let mut results = Vec::new();

    while let Some(node) = queue.pop_front() {
        if visited.contains(&node.name) || node.depth > max_depth {
            continue;
        }
        visited.insert(node.name.clone());
        results.push(node.clone());

        // Look for the callee's definition in the project
        let callee_file = find_symbol_file(project_root, &node.name);
        if let Some(ref cf) = callee_file {
            if let Ok(src) = std::fs::read_to_string(project_root.join(cf)) {
                if let Some(callee_tree) = parser.parse(&src, None) {
                    if let Some(fn_node) = find_function_node(callee_tree.root_node(), &src, &node.name) {
                        let sub_callees = extract_callee_names(fn_node, &src);
                        for name in sub_callees {
                            queue.push_back(CalleeNode {
                                name,
                                file: cf.clone(),
                                depth: node.depth + 1,
                                caller: node.name.clone(),
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CalleeNode {
    pub name: String,
    pub file: String,
    pub depth: usize,
    pub caller: String,
}

fn find_function_node<'a>(
    node: tree_sitter::Node<'a>,
    source: &str,
    name: &str,
) -> Option<tree_sitter::Node<'a>> {
    if node.kind() == "function_item" {
        if child_text_by_field(node, "name", source) == name {
            return Some(node);
        }
    }
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            if let Some(result) = find_function_node(child, source, name) {
                return Some(result);
            }
        }
    }
    None
}

fn extract_callee_names(node: tree_sitter::Node, source: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut seen = HashSet::new();
    extract_calls_recursive(node, source, &mut names, &mut seen);
    names
}

fn extract_calls_recursive(
    node: tree_sitter::Node,
    source: &str,
    names: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    if node.kind() == "call_expression" {
        if let Some(fn_node) = node.child_by_field_name("function") {
            if fn_node.kind() == "identifier" {
                let name = source[fn_node.start_byte()..fn_node.end_byte()].to_string();
                if seen.insert(name.clone()) {
                    names.push(name);
                }
            }
        }
    }
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            extract_calls_recursive(child, source, names, seen);
        }
    }
}

fn find_symbol_file(project_root: &Path, symbol_name: &str) -> Option<String> {
    use walkdir::WalkDir;
    for entry in WalkDir::new(project_root)
        .max_depth(5)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.path().extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(entry.path()) {
            if content.contains(&format!("fn {}", symbol_name))
                || content.contains(&format!("fn {}<", symbol_name))
            {
                if let Ok(rel) = entry.path().strip_prefix(project_root) {
                    return Some(rel.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rust_function() {
        let source = r#"
fn hello() -> String {
    "world".to_string()
}
"#;
        let symbols = parse_rust_symbols("test.rs", source);
        assert!(!symbols.is_empty());
        assert_eq!(symbols[0].name, "hello");
        assert_eq!(symbols[0].kind, SymbolKind::Function);
    }

    #[test]
    fn test_parse_rust_struct() {
        let source = r#"
pub struct User {
    name: String,
    age: u32,
}
"#;
        let symbols = parse_rust_symbols("test.rs", source);
        assert_eq!(symbols[0].name, "User");
        assert_eq!(symbols[0].kind, SymbolKind::Class);
    }

    #[test]
    fn test_extract_callees() {
        let source = r#"
fn foo() {
    bar();
    baz(42);
}
"#;
        let mut parser = Parser::new();
        parser.set_language(&tree_sitter_rust::language()).unwrap();
        let tree = parser.parse(source, None).unwrap();
        let fn_node = find_function_node(tree.root_node(), source, "foo").unwrap();
        let callees = extract_callee_names(fn_node, source);
        assert!(callees.contains(&"bar".to_string()));
        assert!(callees.contains(&"baz".to_string()));
    }
}
