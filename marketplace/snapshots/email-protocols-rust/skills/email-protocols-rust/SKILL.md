---
name: email-protocols-rust
description: Use Email Protocols to configure and operate IMAP/SMTP or POP3/SMTP email accounts from Codex.
---

# Email Protocols 使用说明

Email Protocols 提供标准邮箱协议工具，支持 `IMAP/SMTP` 和 `POP3/SMTP` 账号。工具列表会根据当前激活账号动态变化：IMAP 账号显示完整邮箱管理能力，POP3 账号只显示 POP3 协议真实支持的读取、导出、附件和删除能力。

不要在对话里要求用户提供邮箱登录密码或客户端专用凭据。首次配置请使用 `mail_open_config_ui`，客户端专用密码只写入本机 `.env`，配置 JSON 只保存 `passwordEnv`。

## 快速开始

首次安装或没有账号配置时，优先调用：

- `mail_open_config_ui`：打开本地配置页面，填写邮箱账号、客户端专用密码、服务商和默认协议。
- `mail_validate_config`：检查配置文件、激活账号、协议和密钥环境是否完整。
- `mail_list_accounts`：查看已配置账号，不应输出密码。
- `mail_get_account_capabilities`：确认当前账号是 IMAP 还是 POP3，以及支持哪些工具。
- `mail_test_connection`：测试 IMAP/POP3/SMTP 连接。
- `mail_get_runtime_diagnostics`：排查 MCP 连接、超时、日志、慢调用等问题。

切换默认账号或默认协议后，通常需要新开线程或重连 MCP，让 Codex 重新读取动态工具列表。

## 通用规则

- `tools/list` 只基于当前激活账号暴露工具，不暴露所有账号能力的并集。
- SMTP 工具只在当前账号配置了 SMTP 时出现。
- 删除邮件、删除文件夹、POP3 `DELE`、IMAP `EXPUNGE` 等危险操作必须传 `confirm: true`。
- 列表和预览工具应保持轻量：优先使用 `mail_list_messages` 和 `mail_preview_message`。
- 只有确实需要完整正文、HTML 或附件元数据时，才使用 `mail_get_message`。
- 附件下载路径只能写入配置下载目录或当前工作区允许路径。
- stdout 必须只保留 JSON-RPC；日志、诊断和错误详情应通过 stderr 或日志文件查看。

## IMAP/SMTP 账号

IMAP 适合需要完整邮箱管理的账号。它支持文件夹、搜索、UID、标记、复制、移动、删除、清理、追加邮件和线程相关操作。IMAP+SMTP 当前暴露 34 个工具；没有 SMTP 时隐藏发信工具。

### 常用读取工具

- `mail_list_folders`：列出邮箱文件夹。
- `mail_get_mailbox_status`：查看指定文件夹邮件数量、未读数等状态。
- `mail_list_messages`：读取邮件摘要，使用 header-only fetch，不下载完整邮件和附件。
- `mail_search_messages`：服务端搜索邮件，返回轻量摘要。
- `mail_preview_message`：读取邮件头和有限正文片段，适合快速查看内容。
- `mail_get_message`：读取完整邮件正文、HTML 和附件元数据。
- `mail_get_raw_message`：读取原始 RFC822 内容。
- `mail_get_thread`：基于 Message-ID、References、In-Reply-To 查找相关邮件。

推荐顺序：先 `mail_list_messages` 或 `mail_search_messages`，再对目标邮件调用 `mail_preview_message`，最后只在需要完整内容时调用 `mail_get_message`。

### 附件工具

- `mail_list_attachments`：只做 header-only 附件提示，不默认下载整封邮件；结果可能是 `partial: true`。
- `mail_download_attachment`：下载单个附件，需要 `attachmentId`。
- `mail_download_attachments`：下载全部附件。

如果 `mail_list_attachments` 返回 partial，但用户需要准确附件清单，应先调用 `mail_get_message` 获取完整 MIME 解析结果。

### 邮件管理工具

- `mail_mark_message` / `mail_mark_messages`：标记已读、未读、星标等。
- `mail_copy_messages`：复制邮件到目标文件夹。
- `mail_move_message` / `mail_move_messages`：移动邮件；服务器不支持 MOVE 时可能使用 copy + delete fallback。
- `mail_delete_message` / `mail_delete_messages`：删除邮件，危险操作必须确认。
- `mail_expunge_folder`：永久清理已删除邮件，必须 `confirm: true`。
- `mail_append_message`：向 IMAP 文件夹追加邮件。
- `mail_create_folder`、`mail_rename_folder`、`mail_delete_folder`：管理文件夹；删除文件夹必须确认。

### SMTP 发信工具

