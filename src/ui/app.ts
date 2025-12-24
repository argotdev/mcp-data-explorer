import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import type { Chart as ChartType, ChartConfiguration } from 'chart.js';

declare const Chart: typeof import('chart.js').Chart;

interface DatasetInfo {
  name: string;
  description: string;
  recordCount: number;
  columns: string[];
}

interface SchemaField {
  type: string;
  stats: {
    min?: number;
    max?: number;
    avg?: number;
    uniqueCount?: number;
    values?: string[];
  };
}

interface Schema {
  name: string;
  description: string;
  recordCount: number;
  schema: Record<string, SchemaField>;
}

interface Filter {
  field: string;
  operator: string;
  value: unknown;
}

interface QueryResult {
  data: Record<string, unknown>[];
  totalCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

interface AggregateResult {
  groupBy: string;
  metric: string;
  operation: string;
  results: Array<{ group: string; value: number }>;
}

// Initialize MCP App
const app = new App(
  { name: 'DataExplorer', version: '1.0.0' },
  {}
);

// State
let datasets: DatasetInfo[] = [];
let currentDataset: string = '';
let currentSchema: Schema | null = null;
let currentData: Record<string, unknown>[] = [];
let currentFilters: Filter[] = [];
let currentSort: { field: string; direction: 'asc' | 'desc' } | null = null;
let currentPage = 0;
const pageSize = 50;
let totalCount = 0;
let chart: ChartType | null = null;

// DOM Elements
const datasetSelect = document.getElementById('datasetSelect') as HTMLSelectElement;
const recordCount = document.getElementById('recordCount') as HTMLSpanElement;
const filterContainer = document.getElementById('filterContainer') as HTMLDivElement;
const applyFiltersBtn = document.getElementById('applyFilters') as HTMLButtonElement;
const clearFiltersBtn = document.getElementById('clearFilters') as HTMLButtonElement;
const tableContainer = document.getElementById('tableContainer') as HTMLDivElement;
const tableInfo = document.getElementById('tableInfo') as HTMLSpanElement;
const pagination = document.getElementById('pagination') as HTMLDivElement;
const chartTypeSelect = document.getElementById('chartType') as HTMLSelectElement;
const chartGroupBySelect = document.getElementById('chartGroupBy') as HTMLSelectElement;
const chartMetricSelect = document.getElementById('chartMetric') as HTMLSelectElement;
const chartOperationSelect = document.getElementById('chartOperation') as HTMLSelectElement;
const exportFormatSelect = document.getElementById('exportFormat') as HTMLSelectElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const chartCanvas = document.getElementById('chart') as HTMLCanvasElement;

// API call helper
async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  try {
    const result = await app.callServerTool({ name, arguments: args });
    const content = result.content[0];
    if (content.type === 'text') {
      return JSON.parse(content.text);
    }
    return null;
  } catch (error) {
    console.error(`Tool call failed: ${name}`, error);
    throw error;
  }
}

// Load available datasets
async function loadDatasets(): Promise<void> {
  datasets = await callTool('list-datasets') as DatasetInfo[];

  datasetSelect.innerHTML = '<option value="">Select a dataset...</option>' +
    datasets.map(ds => `<option value="${ds.name}">${ds.name} (${ds.recordCount} records)</option>`).join('');
}

// Load dataset schema
async function loadSchema(datasetName: string): Promise<void> {
  currentSchema = await callTool('get-schema', { dataset: datasetName }) as Schema;

  recordCount.textContent = `${currentSchema.recordCount.toLocaleString()} records`;

  renderFilters();
  updateChartSelectors();
}

// Render filter UI
function renderFilters(): void {
  if (!currentSchema) {
    filterContainer.innerHTML = '<p class="empty-state">Select a dataset</p>';
    return;
  }

  const filterHtml = Object.entries(currentSchema.schema).map(([field, info]) => {
    const { type, stats } = info;

    if (type === 'number') {
      return `
        <div class="filter-group">
          <label>${field}</label>
          <div class="filter-range">
            <input type="number" id="filter-${field}-min" placeholder="Min" step="any" data-field="${field}" data-type="min">
            <span>to</span>
            <input type="number" id="filter-${field}-max" placeholder="Max" step="any" data-field="${field}" data-type="max">
          </div>
        </div>
      `;
    } else if (type === 'string' && stats.values && stats.values.length <= 20) {
      return `
        <div class="filter-group">
          <label>${field}</label>
          <select id="filter-${field}" data-field="${field}" data-type="select">
            <option value="">All</option>
            ${stats.values.map(v => `<option value="${v}">${v}</option>`).join('')}
          </select>
        </div>
      `;
    } else {
      return `
        <div class="filter-group">
          <label>${field}</label>
          <input type="text" id="filter-${field}" placeholder="Search..." data-field="${field}" data-type="search">
        </div>
      `;
    }
  }).join('');

  filterContainer.innerHTML = filterHtml;
}

