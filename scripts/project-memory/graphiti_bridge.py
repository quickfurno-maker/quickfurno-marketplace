import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamablehttp_client

GROUP_ID = "quickfurno-marketplace"
MCP_URL = "http://127.0.0.1:18000/mcp/"
ROOT = Path(__file__).resolve().parents[2]
MEMORY_DIR = ROOT / "docs" / "project-memory"


def result_text(result):
    parts = []
    for item in getattr(result, "content", []) or []:
        text = getattr(item, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts)


async def with_session(callback):
    async with streamablehttp_client(MCP_URL) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            return await callback(session)

SEED_EPISODES = [
    {
        "name": "QF-DEC-001 Unified Project Brain v1",
        "reference_time": "2026-09-14T00:00:00Z",
        "body": "QuickFurno adopted Unified Project Brain v1: Graphify for repository intelligence, Graphiti for temporal project memory, docs/project-memory for reviewed canonical truth, Git/GitHub for immutable engineering history, and ChatGPT as the human-facing AI interface.",
    },
    {
        "name": "QF-DEC-005 Pune-only launch",
        "reference_time": "2026-09-14T00:00:00Z",
        "body": "QuickFurno current launch scope is Pune only. Mumbai is not an active launch city and must not be reintroduced without a later explicit reviewed decision.",
    },
    {
        "name": "QuickFurno AOS authority boundary",
        "reference_time": "2026-09-14T00:00:00Z",
        "body": "QuickFurno AOS V2 is advisory. AOS recommendations do not independently own business side effects. QuickFurno Core remains the authority boundary for governed mutations; n8n orchestrates but is not business authority.",
    },
    {
        "name": "Project Brain source baseline",
        "reference_time": "2026-09-14T00:00:00Z",
        "body": "Project Brain bootstrap source baseline is quickfurno-maker/quickfurno-marketplace main commit 2a5aa5f4cd2e77ea87d098b1a2e56881857fd464, merge of PR 84. Source validators at that baseline pin 111 migrations; source count does not prove live applied migration count.",
    },
]

SEED_EPISODES += [
    {
        "name": "Graphify repository graph activated",
        "reference_time": "2026-09-14T00:00:00Z",
        "body": "Graphify 0.9.61 was installed with MCP and SQL support for QuickFurno. The validated local graph contains 14,447 nodes, 28,548 edges and 652 communities across 1,090 code files including 139 SQL files. Generated graphify-out artifacts remain untracked.",
    },
    {
        "name": "ChatGPT-only Project Brain access",
        "reference_time": "2026-09-15T00:00:00Z",
        "body": "QuickFurno Project Brain is ChatGPT-first. Claude and Codex client wiring is not required. Because the user's current ChatGPT plan cannot directly attach the private local MCP server, reviewed Graphiti and Graphify snapshots are committed to GitHub for on-demand ChatGPT retrieval. Local Graphiti and Neo4j ports remain private localhost services.",
    },
]


async def cmd_tools(session):
    result = await session.list_tools()
    for tool in result.tools:
        print(tool.name)


async def cmd_status(session):
    result = await session.call_tool("get_status", {})
    print(result_text(result))

async def cmd_seed(session):
    runtime = ROOT / "infra" / "project-brain" / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    marker = runtime / "seed-v1.done"
    if marker.exists():
        print("GRAPHITI_SEED=ALREADY_DONE")
        return

    for episode in SEED_EPISODES:
        result = await session.call_tool(
            "add_memory",
            {
                "name": episode["name"],
                "episode_body": episode["body"],
                "group_id": GROUP_ID,
                "source": "text",
                "source_description": "QuickFurno reviewed canonical project memory",
                "reference_time": episode["reference_time"],
            },
        )
        text = result_text(result)
        if not text:
            raise RuntimeError(f"No response while seeding {episode['name']}")
        print(f"SEEDED: {episode['name']}")

    marker.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
    print("GRAPHITI_SEED=DONE")

def pretty_payload(text):
    try:
        return json.dumps(json.loads(text), indent=2, ensure_ascii=False)
    except Exception:
        return text


