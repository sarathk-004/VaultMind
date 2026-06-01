import { existsSync, readFileSync } from "node:fs"

const checks = [
  {
    name: "canonical graph schema doc",
    pass: () => fileIncludes("docs/graph-schema.md", ["Canonical Node Types", "Entity Resolution Policy"]),
  },
  {
    name: "planner and fusion orchestration",
    pass: () =>
      fileIncludes("lib/orchestration/planner.ts", ["planQuery"]) &&
      fileIncludes("lib/orchestration/fusion.ts", ["mergeDocuments", "selectGraph"]) &&
      fileIncludes("app/api/vaultmind/route.ts", ["orchestrateQuery"]),
  },
  {
    name: "multi-provider LLM fallback",
    pass: () => fileIncludes("lib/llm-client.ts", ["resolveProviderCandidates", "All LLM providers failed"]),
  },
  {
    name: "tenant isolation guard",
    pass: () =>
      fileIncludes("lib/api-security.ts", ["requireWorkspaceId"]) &&
      fileIncludes("app/api/vaultmind/route.ts", ["requireWorkspaceId"]),
  },
  {
    name: "audit log viewer endpoint",
    pass: () =>
      existsSync("app/api/vaultmind/audit/route.ts") &&
      fileIncludes("lib/stacker/audit.ts", ["listAuditEvents"]),
  },
  {
    name: "Postgres graph schema",
    pass: () =>
      fileIncludes("lib/stacker/postgres.ts", ["stacker_graph_nodes", "stacker_graph_edges", "postgresGraphAdapter"]),
  },
]

const results = checks.map(check => ({ name: check.name, ok: check.pass() }))
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`)
}

const failed = results.filter(result => !result.ok)
if (failed.length > 0) {
  console.error(`\n${failed.length} evaluation check(s) failed.`)
  process.exit(1)
}

function fileIncludes(path, needles) {
  if (!existsSync(path)) return false
  const text = readFileSync(path, "utf8")
  return needles.every(needle => text.includes(needle))
}
