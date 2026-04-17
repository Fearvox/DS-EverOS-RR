// Auth microservice entry point

import { handleRequest } from "./handlers";

const PORT = 3001;

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Auth service running on http://localhost:${server.port}`);
