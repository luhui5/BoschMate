# Changelog

## [Unreleased]

### Added
- P5: Retriever 语义检索 + FTS 关键词降级、MemoryCompressor、memory_links / vector_index_meta 表
- P6: Tool trait、Plan 模式、git_commit 工具、工具调用 UI、审计日志面板
- P7: Skill manifest 解析与运行时、SSH 连接历史、备份导出
- P8: E2E-1~6 Playwright 测试、pre-commit hook、CI E2E job
- P9: tracing 结构化日志、磁盘空间检查、SQLite 修复向导

### Changed
- 工作区聊天前自动注入 top-K 长期记忆上下文
- search_memories 支持 project_id 过滤与降级路径
