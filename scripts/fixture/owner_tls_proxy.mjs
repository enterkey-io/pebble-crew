// Disposable loopback TLS front door for browser acceptance tests only.
import { createServer } from 'node:https';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
const server = createServer(
  { cert: readFileSync(process.argv[2]), key: readFileSync(process.argv[3]) },
  (incoming, outgoing) => {
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: Number(process.argv[4] ?? 8099),
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on('error', () => outgoing.writeHead(502).end());
    incoming.pipe(upstream);
  },
);
server.listen(Number(process.argv[5] ?? 5445), '127.0.0.1');
