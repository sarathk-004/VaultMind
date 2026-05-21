# graphyne
https://graphyne-ai.vercel.app/

An AI-powered Notion workspace agent that uses MCP (Model Context Protocol) to fetch real data and visualize relationships between pages as a live knowledge graph.

Built with Next.js 14 App Router, shadcn/ui, and a custom SVG graph engine — no external graph libraries.

## What it does

Graphyne sits on top of your Notion workspace and gives you two things at once: a conversational AI that answers questions about your pages, and a live knowledge graph that maps how those pages connect.

* Ask anything about your workspace in natural language
* Get a written answer grounded in your actual Notion data — not the model's memory
* Watch a graph render in real time showing which pages relate, and how
* Click any citation chip in the chat to highlight the matching node in the graph, and vice versa

<img width="6048" height="5088" alt="Frame 172 (3)" src="https://github.com/user-attachments/assets/d270e788-4f60-4813-897c-b18ad1633843" />
<img width="6048" height="5088" alt="Frame 171 (4)" src="https://github.com/user-attachments/assets/41ebc8aa-bdd0-461f-b2b5-23d3af882aa7" />
<img width="6048" height="5088" alt="Frame 173 (3)" src="https://github.com/user-attachments/assets/1b008721-c6e0-4ae1-be3d-29c83cabcc93" />

## Features

* 4 intent modes — Search, Summarize, Connect, Brief — each changes how the AI approaches your query
* Live knowledge graph — SVG-rendered, interactive, built from scratch with no D3 or Cytoscape
* Bidirectional sync — chat citations and graph nodes stay in sync on every click
* MCP integration — reads live Notion data via Model Context Protocol on every request
* Dark theme — Obsidian/Linear-inspired UI, minimal and sharp
* Markdown support — AI responses render with full markdown formatting

## Tech stack

| Layer       | Technology                                            |
| ----------- | ----------------------------------------------------- |
| Framework   | Next.js 14 (App Router)                               |
| UI          | shadcn/ui + Tailwind CSS                              |
| Graph       | Custom SVG — force-like circular layout, curved paths |
| AI protocol | MCP (Model Context Protocol)                          |
| AI model    | GPT-4o                                                |
| State       | React useState                                        |

## Layout

```text
┌─────────────────────────────────────────────────────────┐
│  Sidebar          │  Chat panel         │  Graph        │
│                   │                     │               │
│  Graphyne         │  Messages           │  Knowledge    │
│  Workspace name   │  Citations          │  graph        │
│  Chat history     │  Input + intents    │  SVG nodes    │
│  Settings         │                     │  + edges      │
└─────────────────────────────────────────────────────────┘
```

## API contract

The UI expects a backend at `POST /api/graphyne`.

### Request

```json
{
  "message": "What's connected to our Q3 roadmap?",
  "intent": "search"
}
```

`intent` is one of `"search"`, `"summarize"`, `"connect"`, or `"brief"`.

### Response

```json
{
  "answer": "The Q3 roadmap connects to Sprint 14, Team OKRs, and the Product Brief...",
  "graph": {
    "nodes": [
      { "id": "1", "label": "Q3 Roadmap", "type": "page" },
      { "id": "2", "label": "Sprint 14", "type": "task" },
      { "id": "3", "label": "Team OKRs", "type": "database" }
    ],
    "edges": [
      { "from": "1", "to": "2", "relation": "contains" },
      { "from": "1", "to": "3", "relation": "references" }
    ]
  }
}
```

## Node types and graph colors

| Type     | Color  |
| -------- | ------ |
| page     | Blue   |
| database | Purple |
| task     | Green  |
| note     | Amber  |

## Getting started

### Prerequisites

* Node.js 18+
* A Notion workspace
* An MCP-compatible backend (or your own `/api/graphyne` implementation)

### Installation

```bash
git clone https://github.com/your-username/graphyne.git
cd graphyne
npm install
```

## Environment variables

Create a `.env.local` file in the root:

```env
OPENAI_API_KEY=your_openai_api_key
NEXT_PUBLIC_APP_URL=https://graphyne-ai.vercel.app
NOTION_OAUTH_CLIENT_ID=your_notion_oauth_client_id
NOTION_OAUTH_CLIENT_SECRET=your_notion_oauth_client_secret
NOTION_OAUTH_REDIRECT_URI=https://graphyne-ai.vercel.app/api/vaultmind/connect/callback
```

For local development, add `http://localhost:3000/api/vaultmind/connect/callback` to the
same Notion public connection and use that as `NOTION_OAUTH_REDIRECT_URI`.

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Graph engine

The knowledge graph is built entirely in React + SVG — no external libraries.

* Nodes are placed in a circular layout with a slight random offset on first render
* Edges are drawn as curved SVG `<path>` elements connecting node centers
* Hovering a node highlights its connected edges and neighbour nodes
* Clicking a node scrolls the chat panel to the matching citation chip
* The graph re-renders dynamically on every API response — nothing is hardcoded

## Project structure

```text
graphyne/
├── app/
│   ├── page.tsx              # Main layout (sidebar + chat + graph)
│   └── api/
│       └── graphyne/
│           └── route.ts      # API route — MCP + AI logic lives here
├── components/
│   ├── Sidebar.tsx
│   ├── ChatPanel.tsx
│   ├── GraphCanvas.tsx       # SVG graph engine
│   ├── MessageBubble.tsx
│   ├── CitationChip.tsx
│   └── IntentSelector.tsx
├── lib/
│   ├── mcp.ts                # MCP client
│   └── types.ts              # Shared types (Message, Graph, Node, Edge)
└── public/
```

## License

MIT
