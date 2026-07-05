//! Document text extraction for knowledge base ingestion.

use calamine::{open_workbook_auto, Data, Reader};
use std::path::Path;

const DOC_LEGACY_MSG: &str = "旧版 .doc 格式不支持，请在 Word 中另存为 .docx 后重新上传";

pub fn parse_document(path: &Path, kind: &str) -> Result<String, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "txt" | "md" => parse_plain_text(path),
        "csv" => parse_plain_text(path),
        "xlsx" | "xls" => parse_spreadsheet(path),
        "docx" => parse_docx(path),
        "doc" => Err(DOC_LEGACY_MSG.into()),
        "pdf" => parse_pdf(path),
        _ => match kind {
            "text" => parse_plain_text(path),
            "excel" => {
                if ext == "csv" {
                    parse_plain_text(path)
                } else {
                    parse_spreadsheet(path)
                }
            }
            "word" => {
                if ext == "doc" {
                    Err(DOC_LEGACY_MSG.into())
                } else {
                    parse_docx(path)
                }
            }
            "pdf" => parse_pdf(path),
            other => Err(format!("不支持的文件类型: {}", other)),
        },
    }
}

fn parse_plain_text(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(s),
        Err(_) => {
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            Ok(String::from_utf8_lossy(&bytes).into_owned())
        }
    }
}

fn parse_spreadsheet(path: &Path) -> Result<String, String> {
    let mut workbook =
        open_workbook_auto(path).map_err(|e| format!("无法读取表格文件: {}", e))?;
    let sheet_names = workbook.sheet_names().to_vec();
    if sheet_names.is_empty() {
        return Err("表格文件没有可读取的工作表".into());
    }

    let mut out = String::new();
    for name in sheet_names {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|e| format!("读取工作表 {} 失败: {}", name, e))?;
        out.push_str(&format!("## Sheet: {}\n", name));
        for row in range.rows() {
            let cells: Vec<String> = row.iter().map(cell_to_string).collect();
            if cells.iter().any(|c| !c.is_empty()) {
                out.push_str(&cells.join("\t"));
                out.push('\n');
            }
        }
        out.push('\n');
    }
    Ok(out.trim().to_string())
}

fn cell_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::String(s) => s.clone(),
        Data::Float(f) => f.to_string(),
        Data::Int(i) => i.to_string(),
        Data::Bool(b) => b.to_string(),
        Data::DateTime(f) => f.to_string(),
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(e) => format!("{:?}", e),
    }
}

fn parse_docx(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let docx = docx_rs::read_docx(&bytes).map_err(|e| format!("无法解析 Word 文档: {}", e))?;
    let mut out = String::new();
    for child in docx.document.children {
        if let docx_rs::DocumentChild::Paragraph(p) = child {
            for run_child in p.children {
                if let docx_rs::ParagraphChild::Run(r) = run_child {
                    for text_child in r.children {
                        if let docx_rs::RunChild::Text(t) = text_child {
                            out.push_str(&t.text);
                        }
                    }
                }
            }
            out.push('\n');
        }
    }
    Ok(out.trim().to_string())
}

fn parse_pdf(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("无法解析 PDF: {}", e))
        .map(|s| s.trim().to_string())
}

pub fn parse_document_bytes(name: &str, kind: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = name
        .split('.')
        .next_back()
        .unwrap_or("")
        .to_lowercase();
    if ext == "doc" {
        return Err(DOC_LEGACY_MSG.into());
    }

    let tmp_dir = std::env::temp_dir().join(format!(
        "boschcode-knowledge-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let tmp_path = tmp_dir.join(name);
    std::fs::write(&tmp_path, bytes).map_err(|e| e.to_string())?;
    let result = parse_document(&tmp_path, kind);
    let _ = std::fs::remove_dir_all(&tmp_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_txt_bytes() {
        let text = parse_document_bytes("note.txt", "text", b"Hello knowledge").unwrap();
        assert_eq!(text, "Hello knowledge");
    }

    #[test]
    fn parse_md_bytes() {
        let text = parse_document_bytes("doc.md", "text", b"# Title\n\nBody").unwrap();
        assert!(text.contains("Title"));
    }

    #[test]
    fn parse_csv_bytes() {
        let csv = b"name,value\nfoo,1\nbar,2";
        let text = parse_document_bytes("data.csv", "excel", csv).unwrap();
        assert!(text.contains("foo"));
        assert!(text.contains("bar"));
    }

    #[test]
    fn rejects_legacy_doc() {
        let err = parse_document_bytes("old.doc", "word", b"fake").unwrap_err();
        assert!(err.contains("docx"));
    }
}