async def cmd_export(session):
    episodes = await session.call_tool(
        "get_episodes", {"group_ids": [GROUP_ID], "limit": 100}
    )
    timeline_text = pretty_payload(result_text(episodes))

    queries = [
        "QuickFurno current launch city Pune Mumbai scope",
        "QuickFurno AOS Core authority n8n business mutations",
        "QuickFurno Unified Project Brain Graphiti Graphify GitHub ChatGPT",
        "QuickFurno source baseline migrations runtime verification",
    ]
    fact_sections = []
    for query in queries:
        result = await session.call_tool(
            "search_memory_facts",
            {"query": query, "group_ids": [GROUP_ID], "max_facts": 25},
        )
        fact_sections.append((query, pretty_payload(result_text(result))))

    generated = datetime.now(timezone.utc).isoformat()
    timeline = [
        "# Graphiti Timeline Snapshot",
        "",
        f"Generated: {generated}",
        f"Group: `{GROUP_ID}`",
        "",
        "This is a machine-generated ChatGPT-readable export from the local Graphiti temporal-memory service.",
        "Canonical docs and independently verified live state remain higher authority.",
        "",
        "## Episodes",
        "",
        "```json",
        timeline_text,
        "```",
        "",
    ]
    (MEMORY_DIR / "GRAPHITI_TIMELINE.md").write_text("\n".join(timeline), encoding="utf-8")

    current = [
        "# Graphiti Current Facts Snapshot",
        "",
        f"Generated: {generated}",
        f"Group: `{GROUP_ID}`",
        "",
        "Search-derived temporal facts for ChatGPT retrieval. These are derived memory, not operational authority.",
        "",
    ]
    for query, payload in fact_sections:
        current.extend([
            f"## Query: {query}",
            "",
            "```json",
            payload,
            "```",
            "",
        ])
    (MEMORY_DIR / "GRAPHITI_CURRENT_FACTS.md").write_text(
        "\n".join(current), encoding="utf-8"
    )
    print("GRAPHITI_EXPORT=DONE")


async def cmd_validate(session):
    status = result_text(await session.call_tool("get_status", {}))
    if not status:
        raise RuntimeError("Graphiti get_status returned no content")

    checks = {
        "pune": "QuickFurno Pune only current launch city",
        "authority": "QuickFurno AOS advisory Core authority n8n",
        "brain": "QuickFurno Graphiti Graphify ChatGPT Project Brain",
    }
    for name, query in checks.items():
        result = await session.call_tool(
            "search_memory_facts",
            {"query": query, "group_ids": [GROUP_ID], "max_facts": 10},
        )
        text = result_text(result)
        if not text:
            raise RuntimeError(f"Graphiti validation query returned no content: {name}")
        print(f"GRAPHITI_QUERY_{name.upper()}=PASS")
    print("GRAPHITI_VALIDATE=PASS")

async def cmd_seed_tail(session):
    for index, episode in enumerate(SEED_EPISODES[-2:]):
        result = await session.call_tool(
            "add_memory",
            {
                "name": episode["name"],
                "episode_body": episode["body"],
                "group_id": GROUP_ID,
                "source": "text",
                "source_description": "QuickFurno reviewed canonical project memory",
                "reference_time": episode["reference_time"],
            },
        )
        if not result_text(result):
            raise RuntimeError(f"No response while seeding {episode['name']}")
        print(f"TAIL_QUEUED: {episode['name']}")
        if index == 0:
            await asyncio.sleep(20)
    print("GRAPHITI_TAIL_SEED=QUEUED")

async def cmd_reset(session):
    result = await session.call_tool("clear_graph", {"group_id": GROUP_ID})
    text = result_text(result)
    if not text:
        raise RuntimeError("Graphiti clear_graph returned no content")
    marker = ROOT / "infra" / "project-brain" / "runtime" / "seed-v1.done"
    if marker.exists():
        marker.unlink()
    print("GRAPHITI_RESET=DONE")


async def run(command):
    async def dispatch(session):
        if command == "tools":
            return await cmd_tools(session)
        if command == "status":
            return await cmd_status(session)
        if command == "seed":
            return await cmd_seed(session)
        if command == "export":
            return await cmd_export(session)
        if command == "validate":
            return await cmd_validate(session)
        if command == "reset":
            return await cmd_reset(session)
        if command == "seed-tail":
            return await cmd_seed_tail(session)
        raise ValueError(command)

    return await with_session(dispatch)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["tools", "status", "seed", "export", "validate", "reset", "seed-tail"])
    args = parser.parse_args()
    asyncio.run(run(args.command))


if __name__ == "__main__":
    main()
