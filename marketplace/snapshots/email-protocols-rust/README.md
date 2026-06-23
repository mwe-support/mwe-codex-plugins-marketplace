# Email Protocols Rust Preview

This directory is the installable runtime plugin used by Codex.

## Included Runtime

The MCP server entrypoint is:

```text
bin/email-protocols-mcp.exe
```

The `.mcp.json` file starts that executable directly. Users do not need Rust or
Cargo.

## First Run

After installing the plugin in Codex, call:

```text
mail_open_config_ui
```

The local setup page writes account config and a local `.env` file on the user's
machine. Do not commit mailbox config or `.env` files.

## User Guide

See `skills/email-protocols-rust/SKILL.md` for IMAP and POP3 tool usage,
calling chains, performance guidance, and safety notes.

