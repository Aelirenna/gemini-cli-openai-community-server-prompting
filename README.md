# Gemini CLI OpenAI Community Server Prompting

Personal fork of [RedBaron1914/gemini-cli-openai-community](https://github.com/RedBaron1914/gemini-cli-openai-community).

This fork keeps the original OpenAI-compatible Gemini Worker base and adds an optional RP prompting addon selected with `rp_mode`.

For the original Worker setup, deployment, authentication, and model notes, use the upstream README:
[RedBaron1914/gemini-cli-openai-community](https://github.com/RedBaron1914/gemini-cli-openai-community).

Install and deploy this fork the same way as the original project. The difference is the added RP addon files and the `rp_mode` switch.

## RP Modes

- `none` - default proxy behavior. No RP addon is used.
- `my` - custom two-stage RP flow: planner first, then prose generated from that plan. OOC is supported.
- `yaoshi` - structured RP flow with state handling, planner/CoT, prose, OOC handling, and initial state generation.

The default mode is `none` unless `DEFAULT_RP_MODE` is configured in the Worker environment.

## Custom Mode Files

The `my` mode is intentionally minimal. Edit these placeholder files:

- `src/addons/rp/prompt_parts/custom_system_prompt.txt`
- `src/addons/rp/prompt_parts/custom_planner_directive.txt`
- `src/addons/rp/prompt_parts/custom_prose.txt`

The stage wiring stays in code, while the custom prompt content stays in separate text files.

## Enabling A Mode

Set the Worker variable:

```bash
DEFAULT_RP_MODE=my
```

Allowed values:

- `none`
- `my`
- `yaoshi`

To override the Worker default for one chat, add this to that chat's system prompt:

```text
rp_mode=my
```

Optional RP Worker variables:

- `REASONING_EFFORT` - default thinking effort.
- `RP_PLANNER_MODEL` - planner model override for `my` mode.
- `RP_GM_PLANNER_MODEL` - GM planner model override for `yaoshi` mode.
- `RP_STATE_UPDATE_MODEL` - state update model override for `yaoshi` mode.

`wrangler.toml` is kept aligned with the upstream project. Configure your own Cloudflare account, KV namespace, project settings, Worker variables, and secrets the same way as in the original setup.
