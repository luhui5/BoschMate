use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use walkdir::WalkDir;

// ── Symbol types ──

impl Symbol {
    pub fn kind_name(&self) -> &str {
        match self.kind {
            SymbolKind::Function => "function",
            SymbolKind::Method => "method",
            SymbolKind::Class => "class",
            SymbolKind::Interface => "interface",
            SymbolKind::Type => "type",
            SymbolKind::Variable => "variable",
            SymbolKind::Constant => "constant",
            SymbolKind::Module => "module",
            SymbolKind::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Symbol {
    pub name: String,
    pub kind: SymbolKind,
    pub file: String,
    pub line: usize,
    pub signature: Option<String>,
    pub doc_comment: Option<String>,
    pub body: Option<String>,
    pub exports: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Function,
    Method,
    Class,
    Interface,
    Type,
    Variable,
    Constant,
    Module,
    Unknown,
}

impl std::fmt::Display for SymbolKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SymbolKind::Function => write!(f, "function"),
            SymbolKind::Method => write!(f, "method"),
            SymbolKind::Class => write!(f, "class"),
            SymbolKind::Interface => write!(f, "interface"),
            SymbolKind::Type => write!(f, "type"),
            SymbolKind::Variable => write!(f, "variable"),
            SymbolKind::Constant => write!(f, "constant"),
            SymbolKind::Module => write!(f, "module"),
            SymbolKind::Unknown => write!(f, "unknown"),
        }
    }
}

