import { NextResponse } from "next/server"
import { isNotionConnected, notionFetch } from "@/lib/notion-client"
import type { NotionSearchResponse } from "@/lib/notion-client"

export async function GET() {
  const hasKey = isNotionConnected()
  const keyPreview = process.env.NOTION_API_KEY
    ? `${process.env.NOTION_API_KEY.slice(0, 10)}...${process.env.NOTION_API_KEY.slice(-4)}`
    : "NOT SET"

  if (!hasKey) {
    return NextResponse.json(
      {
        error: "NOTION_API_KEY is not set",
        hasKey: false,
        keyPreview: "NOT SET",
        help: "Set NOTION_API_KEY in Settings → Vars with your Internal Integration secret (starts with 'secret_')",
      },
      { status: 400 },
    )
  }

  try {
    // Test the connection by running a search
    const res = await notionFetch<NotionSearchResponse>("/search", {
      method: "POST",
      body: { page_size: 1 },
    })

    const pageCount = res.results.length
    if (pageCount === 0) {
      return NextResponse.json(
        {
          error: "Connected to Notion, but no pages found",
          hasKey: true,
          keyPreview,
          help: "Make sure your pages are shared with the integration in Notion.",
          details: "The API returned 0 pages. Go to your Notion workspace, find pages you want to query, and click 'Share' → find your integration name and grant access.",
        },
        { status: 200 },
      )
    }

    return NextResponse.json(
      {
        ok: true,
        hasKey: true,
        keyPreview,
        pagesFound: pageCount,
        message: `Successfully connected! Found ${pageCount} accessible page(s).`,
      },
      { status: 200 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to connect to Notion",
        hasKey: true,
        keyPreview,
        details: error instanceof Error ? error.message : String(error),
        help: `
1. Verify your token is a **Internal Integration secret** (starts with 'secret_' or 'ntn_'), not an OAuth token.
2. In Notion, go to Integrations → select your integration → Secrets tab and copy the **Internal Integration Secret**.
3. Set NOTION_API_KEY with that secret.
4. Share your workspace pages with the integration.
        `.trim(),
      },
      { status: 500 },
    )
  }
}
