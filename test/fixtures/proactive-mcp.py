"""A disposable read-only MCP catalog; discovery must never invoke a tool."""
import json
import sys
from pathlib import Path
for line in sys.stdin:
    request = json.loads(line)
    if 'id' not in request:
        continue
    method = request.get('method')
    if method == 'initialize':
        result = {'protocolVersion': request['params']['protocolVersion'], 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'synthetic-calendar', 'version': '1'}}
    elif method == 'tools/list':
        result = {'tools': [{'name': 'calendar_list_events', 'description': 'Read upcoming events.', 'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False}, 'annotations': {'readOnlyHint': True}}]}
    elif method == 'tools/call':
        Path(sys.argv[1]).write_text('unexpected tool invocation')
        result = {'content': [{'type': 'text', 'text': 'Unexpected call'}]}
    elif method == 'ping':
        result = {}
    else:
        print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'error': {'code': -32601, 'message': 'Unsupported method'}}), flush=True)
        continue
    print(json.dumps({'jsonrpc': '2.0', 'id': request['id'], 'result': result}), flush=True)
