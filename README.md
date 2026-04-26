# Gemini CLI OpenAI Community Server Prompting

Personal fork of [RedBaron1914/gemini-cli-openai-community](https://github.com/RedBaron1914/gemini-cli-openai-community).

This fork keeps the original OpenAI-compatible Gemini Worker base and adds an optional RP prompting addon selected with `rp_mode`.

For the original Worker setup, deployment, authentication, and model notes, use the upstream README:
[RedBaron1914/gemini-cli-openai-community](https://github.com/RedBaron1914/gemini-cli-openai-community).

## RP Modes

- `none` - default proxy behavior. No RP addon is used.
- `my` - custom two-stage RP flow: planner/CoT first, then prose generated from that plan.
- `yaoshi` - structured RP flow with state handling, planner/CoT, prose, OOC handling, and initial state generation.

The default mode is `none` unless `DEFAULT_RP_MODE` is configured in the Worker environment.

## Custom Mode Files

The `my` mode is intentionally minimal. Edit these placeholder files:

- `src/addons/rp/prompt_parts/custom_prompt.txt`
- `src/addons/rp/prompt_parts/custom_cot.txt`
- `src/addons/rp/prompt_parts/custom_prose.txt`

The stage wiring stays in code, while the custom prompt content stays in separate text files.

## Selecting A Mode

Request body:

```json
{
  "model": "gemini-3.1-pro-preview",
  "rp_mode": "my",
  "messages": []
}
```

Nested client parameters are also supported:

```json
{
  "extra_body": {
    "rp_mode": "my"
  }
}
```

```json
{
  "model_params": {
    "rp_mode": "my"
  }
}
```

System prompt command:

```text
rp_mode=my
```

Worker default:

```bash
DEFAULT_RP_MODE=my
```

Request-level `rp_mode` overrides `DEFAULT_RP_MODE`.

## Development

```bash
npm install
npm run lint
npm run test:rp-runtime
npm run build
```

`wrangler.toml` is kept aligned with the upstream project. Configure your own Cloudflare account, KV namespace, project settings, and secrets outside this fork's committed config.

## Keeping The Fork Updated

Recommended remotes:

- `origin` - this fork.
- `upstream` - `https://github.com/RedBaron1914/gemini-cli-openai-community`.

Fetch and merge upstream changes when needed:

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

Optional safety setting:

```bash
git remote set-url --push upstream DISABLED
```
