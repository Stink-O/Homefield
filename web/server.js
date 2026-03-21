const { createServer } = require("https");
const { parse } = require("url");
const next = require("next");
const fs = require("fs");
const path = require("path");

const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

const keyPath = process.env.HTTPS_KEY_PATH;
const certPath = process.env.HTTPS_CERT_PATH;

if (!keyPath || !certPath) {
  console.error("Error: HTTPS_KEY_PATH and HTTPS_CERT_PATH must be set to use server.js.");
  console.error("For plain HTTP, use: npm run start");
  process.exit(1);
}

const httpsOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
};

const host = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

app.prepare().then(() => {
  createServer(httpsOptions, (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, host, () => {
    console.log(`> Ready on https://${host}:${port}`);
  });
});