// Collect filters from UI
function collectFilters(): Filter[] {
  const filters: Filter[] = [];

  filterContainer.querySelectorAll('input, select').forEach((el) => {
    const input = el as HTMLInputElement | HTMLSelectElement;
    const field = input.dataset.field!;
    const type = input.dataset.type!;
    const value = input.value.trim();

    if (!value) return;

    if (type === 'min') {
      filters.push({ field, operator: 'gte', value: parseFloat(value) });
    } else if (type === 'max') {
      filters.push({ field, operator: 'lte', value: parseFloat(value) });
    } else if (type === 'select') {
      filters.push({ field, operator: 'eq', value });
    } else if (type === 'search') {
      filters.push({ field, operator: 'contains', value });
    }
  });

  return filters;
}

// Query data
async function queryData(): Promise<void> {
  if (!currentDataset) return;

  tableContainer.innerHTML = '<div class="loading">Loading...</div>';

  const result = await callTool('query-data', {
    dataset: currentDataset,
    filters: currentFilters,
    sort: currentSort,
    limit: pageSize,
    offset: currentPage * pageSize
  }) as QueryResult;

  currentData = result.data;
  totalCount = result.totalCount;

  renderTable();
  renderPagination();
  updateChart();
}

// Render data table
function renderTable(): void {
  if (!currentSchema || currentData.length === 0) {
    tableContainer.innerHTML = '<p class="empty-state">No data to display</p>';
    tableInfo.textContent = '';
    return;
  }

  const columns = Object.keys(currentSchema.schema);
  const numericCols = new Set(
    Object.entries(currentSchema.schema)
      .filter(([_, info]) => info.type === 'number')
      .map(([field]) => field)
  );

  const start = currentPage * pageSize + 1;
  const end = Math.min(start + currentData.length - 1, totalCount);
  tableInfo.textContent = `Showing ${start}-${end} of ${totalCount.toLocaleString()}`;

  const getSortIcon = (col: string) => {
    if (!currentSort || currentSort.field !== col) return '<span class="sort-icon">↕</span>';
    return `<span class="sort-icon">${currentSort.direction === 'asc' ? '↑' : '↓'}</span>`;
  };

  const tableHtml = `
    <table class="data-table">
      <thead>
        <tr>
          ${columns.map(col => `
            <th class="${currentSort?.field === col ? 'sorted' : ''}" data-column="${col}">
              ${col}${getSortIcon(col)}
            </th>
          `).join('')}
        </tr>
      </thead>
      <tbody>
        ${currentData.map(row => `
          <tr>
            ${columns.map(col => `
              <td class="${numericCols.has(col) ? 'num' : ''}" title="${String(row[col])}">
                ${formatValue(row[col], numericCols.has(col))}
              </td>
            `).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  tableContainer.innerHTML = tableHtml;

  // Add sort handlers
  tableContainer.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      const col = (th as HTMLElement).dataset.column!;
      if (currentSort?.field === col) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort = { field: col, direction: 'asc' };
      }
      currentPage = 0;
      queryData();
    });
  });
}

// Format value for display
function formatValue(value: unknown, isNumeric: boolean): string {
  if (value === null || value === undefined) return '-';
  if (isNumeric && typeof value === 'number') {
    return value.toLocaleString();
  }
  return String(value);
}

// Render pagination
function renderPagination(): void {
  const totalPages = Math.ceil(totalCount / pageSize);

  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }

  pagination.innerHTML = `
    <button id="prevPage" ${currentPage === 0 ? 'disabled' : ''}>Previous</button>
    <span class="page-info">Page ${currentPage + 1} of ${totalPages}</span>
    <button id="nextPage" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
  `;

  document.getElementById('prevPage')?.addEventListener('click', () => {
    if (currentPage > 0) {
      currentPage--;
      queryData();
    }
  });

  document.getElementById('nextPage')?.addEventListener('click', () => {
    if (currentPage < totalPages - 1) {
      currentPage++;
      queryData();
    }
  });
}