impl SymbolKind {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "function" | "fn" | "def" | "func" => SymbolKind::Function,
            "method" => SymbolKind::Method,
            "class" => SymbolKind::Class,
            "interface" | "trait" | "protocol" => SymbolKind::Interface,
            "type" | "struct" | "enum" => SymbolKind::Type,
            "variable" | "var" | "let" => SymbolKind::Variable,
            "constant" | "const" => SymbolKind::Constant,
            "module" | "mod" | "import" => SymbolKind::Module,
            _ => SymbolKind::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CodeGraphResult {
    pub symbols: Vec<Symbol>,
    pub total_files: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct CallChain {
    pub chains: Vec<Vec<ChainNode>>,
    pub shortest_length: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChainNode {
    pub symbol: String,
    pub file: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BlastRadius {
    pub affected_files: Vec<AffectedFile>,
    pub risk_level: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AffectedFile {
    pub path: String,
    pub reason: String,
    pub affected_symbols: Vec<String>,
}

// ── Language-specific patterns ──

struct LangPatterns {
    function: Regex,
    method: Regex,
    class: Regex,
    interface: Regex,
    type_def: Regex,
    variable: Regex,
    constant: Regex,
    import_single: Regex,
    import_multi: Regex,
    function_call: Regex,
}

fn ts_patterns() -> &'static LangPatterns {
    static P: OnceLock<LangPatterns> = OnceLock::new();
    P.get_or_init(|| LangPatterns {
        function: Regex::new(r"(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[<(]").unwrap(),
        method: Regex::new(r"(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(\w+)\s*[<(][^)]*[)>]\s*:\s*\w+\s*\{").unwrap(),
        class: Regex::new(r"(?:export\s+)?class\s+(\w+)").unwrap(),
        interface: Regex::new(r"(?:export\s+)?interface\s+(\w+)").unwrap(),
        type_def: Regex::new(r"(?:export\s+)?type\s+(\w+)\s*=").unwrap(),
        variable: Regex::new(r"(?:export\s+)?(?:let|var)\s+(\w+)\s*[=:]").unwrap(),
        constant: Regex::new(r"(?:export\s+)?const\s+(\w+)\s*[=:]").unwrap(),
        import_single: Regex::new(r#"import\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]"#).unwrap(),
        import_multi: Regex::new(r#"import\s+(\w+)\s+from\s+['"]([^'"]+)['"]"#).unwrap(),
        function_call: Regex::new(r"(\w+)\s*\(").unwrap(),
    })
}

fn python_patterns() -> &'static LangPatterns {
    static P: OnceLock<LangPatterns> = OnceLock::new();
    P.get_or_init(|| LangPatterns {
        function: Regex::new(r"def\s+(\w+)\s*\(").unwrap(),
        method: Regex::new(r"def\s+(\w+)\s*\(\s*self\b").unwrap(),
        class: Regex::new(r"class\s+(\w+)").unwrap(),
        interface: Regex::new(r"class\s+(\w+)\s*\(\s*Protocol\s*\)").unwrap(),
        type_def: Regex::new(r"(\w+)\s*=\s*TypeVar\(|@dataclass\s*\nclass\s+(\w+)").unwrap(),
        variable: Regex::new(r"^(\w+)\s*=\s*(?!def\b|class\b)").unwrap(),
        constant: Regex::new(r"^([A-Z_][A-Z0-9_]*)\s*=").unwrap(),
        import_single: Regex::new(r"from\s+(\S+)\s+import\s+").unwrap(),
        import_multi: Regex::new(r"import\s+(\S+)").unwrap(),
        function_call: Regex::new(r"(\w+)\s*\(").unwrap(),
    })
}

fn rust_patterns() -> &'static LangPatterns {
    static P: OnceLock<LangPatterns> = OnceLock::new();
    P.get_or_init(|| LangPatterns {
        function: Regex::new(r"(?:pub\s+)?fn\s+(\w+)\s*[<(]").unwrap(),
        method: Regex::new(r"(?:pub\s+)?fn\s+(\w+)\s*[<(][^)]*self\b").unwrap(),
        class: Regex::new(r"(?:pub\s+)?struct\s+(\w+)").unwrap(),
        interface: Regex::new(r"(?:pub\s+)?trait\s+(\w+)").unwrap(),
        type_def: Regex::new(r"(?:pub\s+)?(?:struct|enum|type)\s+(\w+)").unwrap(),
        variable: Regex::new(r"let\s+(?:mut\s+)?(\w+)\s*[=:]").unwrap(),
        constant: Regex::new(r"(?:pub\s+)?const\s+(\w+)\s*:").unwrap(),
        import_single: Regex::new(r"use\s+(\S+?)(?:::\{)?[^;]*;").unwrap(),
        import_multi: Regex::new(r"use\s+(\S+?)(?:::\{)?[^;]*;").unwrap(),
        function_call: Regex::new(r"(\w+)\s*\(").unwrap(),
    })
}

fn get_patterns(ext: &str) -> Option<&'static LangPatterns> {
    match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "mts" => Some(ts_patterns()),
        "py" | "pyi" => Some(python_patterns()),
        "rs" => Some(rust_patterns()),
        _ => None,
    }
}

// ── Symbol extraction ──

pub fn list_symbols(
    root: &Path,
    file_path: &str,
    kind_filter: Option<&str>,
) -> Result<Vec<Symbol>, String> {
    let full_path = root.join(file_path);
    let ext = full_path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let patterns = get_patterns(ext).ok_or_else(|| format!("Unsupported language: {}", ext))?;
    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read {}: {}", file_path, e))?;
    let lines: Vec<&str> = content.lines().collect();

    let mut symbols = Vec::new();

    // Extract functions
    for cap in patterns.function.captures_iter(&content) {
        let name = cap[1].to_string();
        let line = find_line(&content, cap.get(0).unwrap().start());
        let kind = SymbolKind::Function;
        if kind_filter.map_or(true, |f| kind.to_string() == f) {
            symbols.push(Symbol {
                name,
                kind,
                file: file_path.to_string(),
                line,
                signature: Some(cap[0].to_string()),
                doc_comment: extract_doc_comment(&lines, line),
                body: None,
                exports: content[..cap.get(0).unwrap().start()].contains("pub ") || content[..cap.get(0).unwrap().start()].contains("export "),
            });
        }
    }

    // Classes
    for cap in patterns.class.captures_iter(&content) {
        let name = cap[1].to_string();
        let line = find_line(&content, cap.get(0).unwrap().start());
        let kind = SymbolKind::Class;
        if kind_filter.map_or(true, |f| kind.to_string() == f) {
            symbols.push(Symbol {
                name,
                kind,
                file: file_path.to_string(),
                line,
                signature: Some(cap[0].to_string()),
                doc_comment: extract_doc_comment(&lines, line),
                body: None,
                exports: true,
            });
        }
    }

    // Interfaces/Traits
    for cap in patterns.interface.captures_iter(&content) {
        let name = cap[1].to_string();
        let line = find_line(&content, cap.get(0).unwrap().start());
        let kind = SymbolKind::Interface;
        if kind_filter.map_or(true, |f| kind.to_string() == f) {
            symbols.push(Symbol {
                name,
                kind,
                file: file_path.to_string(),
                line,
                signature: Some(cap[0].to_string()),
                doc_comment: extract_doc_comment(&lines, line),
                body: None,
                exports: true,
            });
        }
    }

    // Type definitions
    for cap in patterns.type_def.captures_iter(&content) {
        let name = cap.get(1).or_else(|| cap.get(2)).map(|m| m.as_str().to_string()).unwrap_or_default();
        if !name.is_empty() && kind_filter.map_or(true, |f| "type" == f) {
            let line = find_line(&content, cap.get(0).unwrap().start());
            symbols.push(Symbol {
                name,
                kind: SymbolKind::Type,
                file: file_path.to_string(),
                line,
                signature: Some(cap[0].to_string()),
                doc_comment: None,
                body: None,
                exports: true,
            });
        }
    }

    // Fallback: if kind_filter is not set, add variables and constants
    if kind_filter.is_none() || kind_filter == Some("all") {
        for cap in patterns.constant.captures_iter(&content) {
            let name = cap[1].to_string();
            let line = find_line(&content, cap.get(0).unwrap().start());
            symbols.push(Symbol {
                name,
                kind: SymbolKind::Constant,
                file: file_path.to_string(),
                line,
                signature: None,
                doc_comment: None,
                body: None,
                exports: false,
            });
        }
    }

    symbols.sort_by_key(|s| s.line);
    Ok(symbols)
}

pub fn read_symbol(
    root: &Path,
    symbol_name: &str,
    file_path: &str,
) -> Result<Symbol, String> {
    let symbols = list_symbols(root, file_path, None)?;
    symbols.into_iter()
        .find(|s| s.name == symbol_name)
        .ok_or_else(|| format!("Symbol '{}' not found in {}", symbol_name, file_path))
}

pub fn find_references(
    root: &Path,
    symbol_name: &str,
    _file_path: &str,
    max_results: Option<usize>,
) -> Result<Vec<GrepResult>, String> {
    let limit = max_results.unwrap_or(100);
    let mut results = Vec::new();

    for entry in WalkDir::new(root)
        .max_depth(20)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !name.starts_with('.') && !name.starts_with("node_modules")
                && name != "target" && name != ".git"
        })
        .flatten()
    {
        if results.len() >= limit { break; }
        if !entry.file_type().is_file() { continue; }

        let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("");
        if get_patterns(ext).is_none() { continue; }

        if let Ok(content) = fs::read_to_string(entry.path()) {
            let rel = entry.path().strip_prefix(root).unwrap_or(entry.path());
            for (line_num, line) in content.lines().enumerate() {
                if results.len() >= limit { break; }
                if line.contains(symbol_name) {
                    results.push(GrepResult {
                        file: rel.to_string_lossy().to_string(),
                        line: line_num + 1,
                        content: line.trim().to_string(),
                    });
                }
            }
        }
    }

