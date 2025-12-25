import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');

interface Dataset {
  name: string;
  description: string;
  schema: Record<string, string>;
  data: Record<string, unknown>[];
}

interface Filter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
  value: unknown;
}

interface QueryParams {
  dataset: string;
  filters?: Filter[];
  sort?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

interface AggregateParams {
  dataset: string;
  groupBy: string;
  metric: string;
  operation: 'sum' | 'avg' | 'count' | 'min' | 'max';
}

// Load all datasets
const datasets: Map<string, Dataset> = new Map();

function loadDatasets(): void {
  const datasetFiles = ['movies.json', 'sales.json', 'weather.json'];
  for (const file of datasetFiles) {
    try {
      const content = readFileSync(join(DATA_DIR, file), 'utf-8');
      const dataset = JSON.parse(content) as Dataset;
      datasets.set(dataset.name, dataset);
      console.log(`Loaded dataset: ${dataset.name} (${dataset.data.length} records)`);
    } catch (error) {
      console.error(`Failed to load ${file}:`, error);
    }
  }
}

// Apply filters to data
function applyFilters(data: Record<string, unknown>[], filters: Filter[]): Record<string, unknown>[] {
  return data.filter(row => {
    return filters.every(filter => {
      const value = row[filter.field];
      switch (filter.operator) {
        case 'eq': return value === filter.value;
        case 'ne': return value !== filter.value;
        case 'gt': return (value as number) > (filter.value as number);
        case 'gte': return (value as number) >= (filter.value as number);
        case 'lt': return (value as number) < (filter.value as number);
        case 'lte': return (value as number) <= (filter.value as number);
        case 'contains':
          return String(value).toLowerCase().includes(String(filter.value).toLowerCase());
        case 'in':
          return (filter.value as unknown[]).includes(value);
        default: return true;
      }
    });
  });
}

// Sort data
function sortData(
  data: Record<string, unknown>[],
  sort: { field: string; direction: 'asc' | 'desc' }
): Record<string, unknown>[] {
  return [...data].sort((a, b) => {
    const aVal = a[sort.field];
    const bVal = b[sort.field];

    if (aVal === bVal) return 0;

    let comparison: number;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      comparison = aVal.localeCompare(bVal);
    } else {
      comparison = (aVal as number) < (bVal as number) ? -1 : 1;
    }

    return sort.direction === 'asc' ? comparison : -comparison;
  });
}

// Aggregate data
function aggregateData(
  data: Record<string, unknown>[],
  groupBy: string,
  metric: string,
  operation: string
): Array<{ group: string; value: number }> {
  const groups = new Map<string, number[]>();

  for (const row of data) {
    const groupKey = String(row[groupBy]);
    const metricValue = Number(row[metric]) || 0;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(metricValue);
  }

  const results: Array<{ group: string; value: number }> = [];

  for (const [group, values] of groups) {
    let value: number;
    switch (operation) {
      case 'sum': value = values.reduce((a, b) => a + b, 0); break;
      case 'avg': value = values.reduce((a, b) => a + b, 0) / values.length; break;
      case 'count': value = values.length; break;
      case 'min': value = Math.min(...values); break;
      case 'max': value = Math.max(...values); break;
      default: value = 0;
    }
    results.push({ group, value: Math.round(value * 100) / 100 });
  }

  return results.sort((a, b) => b.value - a.value);
}

// Get unique values for a field
function getUniqueValues(data: Record<string, unknown>[], field: string): unknown[] {
  const unique = new Set<unknown>();
  for (const row of data) {
    unique.add(row[field]);
  }
  return Array.from(unique).sort();
}

// Get field statistics
function getFieldStats(data: Record<string, unknown>[], field: string, type: string): Record<string, unknown> {
  if (type === 'number') {
    const values = data.map(row => Number(row[field])).filter(v => !isNaN(v));
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
    };
  } else if (type === 'string') {
    const unique = getUniqueValues(data, field);
    return {
      uniqueCount: unique.length,
      values: unique.slice(0, 50) // Limit to 50 unique values
    };
  }
  return {};
}

// Express server
const app = express();
app.use(express.json());

// CORS
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Tool definitions with visibility metadata per SEP-1865
const toolDefinitions = [
  {
    name: 'list-datasets',
    description: 'Get available datasets',
    inputSchema: { type: 'object', properties: {} },
    _meta: { ui: { visibility: ['app'] } }
  },
  {
    name: 'get-schema',
    description: 'Get dataset columns and types with statistics',
    inputSchema: {
      type: 'object',
      properties: { dataset: { type: 'string', description: 'Dataset name' } },
      required: ['dataset']
    },
    _meta: { ui: { visibility: ['app'] } }
  },
  {
    name: 'query-data',
    description: 'Query data with filters, sorting, and pagination',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: { type: 'string' },
        filters: { type: 'array' },
        sort: { type: 'object' },
        limit: { type: 'number' },
        offset: { type: 'number' }
      },
      required: ['dataset']
    },
    _meta: { ui: { visibility: ['app'] } }
  },
  {
    name: 'aggregate',
    description: 'Group and aggregate data',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: { type: 'string' },
        groupBy: { type: 'string' },
        metric: { type: 'string' },
        operation: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max'] }
      },
      required: ['dataset', 'groupBy', 'metric', 'operation']
    },
    _meta: { ui: { visibility: ['app'] } }
  },
  {
    name: 'export-data',
    description: 'Export filtered data as CSV or JSON',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: { type: 'string' },
        filters: { type: 'array' },
        format: { type: 'string', enum: ['csv', 'json'] }
      },
      required: ['dataset']
    },
    _meta: { ui: { visibility: ['app'] } }
  }
];

