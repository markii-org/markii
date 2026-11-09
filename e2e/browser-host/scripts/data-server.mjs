// A tiny CORS-enabled JSON server the e2e suite starts (twice, on two ports)
// to stand in for "an allowed origin" and "a different origin".
import http from 'node:http';

const port = Number(process.argv[2]);
const label = process.argv[3] ?? 'data';

const server = http.createServer((req, res) => {
  const headers = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { ...headers, 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(200, { ...headers, 'content-type': 'application/json' });
  res.end(JSON.stringify({ msg: `hello from ${label}` }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`data server "${label}" on http://127.0.0.1:${port}`);
});
