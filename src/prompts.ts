/** The workbench's MCP prompts: how any AI reads its answers the same way. */
import type { WorkbenchPrompt } from "@fathym/fai/workbenches";

export const prompts: Record<string, WorkbenchPrompt> = {
  "weekly-site-review": {
    Title: "Weekly site review",
    Description: "Is fathym.com healthy, and what should we write next?",
    Get: () =>
      [
        "Answer: is fathym.com healthy for search engines and AI crawlers, and what should we write next?",
        "1. Call report-current. If the site check is older than the last site batch, or missing, call site-check first.",
        "2. Health: list new issues first, then fixed ones, then what is unchanged. Quote each URL and the HTTP status and time it was fetched. Do not estimate or round figures.",
        "3. Write next: from the keyword pull, name the candidates we do not rank for, with their volume and its source. For each, say its search intent (the pull's Intent field) and whether the people searching it are the ones we want; say plainly when intent is unknown. Do not add volumes of overlapping keywords together. Say when the pull ran, its limits (Settings) and what it cost: 'not ranked' means not among the RankedLimit keywords pulled, not 'no ranking'. Only call keywords-pull (paid) if asked.",
        "4. If Search Console has run, say what changed in clicks and impressions, with the date ranges, and which inspected URLs Google did not index.",
        "5. End with what you could not answer from the workbench, so a person can finish it.",
      ].join("\n"),
  },
  "opportunity-review": {
    Title: "Opportunity review",
    Description: "What in our own recent work should change what we watch?",
    Get: () =>
      [
        "Call opportunities-scan, then read the issues it returns against the watch list beside them.",
        "Propose changes to watchlist.json for a person to make: a term or seed to add, one to drop, or a page that now targets a different search.",
        "For each proposal give the issue it came from (repo#number and its URL) and one line of why. Quote the issue; do not infer what it does not say.",
        "For a term you propose to add, judge its search intent: what someone typing it into Google wants, and whether that is us. A generic word that is also our product name (e.g. 'Workshops') usually has the wrong intent; prefer the branded form ('Fathym Workshops'). Say when you could not check intent with data.",
        "Do not edit watchlist.json. Say plainly when nothing in the scan should change the watch list.",
      ].join("\n"),
  },
};
