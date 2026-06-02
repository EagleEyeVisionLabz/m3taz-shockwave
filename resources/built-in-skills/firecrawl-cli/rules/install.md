---
name: firecrawl-cli-installation
description: |
  How the Firecrawl CLI is installed and authenticated inside Shockwave.
  Docs: https://docs.firecrawl.dev/sdks/cli
---

# Firecrawl CLI in Shockwave

## Already installed — do NOT install it

The `firecrawl` command is **bundled with Shockwave** and already on your PATH.
**Do NOT run** `npm install`, `npx firecrawl-cli`, `firecrawl init`, or
`firecrawl login` / `firecrawl config` — they don't apply here and may fail.
Just call `firecrawl ...` directly.

## Authentication — use the agent secret

Firecrawl reads its key from the `FIRECRAWL_API_KEY` environment variable.
Shockwave stores it as an **agent secret** named `FIRECRAWL_API_KEY`. Fetch it
with the `get_agent_secret` tool and pass it to the subprocess as an env var —
do not echo it, write it to a file, or persist it:

```bash
# read it via get_agent_secret, then:
FIRECRAWL_API_KEY="<key>" firecrawl search "query" --limit 3
```

Prefer setting the variable inline on the single command (as above) so the key
stays scoped to that one invocation.

## If the key is missing or empty

`firecrawl --status` will report it's not authenticated. Tell the user to open
**Settings → Agent Secrets** and paste their Firecrawl API key (from
firecrawl.dev) into the `FIRECRAWL_API_KEY` slot, then start a new chat.

## Verify

```bash
FIRECRAWL_API_KEY="<key>" firecrawl --status
```

Healthy when it prints `● Authenticated via FIRECRAWL_API_KEY` with credits
remaining.
