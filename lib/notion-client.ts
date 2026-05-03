import { Client } from "@notionhq/client"

let _client: Client | null = null

/**
 * Returns the shared Notion API client. Returns null when NOTION_API_KEY
 * is not set, so callers can gracefully fall back.
 *
 * The Notion SDK is the official way to talk to Notion's MCP-equivalent
 * data plane (search, blocks, databases). The same primitives an MCP server
 * would expose are wrapped here for our retriever.
 */
export function getNotionClient(): Client | null {
  const apiKey = process.env.NOTION_API_KEY
  if (!apiKey) return null
  if (!_client) {
    _client = new Client({ auth: apiKey })
  }
  return _client
}

export function isNotionConnected(): boolean {
  return Boolean(process.env.NOTION_API_KEY)
}
