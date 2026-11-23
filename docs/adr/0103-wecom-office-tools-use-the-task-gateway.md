# ADR 0103: WeCom office tools use the task gateway

- Status: Proposed
- Date: 2026-11-23
- Related: [ADR 0041](0041-agent-tools-through-a-local-mcp-gateway.md), [Agent tools](../spec/09-agent-tools.md)

## Context

The owner wants WeCom office capabilities without adding a second way to control AgentHerd.
WeCom issues separate, credential-bearing Streamable HTTP URLs for robot permissions.

## Decision

Add WeCom under app connections. Only the host uses the official endpoint URLs, which live
in the existing secret store. Reuse the remote MCP client and task gateway, but give WeCom
its own tool policy: anything not clearly read-only requires a decision on the existing
owner channel in every mode. Do not expose chat history, archiving or incoming events.

## Alternatives

- A WeCom channel: would add a second control and approval surface the owner does not need.
- A generic plugin: can reach MCP, but has a different import flow and policy and does not
  exclude chat history.
- The WeCom CLI: adds a local program and exposes command execution rather than the remote
  tool schemas and permission-specific scopes.

## Consequences

The owner authorizes individual capabilities in WeCom and can remove local credentials
without changing the Feishu channel. Only tools the server grants and the connector permits
are available. A real tenant is required to verify what its grants expose.
