# Kybernesis -- Kybernesis Cloud

Kybernesis is an optional cloud service that provides a queryable workspace memory for your KyberBot agent. It is entirely optional -- KyberBot works fully offline without it.

---

## What Is Kybernesis

Kybernesis is a hosted AI workspace platform that provides:

- **Cloud workspace memory** that your agent can search on demand
- **Cross-device access** so you can query the same workspace from anywhere
- **Web interface** for browsing and managing your workspace knowledge
- **API access** to your workspace memory from external tools

Kybernesis Local and Cloud are independent memory stores that complement each other. The agent queries Kybernesis Cloud when local memory does not have what it needs, and cloud results fill gaps in local recall. There is no sync -- it is a search and retrieval layer.

---

## How to Connect

### Step 1: Create a Kybernesis Account

Sign up at [kybernesis.ai](https://kybernesis.ai) and create a workspace.

### Step 2: Get Your API Key

In the Kybernesis dashboard, go to Settings > API Keys and generate a new key. The API key is tied to your workspace -- no other identifiers are needed.

### Step 3: Add the Key to .env

Add your API key to `.env`:

```env
KYBERNESIS_API_KEY=your_api_key_here
```

This can also be configured during the onboard wizard (`kyberbot onboard`).

That is all the configuration required. No `agent_id`, no `workspace_id`, no `identity.yaml` changes needed.

---

## CLI Commands

```bash
kyberbot kybernesis query "..."     # Search cloud workspace memory
kyberbot kybernesis list            # Browse all memories in the workspace
kyberbot kybernesis status          # Check connection status
kyberbot kybernesis disconnect      # Remove API key and switch to local-only
```

### Examples

```bash
# Search for something specific
kyberbot kybernesis query "What do I know about project pricing?"

# List recent memories with pagination
kyberbot kybernesis list --limit 20 --offset 0

# Check if Kybernesis Cloud is reachable
kyberbot kybernesis status
```

---

## Disconnecting

To switch back to local-only memory:

```bash
kyberbot kybernesis disconnect
```

This removes the `KYBERNESIS_API_KEY` from `.env`. After disconnecting:

1. Restart the server: `kyberbot`
2. Restart Claude: `/clear` or start a new session

Your cloud memories are preserved in your Kybernesis workspace -- nothing is deleted. To reconnect later, add `KYBERNESIS_API_KEY` back to `.env`.

---

## Privacy Considerations

### What Kybernesis Sees

When Kybernesis Cloud is configured, queries you send via `kyberbot kybernesis query` are processed by Kybernesis servers. Your workspace contains whatever memories you have stored there through the Kybernesis platform.

### What Kybernesis Does NOT See

- Your `.env` file (API keys, tokens, secrets)
- Your local memory (databases, markdown files)
- WhatsApp/Telegram session data
- Your Claude Code subscription credentials
- Anything stored only on your machine

### Data Handling

- Data is encrypted in transit (TLS) and at rest
- You can delete your workspace and all associated data at any time
- Kybernesis does not use your data for model training
- See the Kybernesis [privacy policy](https://kybernesis.ai/privacy) for full details

---

## Using Without Kybernesis

KyberBot is fully functional without Kybernesis. All memory, search, and agent features work locally. Kybernesis adds convenience (cloud-backed recall, cross-device access) but is not required for any core functionality.

If you prefer to manage your own backups, the entire brain is stored in your project directory under `data/` and `brain/`. You can back it up with any method you prefer (git, rsync, cloud storage, etc.).
