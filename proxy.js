// Minimal proxy: forwards all requests to the Flask server on port 5050
const http = require('http');

const TARGET_PORT = 5050;
const PROXY_PORT  = 5051;

const server = http.createServer((req, res) => {
  const options = {
    hostname: '127.0.0.1',
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };
  const proxy = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxy.on('error', () => {
    res.writeHead(502);
    res.end('Flask server not running on port ' + TARGET_PORT);
  });
  req.pipe(proxy, { end: true });
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log('Proxy listening on http://127.0.0.1:' + PROXY_PORT);
});