// Update chart selectors
function updateChartSelectors(): void {
  if (!currentSchema) return;

  const stringFields = Object.entries(currentSchema.schema)
    .filter(([_, info]) => info.type === 'string')
    .map(([field]) => field);

  const numericFields = Object.entries(currentSchema.schema)
    .filter(([_, info]) => info.type === 'number')
    .map(([field]) => field);

  chartGroupBySelect.innerHTML = '<option value="">Group by...</option>' +
    stringFields.map(f => `<option value="${f}">${f}</option>`).join('');

  chartMetricSelect.innerHTML = '<option value="">Metric...</option>' +
    numericFields.map(f => `<option value="${f}">${f}</option>`).join('');

  // Set defaults
  if (stringFields.length > 0) chartGroupBySelect.value = stringFields[0];
  if (numericFields.length > 0) chartMetricSelect.value = numericFields[0];
}

// Update chart
async function updateChart(): Promise<void> {
  const groupBy = chartGroupBySelect.value;
  const metric = chartMetricSelect.value;
  const operation = chartOperationSelect.value;
  const chartType = chartTypeSelect.value as 'bar' | 'line' | 'pie' | 'doughnut';

  if (!currentDataset || !groupBy || !metric) {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    return;
  }

  const result = await callTool('aggregate', {
    dataset: currentDataset,
    groupBy,
    metric,
    operation
  }) as AggregateResult;

  const data = result.results.slice(0, 15); // Limit to top 15

  const colors = [
    '#667eea', '#764ba2', '#f093fb', '#f5576c', '#4facfe',
    '#00f2fe', '#43e97b', '#38f9d7', '#fa709a', '#fee140',
    '#30cfd0', '#c471ed', '#f64f59', '#12c2e9', '#c471ed'
  ];

  if (chart) {
    chart.destroy();
  }

  const config: ChartConfiguration = {
    type: chartType,
    data: {
      labels: data.map(d => d.group),
      datasets: [{
        label: `${operation} of ${metric}`,
        data: data.map(d => d.value),
        backgroundColor: chartType === 'line' ? colors[0] : colors,
        borderColor: chartType === 'line' ? colors[0] : colors,
        borderWidth: chartType === 'line' ? 2 : 1,
        fill: chartType === 'line' ? false : undefined
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: chartType === 'pie' || chartType === 'doughnut',
          position: 'right'
        }
      },
      scales: chartType === 'pie' || chartType === 'doughnut' ? {} : {
        y: {
          beginAtZero: true
        }
      }
    }
  };

  chart = new Chart(chartCanvas, config);
}

// Export data
async function exportData(): Promise<void> {
  const format = exportFormatSelect.value;

  const result = await callTool('export-data', {
    dataset: currentDataset,
    filters: currentFilters,
    format
  }) as { format: string; recordCount: number; content: string };

  const blob = new Blob([result.content], {
    type: format === 'csv' ? 'text/csv' : 'application/json'
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentDataset}_export.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

// Event handlers
datasetSelect.addEventListener('change', async () => {
  currentDataset = datasetSelect.value;
  currentPage = 0;
  currentSort = null;
  currentFilters = [];

  if (currentDataset) {
    await loadSchema(currentDataset);
    await queryData();
  } else {
    tableContainer.innerHTML = '<p class="empty-state">Select a dataset to view data</p>';
    filterContainer.innerHTML = '<p class="empty-state">Select a dataset</p>';
    recordCount.textContent = '';
  }
});

applyFiltersBtn.addEventListener('click', () => {
  currentFilters = collectFilters();
  currentPage = 0;
  queryData();
});

clearFiltersBtn.addEventListener('click', () => {
  filterContainer.querySelectorAll('input, select').forEach((el) => {
    (el as HTMLInputElement | HTMLSelectElement).value = '';
  });
  currentFilters = [];
  currentPage = 0;
  queryData();
});

chartTypeSelect.addEventListener('change', updateChart);
chartGroupBySelect.addEventListener('change', updateChart);
chartMetricSelect.addEventListener('change', updateChart);
chartOperationSelect.addEventListener('change', updateChart);

exportBtn.addEventListener('click', exportData);

// Initialize
const transport = new PostMessageTransport(window.parent);
app.connect(transport).then(async () => {
  console.log('Data Explorer connected');
  await loadDatasets();
}).catch((error) => {
  console.error('Failed to connect:', error);
  tableContainer.innerHTML = '<p class="empty-state">Failed to connect to host</p>';
});
