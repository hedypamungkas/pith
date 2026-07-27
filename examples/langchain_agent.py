"""
Sample external agent: a real LangChain agent completes a task using ONLY
tools exposed by the Pith MCP server (scrape, search, crawl, get_crawl_status,
extract) — no direct calls to the REST API.

Environment variables (all required unless noted):
    PITH_API_KEY         API key sent as the `x-api-key` header to the Pith
                         MCP server.
    EXTRACTION_BASE_URL  Base URL of the OpenAI-compatible chat endpoint the
                         agent reasons with.
    EXTRACTION_API_KEY   API key for that chat endpoint.
    EXTRACTION_MODEL     Model name to invoke at that endpoint.
    MCP_URL              (optional) URL of the Pith MCP endpoint. Defaults to
                         http://localhost:3000/mcp (the @pith/core/http route).

Setup:
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt

Run (with the Pith API server already running — see ../README.md):
    PITH_API_KEY=... EXTRACTION_BASE_URL=... EXTRACTION_API_KEY=... EXTRACTION_MODEL=... \
        python3 langchain_agent.py
"""

import asyncio
import os

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

MCP_URL = os.environ.get("MCP_URL", "http://localhost:3000/mcp")
PITH_API_KEY = os.environ["PITH_API_KEY"]
EXTRACTION_BASE_URL = os.environ["EXTRACTION_BASE_URL"]
EXTRACTION_API_KEY = os.environ["EXTRACTION_API_KEY"]
EXTRACTION_MODEL = os.environ["EXTRACTION_MODEL"]

# Chains three of the five MCP tools together — search, scrape, extract —
# so completing this task actually requires the agent to plan and sequence
# tool calls, not just make one.
TASK = (
    "Search the web for 'web scraping API for LLMs'. Pick the single most "
    "relevant result and scrape it. Then call the extract tool on that same "
    "URL with a JSON Schema requesting one field, 'summary' (a string). "
    "Tell me the resulting summary, and whether it came back flagged as "
    "low-confidence."
)


async def main() -> None:
    client = MultiServerMCPClient(
        {
            "pith": {
                "url": MCP_URL,
                "transport": "streamable_http",
                "headers": {"x-api-key": PITH_API_KEY},
            }
        }
    )
    tools = await client.get_tools()
    print(f"Loaded {len(tools)} MCP tools: {[t.name for t in tools]}")

    model = ChatOpenAI(
        base_url=EXTRACTION_BASE_URL,
        api_key=EXTRACTION_API_KEY,
        model=EXTRACTION_MODEL,
    )
    agent = create_react_agent(model, tools)

    result = await agent.ainvoke({"messages": [{"role": "user", "content": TASK}]})

    print("\n--- Tool calls made ---")
    for message in result["messages"]:
        tool_calls = getattr(message, "tool_calls", None)
        if tool_calls:
            for call in tool_calls:
                print(f"  {call['name']}({call['args']})")

    print("\n--- Agent's final answer ---")
    print(result["messages"][-1].content)


if __name__ == "__main__":
    asyncio.run(main())
