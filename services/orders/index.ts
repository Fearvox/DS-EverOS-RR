// Orders microservice entry point

import { handleRequest } from "./handlers";

const PORT = 3004;

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Orders service running on http://localhost:${server.port}`);