    Ok(results)
}

#[derive(Debug, Clone, Serialize)]
pub struct GrepResult {
    pub file: String,
    pub line: usize,
    pub content: String,
}

pub fn trace_callers(
    root: &Path,
    symbol_name: &str,
    file_path: &str,
    max_depth: Option<usize>,
) -> Result<Vec<Symbol>, String> {
    let depth = max_depth.unwrap_or(1);
    let mut callers = Vec::new();
    let mut current_symbols = vec![(symbol_name.to_string(), file_path.to_string())];

    for _ in 0..depth {
        let mut next_level = Vec::new();
        for (sym, fpath) in &current_symbols {
            let refs = find_references(root, sym, fpath, Some(50))?;
            for r in &refs {
                if r.file != *fpath || r.line > 0 {
                    // Check if the reference is a function call
                    if let Ok(symbols) = list_symbols(root, &r.file, Some("function")) {
                        for s in symbols {
                            if s.line <= r.line && s.line + 10 >= r.line {
                                if !callers.iter().any(|c: &Symbol| c.name == s.name && c.file == s.file) {
                                    callers.push(s.clone());
                                    next_level.push((s.name.clone(), s.file.clone()));
                                }
                            }
                        }
                    }
                }
            }
        }
        current_symbols = next_level;
    }

    Ok(callers)
}

