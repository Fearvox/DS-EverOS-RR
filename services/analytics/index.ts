// Analytics microservice entry point

import { handleRequest } from "./handlers";

const PORT = 3007;

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Analytics service running on http://localhost:${server.port}`);
