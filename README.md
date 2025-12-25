# MCP Data Explorer

An interactive data exploration dashboard built as an MCP App using the [ext-apps SDK](https://github.com/modelcontextprotocol/ext-apps).

## Features

- **Dataset Browser** - Switch between sample datasets (movies, sales, weather)
- **Data Table** - Sortable, paginated data grid
- **Query Builder** - Dynamic filters based on column types
- **Charts** - Bar, line, pie, and doughnut charts with Chart.js
- **Export** - Download filtered data as CSV or JSON

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Host (localhost:8080)                                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  App iframe (localhost:3002)                      │  │
│  │  - Data table, filters, charts                    │  │
│  │  - Uses @modelcontextprotocol/ext-apps SDK        │  │
│  └───────────────────────────────────────────────────┘  │
│              ↕ postMessage (JSON-RPC)                   │
└─────────────────────────────────────────────────────────┘
                          ↕ HTTP API
┌─────────────────────────────────────────────────────────┐
│  MCP Server (localhost:3001)                            │
│  - Express server with tool endpoints                   │
│  - Loads JSON datasets from /data                       │
└─────────────────────────────────────────────────────────┘
```

## MCP Tools

| Tool | Description | Visibility |
|------|-------------|------------|
| `list-datasets` | Get available datasets | app |
| `get-schema` | Get dataset columns/types with stats | app |
| `query-data` | Query with filters, sort, pagination | app |
| `aggregate` | Group and aggregate data | app |
| `export-data` | Export as CSV or JSON | app |

All tools are marked with `visibility: ["app"]` per SEP-1865, meaning they're intended for the UI only and hidden from LLM tool lists.

## Sample Datasets

- **movies.json** - 100 top-rated movies with ratings, genres, directors
- **sales.json** - 30 e-commerce transactions with products, regions, revenue
- **weather.json** - 70 daily weather observations for major cities

## Running

```bash
# Install dependencies
npm install

# Start all services (3 terminals)
npm run dev:server  # MCP server on :3001
npm run dev:ui      # App UI on :3002
npm run dev:host    # Test host on :8080

# Open http://localhost:8080
```

## Project Structure

```
mcp-data-explorer/
├── data/
│   ├── movies.json
│   ├── sales.json
│   └── weather.json
├── src/
│   ├── server/
│   │   └── index.ts       # MCP server + HTTP API
│   └── ui/
│       ├── index.html     # Dashboard layout
│       ├── app.ts         # Main app logic
│       └── styles.css     # Dashboard styles
├── host/
│   ├── index.html         # Test host HTML
│   ├── host.ts            # PostMessage handler
│   └── vite.config.ts     # Host vite config
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## How It Works

1. **Host** loads the App in an iframe and handles `postMessage` communication
2. **App** uses `@modelcontextprotocol/ext-apps` SDK to call tools via JSON-RPC
3. **Host** receives tool calls and proxies them to the MCP Server via HTTP
4. **Server** processes requests and returns data

The App never communicates directly with the server - all tool calls go through the host, following the MCP Apps architecture.
