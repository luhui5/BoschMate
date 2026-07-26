# YourMate 用户手册

> 版本: 0.4.0 | 更新: 2026-07-18

## 快速开始

### 安装与启动

```bash
pnpm install
pnpm tauri dev
```

首次启动会引导你完成 Onboarding 流程：选择 Ollama 模型 → 打开项目文件夹 → 配置 Git。

### 创建项目

1. 在主页点击「新建项目」
2. 选择本地文件夹
3. 项目会自动创建并打开工作区

## 工作区界面

### 左侧栏
- **文件树**：浏览项目文件，右键可打开/复制路径/资源管理器打开
- **会话列表**：历史会话记录
- **Git 面板**：查看状态、提交、切换分支、Stash

### 中央聊天区
- **Agent 模式切换**：
  - **Plan（规划）**：生成执行计划，不修改文件
  - **Ask（提问）**：只读查询，可搜索代码库
  - **Edit（编辑）**：逐文件编辑，每次变更需确认
  - **Auto（自动）**：全自动修改 + 测试 + Lint

- **消息输入**：Ctrl+Enter 发送，Shift+Enter 换行
- **工具活动面板**：实时显示 AI 的工具调用过程
- **Diff 卡片**：预览和接受/拒绝代码变更

### 右侧栏
- **变更面板**：查看当前会话的所有文件变更
- **审计日志**：查看所有 Shell 命令执行记录，支持筛选和 CSV 导出

## 核心功能

### AI Agent 工具

| 工具名 | 功能 |
|--------|------|
| `read_file` | 读取文件内容（支持偏移量和行数） |
| `write_file` | 创建/覆盖文件 |
| `edit_file` | 精确字符串替换 |
| `search_replace` | 正则批量替换 |
| `grep` | 正则搜索文件内容 |
| `glob` | Glob 模式查找文件 |
| `bash` | 沙箱内执行 Shell 命令 |
| `web_search` | DuckDuckGo 网络搜索 |
| `web_fetch` | 抓取网页内容为 Markdown |
| `git_status` / `git_diff` / `git_log` | Git 操作 |
| `git_commit` / `git_push` | Git 提交和推送 |
| `list_symbols` / `find_references` | 代码符号分析 |
| `outlook_read` / `outlook_send` | Outlook 邮件（Windows） |

### Git 工作流

1. Agent 修改文件
2. 变更显示在右侧「变更面板」
3. 用户接受/拒绝每处变更
4. Agent 使用 `git_commit` 提交
5. `git_push` 会弹出确认对话框（强制推送被阻止）

### 知识库

1. 在创建项目时可选择关联知识库
2. 知识库支持 PDF、DOCX、XLSX 等格式
3. 支持全文搜索和向量语义检索
4. Agent 可使用 `search_knowledge` 工具查询

### 长期记忆

- Agent 会自动创建和更新记忆
- 记忆支持 AES-256-GCM 加密
- 压缩器定期将相关记忆合并
- 记忆链接支持关联关系

### Skill 技能

Skills 是用户可安装的扩展，为 Agent 提供额外能力。

- 在设置 > 集成中管理已安装技能
- 支持启用/禁用/卸载
- Skill 可定义自定义 AI 工具（`YourMate.skill.json` 中的 `tools[]`）

## 设置

### 模型配置
- 选择 Ollama 模型（默认 nomic-embed-text 用于 embedding）
- 模型列表自动从本地 Ollama 获取

### 隐私与安全
- 网络白名单：限制 Agent 网络访问域名
- 记忆加密：启用后记忆内容使用 AES-256-GCM 加密
- 遥测开关

### 快捷键

| 操作 | 快捷键 |
|------|--------|
| 发送消息 | Ctrl+Enter |
| 换行 | Shift+Enter |
| 停止生成 | Ctrl+. |
| 切换 Agent 模式 | Ctrl+M |
| 切换左侧栏 | Ctrl+B |
| 切换右侧栏 | Ctrl+Alt+B |

快捷键可在设置 > 快捷键中自定义录制。

### 数据库维护

1. 设置 > 关于 > 数据库修复
2. 检查 SQLite 完整性和向量索引状态
3. 如有问题可执行修复（WAL checkpoint + 索引重建）

## 数据导入导出

- **导出**：导入/导出包含 7 张表（sessions/messages/memories/settings 等）
- 导出格式为 JSON，支持 version 2 格式

## 更新

- 在设置 > 关于中查看当前版本
- 自动检测 GitHub 最新 release
- 下载和安装进度提示

## 故障排除

1. **模型加载失败**：检查 Ollama 是否在运行，`ollama list` 确认模型已安装
2. **向量索引异常**：使用数据库修复向导重建
3. **异常退出恢复**：重新启动时自动弹出恢复对话框
4. **Git 操作失败**：确认项目目录为有效的 Git 仓库
