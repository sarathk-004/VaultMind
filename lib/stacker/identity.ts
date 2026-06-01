import { tokenKey } from "@/lib/notion-client"
import type { CachedSnapshot } from "@/lib/notion-retriever"

export function resolveWorkspaceId(workspaceId?: string | null): string {
  const value = (workspaceId ?? "").trim()
  return value ? value : "unknown"
}

export function resolveWorkspaceIdentity(options: {
  workspaceId?: string | null
  token?: string | null
  source?: CachedSnapshot["source"]
}): { workspaceId: string; userKey: string } {
  const workspaceIdValue = resolveWorkspaceId(options.workspaceId)
  if (workspaceIdValue !== "unknown") {
    return {
      workspaceId: workspaceIdValue,
      userKey: `ws_${workspaceIdValue}`,
    }
  }
  const source = options.source ?? "notion"
  return {
    workspaceId: workspaceIdValue,
    userKey: `${source}:${tokenKey(options.token)}`,
  }
}
