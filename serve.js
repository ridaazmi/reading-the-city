// Minimal static server for local preview (no dependencies). Usage: node serve.js [dir] [port]
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(process.argv[2] || path.join(__dirname, "site"));
const port = +process.argv[3] || 8765;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": types[path.extname(f).toLowerCase()] || "application/octet-stream" });
    res.end(d);
  });
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