- `mail_preview_send`：只构造 MIME 预览，不发送。
- `mail_send_message`：发送新邮件。
- `mail_send_reply`：回复已有邮件，自动引用原邮件头。
- `mail_forward_message`：转发已有邮件，可选择包含原附件。

发信前优先使用 `mail_preview_send` 检查收件人、主题、附件和 MIME 摘要。

## POP3/SMTP 账号

POP3 适合简单收信和下载场景。POP3 没有标准文件夹、服务器端标记、移动、复制、线程聚合、append 或 expunge 语义，因此这些工具不会暴露，也不应模拟实现。POP3+SMTP 当前暴露 22 个工具；没有 SMTP 时隐藏发信工具。

### POP3 支持的读取工具

- `mail_get_mailbox_status`：使用 POP3 `STAT` 获取邮件数量和大小。
- `mail_list_messages`：使用 `LIST + TOP` 读取摘要，不默认 `RETR` 整封邮件。
- `mail_search_messages`：本地限量扫描后搜索，必须设置合理的 `maxMessages` 上限。
- `mail_preview_message`：使用 `TOP` 获取有限正文片段。
- `mail_get_message`：使用 `RETR` 获取完整邮件。
- `mail_get_raw_message`：获取原始邮件内容。
- `mail_export_message`：导出 `.eml` 文件。

推荐顺序：先 `mail_get_mailbox_status`，再 `mail_list_messages`，需要查看正文时用 `mail_preview_message`，只有导出、完整读取或附件下载时才使用 `mail_get_message` 或下载工具。

### POP3 附件工具

- `mail_list_attachments`：只做 header-only 附件提示；POP3 下可能返回 `partial: true`。
- `mail_download_attachment`：下载单个附件，会显式获取完整邮件。
- `mail_download_attachments`：下载全部附件，会显式获取完整邮件。

POP3 附件精确枚举通常需要完整 MIME 内容，不要在列表摘要阶段下载附件。

### POP3 删除工具

- `mail_delete_message`
- `mail_delete_messages`

POP3 删除会使用 `DELE`，并在 `QUIT` 后由服务器提交删除。必须传 `confirm: true`。不要把 POP3 删除伪装成移动到回收站，因为 POP3 没有标准文件夹语义。

### POP3 不支持的能力

POP3 不支持以下 IMAP 管理类能力：

- 文件夹列表和文件夹管理
- 移动、复制邮件
- 标记已读、未读、星标
- 线程聚合
- append
- expunge

如果旧工具列表里仍能看到这些工具，调用时也应返回 `protocol_unsupported`。

## 常用调用链

### 首次配置邮箱

适用于插件刚安装、还没有账号配置的情况。

1. `mail_open_config_ui`
2. 用户在本地页面填写邮箱账号、客户端专用密码、服务商、默认协议
3. 新开线程或重连 MCP
4. `mail_validate_config`
5. `mail_list_accounts`
6. `mail_get_account_capabilities`
7. `mail_test_connection`

如果 `tools/list` 仍只显示启动/诊断工具，通常说明 Codex 还没有重新加载 MCP，或当前配置没有可用 active account。

### 查看最近邮件摘要

IMAP 推荐：

1. `mail_get_mailbox_status`
2. `mail_list_messages`，指定 `folder` 和 `limit`
3. 对目标邮件调用 `mail_preview_message`
4. 只有需要完整正文、HTML 或附件元数据时，再调用 `mail_get_message`

POP3 推荐：

1. `mail_get_mailbox_status`
2. `mail_list_messages`，指定较小 `limit`
3. 对目标邮件调用 `mail_preview_message`
4. 只有确实需要完整内容时，再调用 `mail_get_message`

不要为了查看列表直接调用 `mail_get_message` 批量读取邮件。

### 搜索邮件

IMAP 推荐：

1. `mail_search_messages`
2. 对搜索结果中的目标邮件调用 `mail_preview_message`
3. 需要完整内容时调用 `mail_get_message`

POP3 推荐：

1. `mail_search_messages`，必须设置合理的 `maxMessages`
2. 对结果调用 `mail_preview_message`
3. 需要完整内容时调用 `mail_get_message`

POP3 搜索是本地限量扫描，不是服务器端全文搜索。不要设置过大的 `maxMessages`，避免等待时间过长。

### 查看附件并下载

IMAP 推荐：

1. `mail_list_messages` 或 `mail_search_messages` 找到邮件
2. `mail_preview_message` 确认邮件内容
3. `mail_get_message` 获取完整 MIME 和附件元数据
4. `mail_download_attachment` 下载指定附件，或 `mail_download_attachments` 下载全部附件

POP3 推荐：

