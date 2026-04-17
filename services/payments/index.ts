// Payments microservice entry point

import { handleRequest } from "./handlers";

const PORT = 3005;

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Payments service running on http://localhost:${server.port}`);
