## ADDED Requirements

### Requirement: Generic ACP transport binary

The system SHALL provide a single binary `scripts/wrappers/ralph-acp` that
drives any ACP-speaking agent (hermes acp, gemini --acp, codex-acp,
claude-agent-acp) via JSON-RPC over stdio, with no per-agent code duplication.

#### Scenario: Default invocation drives hermes acp
- **WHEN** the binary is invoked as `ralph-acp` with no env overrides
- **THEN** the binary spawns `hermes acp` and performs the full ACP handshake
  (initialize, session/new, session/prompt)

#### Scenario: Custom agent binary override
- **WHEN** env `RALPH_ACP_BINARY` is set to `gemini --acp`
- **THEN** the binary spawns `gemini --acp` instead of the default

#### Scenario: Unknown agent default fallback
- **WHEN** the binary is invoked as `ralph-acp-unknownagent` and the agent is
  not in the dispatch table
- **THEN** the binary defaults to spawning `ralph-acp-unknownagent` as the
  command and logs a warning to stderr

### Requirement: Agent identity via argv[0] detection

The system SHALL derive the agent identity from the invocation name
(argv[0] basename) when the name matches the pattern `ralph-acp-<agent>`. This
identity SHALL affect the `CLIENT_INFO.name` sent during ACP initialize and the
default binary command (via dispatch table).

#### Scenario: Hermes symlink identity
- **WHEN** the binary is invoked via a symlink named `ralph-acp-hermes`
- **THEN** `CLIENT_INFO.name` is `ralph-acp-hermes` and the default binary
  command is `hermes acp`

#### Scenario: Gemini symlink identity
- **WHEN** the binary is invoked via a symlink named `ralph-acp-gemini`
- **THEN** `CLIENT_INFO.name` is `ralph-acp-gemini` and the default binary
  command is `gemini --acp`

#### Scenario: Explicit env overrides argv[0]
- **WHEN** env `RALPH_ACP_AGENT` is set to `gemini` and argv[0] is
  `ralph-acp-hermes`
- **THEN** the agent identity is `gemini` (env wins over argv[0])

#### Scenario: No identity detection falls back to default
- **WHEN** the binary is invoked as `ralph-acp` (no suffix) and
  `RALPH_ACP_AGENT` is not set
- **THEN** the agent identity defaults to `acp`

### Requirement: Per-agent binary dispatch table

The system SHALL include a dispatch table mapping known agent identities to
their default binary commands, so that common agents (hermes, gemini, codex,
claude) work without requiring the user to set `RALPH_ACP_BINARY`.

#### Scenario: Hermes dispatch entry
- **WHEN** agent identity is `hermes` and `RALPH_ACP_BINARY` is not set
- **THEN** the binary command is `hermes acp`

#### Scenario: Gemini dispatch entry
- **WHEN** agent identity is `gemini` and `RALPH_ACP_BINARY` is not set
- **THEN** the binary command is `gemini --acp`

#### Scenario: Codex dispatch entry
- **WHEN** agent identity is `codex` and `RALPH_ACP_BINARY` is not set
- **THEN** the binary command is `codex-acp`

#### Scenario: Claude dispatch entry
- **WHEN** agent identity is `claude` and `RALPH_ACP_BINARY` is not set
- **THEN** the binary command is `npx -y @agentclientprotocol/claude-agent-acp`

### Requirement: Generalized environment variable prefix

The system SHALL use the `RALPH_ACP_*` env prefix for all configuration. The
legacy `RALPH_HERMES_ACP_*` prefix SHALL be honored as a fallback for
back-compat, with a deprecation warning logged to stderr when the fallback is
used.

#### Scenario: New prefix takes precedence
- **WHEN** both `RALPH_ACP_BINARY` and `RALPH_HERMES_ACP_BINARY` are set
- **THEN** the value of `RALPH_ACP_BINARY` is used and no warning is logged

#### Scenario: Legacy prefix fallback with warning
- **WHEN** `RALPH_ACP_BINARY` is not set and `RALPH_HERMES_ACP_BINARY` is set
- **THEN** the value of `RALPH_HERMES_ACP_BINARY` is used AND a deprecation
  warning is logged to stderr

#### Scenario: No env uses defaults
- **WHEN** neither `RALPH_ACP_BINARY` nor `RALPH_HERMES_ACP_BINARY` is set
- **THEN** the dispatch table default for the agent identity is used

### Requirement: Backward-compatible hermes-acp entry point

The system SHALL maintain a working entry point at
`~/.config/open-ralph-wiggum/wrappers/ralph-hermes-acp` that resolves to the
generic `ralph-acp` binary, so existing `agents.json` entries with
`type: "hermes-acp"` continue to work without modification.

#### Scenario: Existing agents.json hermes-acp entry works
- **WHEN** ralph invokes `--agent hermes-acp` which calls the
  `ralph-hermes-acp` wrapper
- **THEN** the generic `ralph-acp` binary is executed with agent identity
  `hermes` (derived from the `ralph-hermes-acp` → `ralph-acp-hermes` mapping
  or from the legacy `RALPH_HERMES_*` env)

#### Scenario: Legacy symlink preserves hermes identity
- **WHEN** the symlink `ralph-hermes-acp` is invoked
- **THEN** the agent identity is `hermes` (not `acp`), ensuring the dispatch
  table resolves to `hermes acp`

### Requirement: Agent-agnostic CLIENT_INFO

The system SHALL populate `CLIENT_INFO.name` dynamically based on the resolved
agent identity, formatted as `ralph-acp-<agent>`, rather than hardcoding
`ralph-hermes-acp`.

#### Scenario: Hermes identity CLIENT_INFO
- **WHEN** agent identity is `hermes`
- **THEN** `CLIENT_INFO.name` is `ralph-acp-hermes`

#### Scenario: Gemini identity CLIENT_INFO
- **WHEN** agent identity is `gemini`
- **THEN** `CLIENT_INFO.name` is `ralph-acp-gemini`

#### Scenario: Default identity CLIENT_INFO
- **WHEN** agent identity is `acp` (no detection)
- **THEN** `CLIENT_INFO.name` is `ralph-acp-acp`

### Requirement: Per-agent zero-code addition via symlinks

The system SHALL allow adding a new ACP agent by creating a symlink named
`ralph-acp-<agent>` pointing to the generic `ralph-acp` binary, with no code
changes required — provided the agent is in the dispatch table or the user
sets `RALPH_ACP_BINARY`.

#### Scenario: Add codex agent via symlink only
- **WHEN** a symlink `ralph-acp-codex` → `ralph-acp` is created and invoked
- **THEN** the agent identity is `codex`, the binary command resolves to
  `codex-acp` via dispatch table, and the ACP handshake completes

#### Scenario: Add unknown agent via symlink + env
- **WHEN** a symlink `ralph-acp-custom` → `ralph-acp` is created and
  `RALPH_ACP_BINARY` is set to `custom-acp-binary`
- **THEN** the agent identity is `custom`, the binary command is
  `custom-acp-binary`, and the ACP handshake completes
