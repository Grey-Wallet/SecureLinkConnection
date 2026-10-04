import { createServer } from "node:http";
import { handleRequest } from "./routes.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

createServer((req, res) => {
  void handleRequest(req, res, host, port);
}).listen(port, host, () => {
  console.log(`SecureLink Todo API → http://${host}:${port}`);
});