pub fn trace_callees(
    root: &Path,
    symbol_name: &str,
    file_path: &str,
    max_depth: Option<usize>,
) -> Result<Vec<Symbol>, String> {
    let depth = max_depth.unwrap_or(1);
    let content = fs::read_to_string(root.join(file_path))
        .map_err(|e| format!("Read error: {}", e))?;

    // Find the symbol's body
    let body = extract_function_body(&content, symbol_name)?;
    let ext = Path::new(file_path).extension().and_then(|e| e.to_str()).unwrap_or("");
    let patterns = get_patterns(ext).ok_or("Unsupported language")?;

    let mut callees = Vec::new();
    for cap in patterns.function_call.captures_iter(&body) {
        let called = cap[1].to_string();
        // Filter out keywords
        if is_keyword(ext, &called) { continue; }
        if !callees.iter().any(|s: &Symbol| s.name == called) {
            let line = find_line(&body, cap.get(0).unwrap().start());
            callees.push(Symbol {
                name: called.clone(),
                kind: SymbolKind::Function,
                file: file_path.to_string(),
                line,
                signature: None,
                doc_comment: None,
                body: None,
                exports: false,
            });
        }
    }

    if depth > 1 {
        // TODO: recursive trace for callees in other files
    }

    Ok(callees)
}

pub fn trace_chain(
    root: &Path,
    from_symbol: &str,
    to_symbol: &str,
    max_depth: Option<usize>,
) -> Result<CallChain, String> {
    let depth = max_depth.unwrap_or(10);
    // BFS from 'from' to 'to'
    let mut chains: Vec<Vec<ChainNode>> = Vec::new();

    // Simple implementation: find files containing both symbols
    let from_refs = find_references(root, from_symbol, "", Some(50))?;
    let to_refs = find_references(root, to_symbol, "", Some(50))?;

    // Find common files
    let from_files: HashSet<&str> = from_refs.iter().map(|r| r.file.as_str()).collect();
    let to_files: HashSet<&str> = to_refs.iter().map(|r| r.file.as_str()).collect();
    let common: Vec<_> = from_files.intersection(&to_files).collect();

    if !common.is_empty() {
        // Direct connection: same file
        for file in common.iter().take(3) {
            if let (Some(from_r), Some(to_r)) = (
                from_refs.iter().find(|r| r.file == **file),
                to_refs.iter().find(|r| r.file == **file),
            ) {
                chains.push(vec![
                    ChainNode { symbol: from_symbol.to_string(), file: file.to_string(), line: from_r.line },
                    ChainNode { symbol: to_symbol.to_string(), file: file.to_string(), line: to_r.line },
                ]);
            }
        }
    }

    if chains.is_empty() {
        // No direct path found
        chains.push(vec![
            ChainNode { symbol: from_symbol.to_string(), file: from_refs.first().map(|r| r.file.clone()).unwrap_or_default(), line: from_refs.first().map(|r| r.line).unwrap_or(0) },
            ChainNode { symbol: "(intermediate calls)".to_string(), file: "".to_string(), line: 0 },
            ChainNode { symbol: to_symbol.to_string(), file: to_refs.first().map(|r| r.file.clone()).unwrap_or_default(), line: to_refs.first().map(|r| r.line).unwrap_or(0) },
        ]);
    }

    let shortest = chains.iter().map(|c| c.len()).min().unwrap_or(0);

    Ok(CallChain {
        chains: chains.into_iter().take(20).collect(),
        shortest_length: shortest,
    })
}