1. `mail_list_messages` 找到邮件
2. `mail_preview_message` 确认邮件内容
3. `mail_get_message` 获取完整 MIME
4. `mail_download_attachment` 或 `mail_download_attachments`

`mail_list_attachments` 是轻量提示工具，可能返回 `partial: true`。如果用户需要精确附件清单，应使用 `mail_get_message`。

### 导出邮件为 .eml

IMAP：

1. `mail_list_messages` 或 `mail_search_messages`
2. `mail_export_message`，传入 `folder`、`messageId`、`outputPath`

POP3：

1. `mail_list_messages`
2. `mail_export_message`，传入 `messageId`、`outputPath`

导出会获取完整原始邮件。`outputPath` 必须在允许的工作区或下载目录内。

### 回复邮件

适用于配置了 SMTP 的账号。

1. `mail_list_messages` 或 `mail_search_messages`
2. `mail_preview_message` 确认目标邮件
3. `mail_send_reply`，传入 `messageId`、正文、收件人补充信息
4. 如需先检查内容，可先用 `mail_preview_send` 构造发送预览

IMAP 回复通常需要 `folder + messageId`。POP3 回复使用 `messageId` 获取原邮件头。不要在未确认目标邮件前直接回复。

### 转发邮件

适用于配置了 SMTP 的账号。

1. `mail_list_messages` 或 `mail_search_messages`
2. `mail_preview_message` 确认目标邮件
3. `mail_forward_message`
4. 如果需要带原附件，显式设置包含附件的参数

转发带附件会读取完整原邮件，耗时会比普通转发更长。

### 发送新邮件

1. `mail_preview_send`
2. 检查收件人、抄送、密送、主题、正文、附件摘要
3. `mail_send_message`

`mail_preview_send` 不会发送邮件，适合在正式发送前校验 MIME、收件人数量和附件路径。

### 标记或移动邮件

仅 IMAP 支持。

标记邮件：

1. `mail_list_messages`
2. `mail_mark_message` 或 `mail_mark_messages`

移动邮件：

1. `mail_list_folders` 确认目标文件夹
2. `mail_move_message` 或 `mail_move_messages`

如果是删除类标记或 move fallback 涉及删除语义，应按工具要求传 `confirm: true`。

### 删除邮件

IMAP：

1. `mail_list_messages` 或 `mail_search_messages`
2. `mail_delete_message` 或 `mail_delete_messages`，必须 `confirm: true`
3. 如需永久清理，再调用 `mail_expunge_folder`，也必须 `confirm: true`

POP3：

1. `mail_list_messages`
2. `mail_delete_message` 或 `mail_delete_messages`，必须 `confirm: true`

POP3 删除是 `DELE + QUIT` 提交，不存在“移动到回收站”的标准语义。

### 创建和管理文件夹

仅 IMAP 支持。

创建文件夹：

1. `mail_list_folders`
2. `mail_create_folder`
3. 再次 `mail_list_folders` 确认

重命名文件夹：

1. `mail_list_folders`
2. `mail_rename_folder`

删除文件夹：

1. `mail_list_folders`
2. 确认目标文件夹无误
3. `mail_delete_folder`，必须 `confirm: true`

POP3 不支持文件夹工具，不应尝试模拟。

### 排查连接慢或 MCP 断开

1. `mail_get_runtime_diagnostics`
2. `mail_validate_config`
3. `mail_test_connection`
4. 如果读取慢，优先用 `mail_get_mailbox_status` 和 `mail_list_messages` 验证轻量路径
5. 查看返回的 `elapsedMs`、`bytesFetched`、`summarySource`、`partial`

如果 `mail_validate_config` 都很慢，通常不应是网络取信问题；应优先检查配置读取、日志路径、MCP 进程启动和 stdout/stderr 是否被污染。

## 性能建议

- 优先使用摘要和预览工具，避免一开始读取完整邮件。
- `mail_list_messages` 应只拉取头部、大小、flags 或 POP3 `TOP` 摘要。
- `mail_preview_message` 应限制正文大小。
- 需要附件时再显式调用下载工具。
- 排查慢调用时查看返回字段中的 `elapsedMs`、`bytesFetched`、`summarySource`、`partial`，再调用 `mail_get_runtime_diagnostics`。

## 安全注意事项

- 不要把邮箱账号、客户端专用密码、`.env` 内容、原始邮件正文或附件内容直接贴到公开 issue、PR 或日志里。
- 不要把用户密码写入 JSON 配置。
- 不要让危险操作在缺少 `confirm: true` 时执行。
- 不要在 POP3 下模拟 IMAP 文件夹或标记能力。
- 不要让 MCP 服务向 stdout 输出日志或调试文本。