// Endpoint to list available tools with metadata
app.get('/api/tools', (_req, res) => {
  res.json({ tools: toolDefinitions });
});

// Tool: list-datasets
app.post('/api/tools/list-datasets', (_req, res) => {
  const result = Array.from(datasets.values()).map(ds => ({
    name: ds.name,
    description: ds.description,
    recordCount: ds.data.length,
    columns: Object.keys(ds.schema)
  }));
  res.json({ content: [{ type: 'text', text: JSON.stringify(result) }] });
});

// Tool: get-schema
app.post('/api/tools/get-schema', (req, res) => {
  const { dataset: datasetName } = req.body;
  const dataset = datasets.get(datasetName);

  if (!dataset) {
    res.json({ content: [{ type: 'text', text: JSON.stringify({ error: 'Dataset not found' }) }], isError: true });
    return;
  }

  // Get field stats for each column
  const schemaWithStats: Record<string, unknown> = {};
  for (const [field, type] of Object.entries(dataset.schema)) {
    schemaWithStats[field] = {
      type,
      stats: getFieldStats(dataset.data, field, type)
    };
  }

  res.json({
    content: [{
      type: 'text',
      text: JSON.stringify({
        name: dataset.name,
        description: dataset.description,
        recordCount: dataset.data.length,
        schema: schemaWithStats
      })
    }]
  });
});

// Tool: query-data
app.post('/api/tools/query-data', (req, res) => {
  const { dataset: datasetName, filters = [], sort, limit = 100, offset = 0 } = req.body as QueryParams;
  const dataset = datasets.get(datasetName);

  if (!dataset) {
    res.json({ content: [{ type: 'text', text: JSON.stringify({ error: 'Dataset not found' }) }], isError: true });
    return;
  }

  let data = [...dataset.data];

  // Apply filters
  if (filters.length > 0) {
    data = applyFilters(data, filters);
  }

  const totalCount = data.length;

  // Apply sort
  if (sort) {
    data = sortData(data, sort);
  }

  // Apply pagination
  data = data.slice(offset, offset + limit);

  res.json({
    content: [{
      type: 'text',
      text: JSON.stringify({
        data,
        totalCount,
        offset,
        limit,
        hasMore: offset + limit < totalCount
      })
    }]
  });
});

// Tool: aggregate
app.post('/api/tools/aggregate', (req, res) => {
  const { dataset: datasetName, groupBy, metric, operation } = req.body as AggregateParams;
  const dataset = datasets.get(datasetName);

  if (!dataset) {
    res.json({ content: [{ type: 'text', text: JSON.stringify({ error: 'Dataset not found' }) }], isError: true });
    return;
  }

  const results = aggregateData(dataset.data, groupBy, metric, operation);

  res.json({
    content: [{
      type: 'text',
      text: JSON.stringify({
        groupBy,
        metric,
        operation,
        results
      })
    }]
  });
});

// Tool: export-data
app.post('/api/tools/export-data', (req, res) => {
  const { dataset: datasetName, filters = [], format = 'json' } = req.body;
  const dataset = datasets.get(datasetName);

  if (!dataset) {
    res.json({ content: [{ type: 'text', text: JSON.stringify({ error: 'Dataset not found' }) }], isError: true });
    return;
  }

  let data = [...dataset.data];

  if (filters.length > 0) {
    data = applyFilters(data, filters);
  }

  let exportContent: string;
  if (format === 'csv') {
    const headers = Object.keys(dataset.schema);
    const rows = data.map(row =>
      headers.map(h => {
        const val = row[h];
        if (typeof val === 'string' && val.includes(',')) {
          return `"${val}"`;
        }
        return String(val);
      }).join(',')
    );
    exportContent = [headers.join(','), ...rows].join('\n');
  } else {
    exportContent = JSON.stringify(data, null, 2);
  }

  res.json({
    content: [{
      type: 'text',
      text: JSON.stringify({
        format,
        recordCount: data.length,
        content: exportContent
      })
    }]
  });
});

// Load datasets and start server
loadDatasets();

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Data Explorer MCP Server running at http://localhost:${PORT}`);
  console.log('Available tools: list-datasets, get-schema, query-data, aggregate, export-data');
});
