/**
 * search-health: is fathym.com healthy for search engines and AI crawlers, and what should we write next?
 *
 * `fai run search-health.ts --mode MCP` serves the tools to an AI (the repo's .mcp.json registers it with
 * Claude Code); `--mode API` serves them as REST on 4968; `--mode Web` serves the page on 4969. Everything it
 * keeps is in the vault at SEARCH_HEALTH_DATA (default ~/.search-health).
 */
import { APIMode, MCPMode, WebMode, Workbench } from "@fathym/fai/workbenches";
import { tools } from "./src/tools.ts";
import { prompts } from "./src/prompts.ts";
import { handler } from "./src/web.ts";

export default Workbench("search-health", "Is fathym.com healthy for search engines and AI crawlers, and what should we write next?")
  .Tools(tools())
  .Prompts(prompts)
  .Modes({
    MCP: MCPMode(),
    API: APIMode().Ports(4968),
    Web: WebMode({ handler }).Ports(4969),
  });
