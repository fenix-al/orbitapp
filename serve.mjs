// Tiny static file server for local preview:  npm run serve
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || 4000;
const TYPES = { ".html": "text/html", ".json": "application/json", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const file = path.join(process.cwd(), rel);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain" }); res.end("404 Not Found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(buf);
  });
}).listen(PORT, () => console.log(`Orbit running at http://localhost:${PORT}`));
