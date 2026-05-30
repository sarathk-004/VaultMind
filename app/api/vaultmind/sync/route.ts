import { NextResponse } from "next/server"
import { providerOptionsFromSettings } from "@/lib/llm-client"
import { getRequestLlmSettings, hasAvailableLlmProvider } from "@/lib/llm-settings"
import { getWorkspaceSnapshot } from "@/lib/notion-retriever"
import { getRequestNotionToken } from "@/lib/notion-token"
import { getStackerConfig } from "@/lib/stacker/config"
import { isStackerEnabled, syncStackerWorkspace } from "@/lib/stacker/service"

export async function POST() {
  const config = getStackerConfig()
  if (!isStackerEnabled(config)) {
    return NextResponse.json({
      ok: false,
      reason: "Stacker is disabled. Set VAULTMIND_STACKER_ENABLED=true to run the sync worker.",
    }, { status: 409 })
  }

  try {
    const token = await getRequestNotionToken()
    const llmSettings = await getRequestLlmSettings()
    const snapshot = await getWorkspaceSnapshot(token, {
      ...providerOptionsFromSettings(llmSettings),
      budgetMs: hasAvailableLlmProvider(llmSettings) ? 12_000 : 2_500,
    })
    const result = await syncStackerWorkspace({ snapshot, token, config })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[stacker] Sync worker failed:", error)
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 })
  }
}