pub fn file_deps(
    root: &Path,
    file_path: &str,
    direction: &str,
) -> Result<Vec<FileDep>, String> {
    let content = fs::read_to_string(root.join(file_path))
        .map_err(|e| format!("Read error: {}", e))?;
    let ext = Path::new(file_path).extension().and_then(|e| e.to_str()).unwrap_or("");
    let patterns = get_patterns(ext).ok_or("Unsupported language")?;

    let mut deps = Vec::new();

    // Find imports in this file
    if direction == "imports" || direction == "both" {
        for cap in patterns.import_single.captures_iter(&content) {
            let module = cap.get(1).unwrap().as_str().to_string();
            let dep_type = if module.starts_with('.') || module.starts_with('/') || module.starts_with("..") {
                "internal"
            } else if module.starts_with("node:") || is_stdlib(ext, &module) {
                "stdlib"
            } else {
                "external"
            };
            deps.push(FileDep { path: module, dep_type: dep_type.to_string(), symbols: vec![] });
        }
        for cap in patterns.import_multi.captures_iter(&content) {
            let module = cap.get(2).or_else(|| cap.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
            if !module.is_empty() && !deps.iter().any(|d: &FileDep| d.path == module) {
                let dep_type = if module.starts_with('.') || module.starts_with('/') { "internal" }
                    else if is_stdlib(ext, &module) { "stdlib" } else { "external" };
                deps.push(FileDep { path: module, dep_type: dep_type.to_string(), symbols: vec![] });
            }
        }
    }

    // Find files that import this file (reverse lookup)
    if direction == "imported_by" || direction == "both" {
        let file_stem = Path::new(file_path).file_stem()
            .and_then(|s| s.to_str()).unwrap_or("");
        for entry in WalkDir::new(root).max_depth(15).into_iter()
            .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
            .flatten()
            .filter(|e| e.file_type().is_file())
        {
            if entry.path() == root.join(file_path) { continue; }
            if let Ok(import_content) = fs::read_to_string(entry.path()) {
                let rel = entry.path().strip_prefix(root).unwrap_or(entry.path());
                if import_content.contains(file_stem) {
                    let rel_str = rel.to_string_lossy().to_string();
                    if !deps.iter().any(|d: &FileDep| d.path == rel_str) {
                        deps.push(FileDep { path: rel_str, dep_type: "internal".into(), symbols: vec![] });
                    }
                }
            }
        }
    }

    Ok(deps)
}

#[derive(Debug, Clone, Serialize)]
pub struct FileDep {
    pub path: String,
    pub dep_type: String,
    pub symbols: Vec<String>,
}

pub fn blast_radius(
    root: &Path,
    file_path: &str,
    symbol_name: Option<&str>,
) -> Result<BlastRadius, String> {
    let mut affected = Vec::new();
    let target_name = symbol_name.unwrap_or("");

    // 1. Check file dependencies
    let deps = file_deps(root, file_path, "imported_by").unwrap_or_default();
    for dep in &deps {
        affected.push(AffectedFile {
            path: dep.path.clone(),
            reason: "imports this file".into(),
            affected_symbols: vec![],
        });
    }

    // 2. Find references to the target symbol
    if !target_name.is_empty() {
        let refs = find_references(root, target_name, file_path, Some(100)).unwrap_or_default();
        for r in &refs {
            if r.file != file_path {
                if let Some(af) = affected.iter_mut().find(|a: &&mut AffectedFile| a.path == r.file) {
                    af.affected_symbols.push(format!("line {}", r.line));
                } else {
                    affected.push(AffectedFile {
                        path: r.file.clone(),
                        reason: format!("references '{}'", target_name),
                        affected_symbols: vec![format!("line {}", r.line)],
                    });
                }
            }
        }
    }

    let count = affected.len();
    let risk_level = if count > 20 { "high" } else if count > 5 { "medium" } else { "low" };
    let summary = if !target_name.is_empty() {
        format!("Changing '{}' in {} affects {} files (risk: {})", target_name, file_path, count, risk_level)
    } else {
        format!("Changing {} affects {} files (risk: {})", file_path, count, risk_level)
    };

    Ok(BlastRadius {
        affected_files: affected,
        risk_level: risk_level.to_string(),
        summary,
    })
}

// ── Helpers ──

fn find_line(content: &str, byte_pos: usize) -> usize {
    content[..byte_pos].lines().count()
}

fn extract_doc_comment(lines: &[&str], symbol_line: usize) -> Option<String> {
    if symbol_line == 0 { return None; }
    let mut comments = Vec::new();
    let mut i = symbol_line.saturating_sub(1);
    loop {
        let line = lines.get(i)?.trim();
        if line.starts_with("///") || line.starts_with("//") || line.starts_with("##") || line.starts_with("/**") || line.starts_with(" *") || line.starts_with("*/") {
            comments.push(line.to_string());
        } else if line.starts_with("\"\"\"") || line.starts_with("'''") {
            comments.push(line.to_string());
            break;
        } else {
            break;
        }
        if i == 0 { break; }
        i -= 1;
    }
    if comments.is_empty() { None } else {
        comments.reverse();
        Some(comments.join("\n"))
    }
}

fn extract_function_body(content: &str, fn_name: &str) -> Result<String, String> {
    let patterns = [
        format!("fn {}\\s*[<(]", fn_name),
        format!("def {}\\s*\\(", fn_name),
        format!("function {}\\s*[<(]", fn_name),
    ];

    for pattern in &patterns {
        let re = Regex::new(pattern).ok();
        if let Some(re) = re {
            if let Some(m) = re.find(content) {
                let start = m.start();
                let rest = &content[start..];
                let mut depth = 0;
                let mut in_string = false;
                let mut end = 0;
                for (i, ch) in rest.char_indices() {
                    match ch {
                        '{' if !in_string => { depth += 1; }
                        '}' if !in_string => {
                            depth -= 1;
                            if depth == 0 { end = i + 1; break; }
                        }
                        '"' | '\'' | '`' => { in_string = !in_string; }
                        _ => {}
                    }
                }
                if end > 0 {
                    return Ok(rest[..end].to_string());
                }
            }
        }
    }
    Err(format!("Could not find body of '{}'", fn_name))
}

fn is_keyword(ext: &str, word: &str) -> bool {
    let keywords: &[&str] = match ext {
        "ts" | "tsx" | "js" | "jsx" => &["if", "else", "for", "while", "return", "break", "continue", "new", "typeof", "instanceof", "try", "catch", "throw", "await", "async", "const", "let", "var", "import", "export", "default", "switch", "case", "class", "function", "this", "super", "true", "false", "null", "undefined"],
        "py" => &["if", "elif", "else", "for", "while", "return", "break", "continue", "def", "class", "import", "from", "try", "except", "raise", "with", "as", "pass", "yield", "lambda", "True", "False", "None", "self", "cls", "print", "len", "range", "int", "str", "list", "dict", "set", "tuple"],
        "rs" => &["fn", "let", "mut", "const", "if", "else", "for", "while", "loop", "return", "break", "continue", "match", "use", "mod", "pub", "struct", "enum", "trait", "impl", "where", "as", "in", "self", "Self", "super", "crate", "true", "false", "None", "Some", "Ok", "Err", "move", "async", "await", "ref", "dyn", "static", "unsafe", "extern"],
        _ => &[],
    };
    keywords.contains(&word)
}

fn is_stdlib(ext: &str, module: &str) -> bool {
    match ext {
        "ts" | "tsx" | "js" | "jsx" => ["fs", "path", "os", "http", "https", "stream", "buffer", "url", "crypto", "events", "util", "assert", "child_process", "net", "tls", "dns", "readline"].contains(&module),
        "py" => ["os", "sys", "json", "re", "math", "datetime", "collections", "itertools", "functools", "pathlib", "typing", "io", "csv", "hashlib", "logging", "subprocess", "threading", "asyncio", "unittest", "argparse", "enum", "dataclasses"].contains(&module),
        "rs" => module.starts_with("std::") || module.starts_with("core::") || module.starts_with("alloc::") || ["std", "core", "alloc"].contains(&module),
        _ => false,
    }
}
