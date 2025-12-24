// Simple host that handles postMessage communication with the App

const statusDot = document.getElementById('statusDot')!;
const statusText = document.getElementById('statusText')!;
const logContent = document.getElementById('logContent')!;
const appFrame = document.getElementById('appFrame') as HTMLIFrameElement;

function addLog(type: 'request' | 'response' | 'error' | 'info', data: unknown): void {
  const emptyLog = logContent.querySelector('.empty-log');
  if (emptyLog) emptyLog.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString();
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  let dataStr: string;
  if (typeof data === 'string') {
    dataStr = data;
  } else {
    dataStr = JSON.stringify(data, null, 2);
    if (dataStr.length > 200) {
      dataStr = dataStr.substring(0, 200) + '...';
    }
  }

  entry.innerHTML = `
    <div class="log-time">${time}</div>
    <div class="log-type">${typeLabel}</div>
    <div class="log-data">${escapeHtml(dataStr)}</div>
  `;
  logContent.insertBefore(entry, logContent.firstChild);
  while (logContent.children.length > 30) {
    logContent.removeChild(logContent.lastChild!);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setStatus(connected: boolean, message?: string): void {
  statusDot.classList.toggle('connected', connected);
  statusText.textContent = message || (connected ? 'Connected' : 'Disconnected');
}

// Call the MCP server's HTTP API
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`http://localhost:3001/api/tools/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return response.json();
}

// Handle messages from the iframe
async function handleMessage(event: MessageEvent): Promise<void> {
  if (event.source !== appFrame.contentWindow) return;

  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.jsonrpc === '2.0' && message.id !== undefined) {
    // Request
    addLog('request', { method: message.method, params: message.params ? '...' : undefined });

    try {
      let result: unknown;

      switch (message.method) {
        case 'ui/initialize':
          result = {
            protocolVersion: message.params?.protocolVersion || '2025-11-21',
            hostCapabilities: {
              serverTools: {},
              logging: {},
            },
            hostInfo: {
              name: 'DataExplorerHost',
              version: '1.0.0',
            },
            hostContext: {},
          };
          setStatus(true, 'Connected');
          break;

        case 'tools/call':
          const toolResult = await callTool(
            message.params.name,
            message.params.arguments || {}
          );
          result = toolResult;
          break;

        case 'ping':
          result = {};
          break;

        default:
          addLog('info', `Unhandled: ${message.method}`);
          result = {};
      }

      const response = {
        jsonrpc: '2.0',
        id: message.id,
        result,
      };
      addLog('response', message.method === 'tools/call' ? `${message.params?.name} OK` : 'OK');
      appFrame.contentWindow?.postMessage(response, '*');

    } catch (error) {
      const errorResponse = {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32000,
          message: String(error),
        },
      };
      addLog('error', String(error));
      appFrame.contentWindow?.postMessage(errorResponse, '*');
    }
  } else if (message.method) {
    // Notification
    addLog('info', `Notification: ${message.method}`);
  }
}

// Initialize
function init(): void {
  setStatus(false, 'Waiting for app...');
  addLog('info', 'Host ready');
  window.addEventListener('message', handleMessage);
  appFrame.onload = () => addLog('info', 'Iframe loaded');
}

init();
