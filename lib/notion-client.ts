const NOTION_BASE = "https://api.notion.com/v1"
const NOTION_VERSION = "2022-06-28"

export function isNotionConnected(): boolean {
  return Boolean(process.env.NOTION_API_KEY)
}

interface NotionRequestInit {
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  body?: unknown
}

/**
 * Tiny, dependency-free wrapper around the Notion REST API.
 * Uses fetch + the official `Notion-Version` header so we don't need
 * the @notionhq/client SDK at runtime.
 */
export async function notionFetch<T>(
  path: string,
  init: NotionRequestInit = {},
): Promise<T> {
  const key = process.env.NOTION_API_KEY
  if (!key) {
    throw new Error("NOTION_API_KEY is not set")
  }

  const res = await fetch(`${NOTION_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Notion ${res.status} ${path}: ${text.slice(0, 240)}`)
  }
  return (await res.json()) as T
}

// ── Typed shapes for the small surface we use ─────────────────────────────

export interface NotionRichText {
  plain_text?: string
  href?: string | null
  type?: string
  mention?: {
    type?: string
    page?: { id: string }
    database?: { id: string }
  }
}

export interface NotionPage {
  id: string
  object: "page"
  archived?: boolean
  in_trash?: boolean
  url?: string
  parent?: {
    type: string
    page_id?: string
    database_id?: string
    workspace?: boolean
  }
  properties?: Record<
    string,
    {
      type: string
      title?: NotionRichText[]
      rich_text?: NotionRichText[]
      select?: { name: string } | null
      status?: { name: string } | null
      multi_select?: Array<{ name: string }>
    }
  >
  last_edited_time?: string
}

export interface NotionDatabase {
  id: string
  object: "database"
  archived?: boolean
  in_trash?: boolean
  url?: string
  title?: NotionRichText[]
  parent?: {
    type: string
    page_id?: string
    workspace?: boolean
  }
  last_edited_time?: string
}

export type NotionSearchResult = NotionPage | NotionDatabase

export interface NotionSearchResponse {
  results: NotionSearchResult[]
  next_cursor: string | null
  has_more: boolean
}

export interface NotionBlock {
  id: string
  type: string
  has_children?: boolean
  [key: string]: unknown
}

export interface NotionBlockChildrenResponse {
  results: NotionBlock[]
  next_cursor: string | null
  has_more: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function richTextToPlain(rt: NotionRichText[] | undefined): string {
  if (!rt || rt.length === 0) return ""
  return rt.map(t => t.plain_text ?? "").join("")
}

export function getPageTitle(page: NotionPage): string {
  const props = page.properties ?? {}
  for (const value of Object.values(props)) {
    if (value.type === "title" && value.title) {
      const t = richTextToPlain(value.title).trim()
      if (t) return t
    }
  }
  return "Untitled"
}

export function getDatabaseTitle(db: NotionDatabase): string {
  return richTextToPlain(db.title).trim() || "Untitled database"
}
