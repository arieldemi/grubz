const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "public");
const port = Math.max(1, Number(process.env.PORT || 8080));
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
};

function resolvedFile(urlValue = "/") {
  const pathname = decodeURIComponent(String(urlValue).split("?")[0]);
  const requested = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const candidate = path.resolve(publicDir, `.${requested}`);
  if (candidate !== publicDir && !candidate.startsWith(`${publicDir}${path.sep}`)) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  if (pathname === "/console" || pathname.startsWith("/console/")) {
    return path.join(publicDir, "console", "index.html");
  }
  return path.join(publicDir, "index.html");
}

http.createServer((req, res) => {
  let file;
  try { file = resolvedFile(req.url); } catch { file = null; }
  if (!file) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Bad request");
  }
  fs.stat(file, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const headers = {
      "Content-Type": mimeTypes[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": file.endsWith(".html") ? "no-cache, max-age=0, must-revalidate" : "public, max-age=3600",
    };
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(file).pipe(res);
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`GRUBZ static server listening on ${port}`);
});
