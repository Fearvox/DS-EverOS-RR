// Notifications microservice entry point

import { handleRequest } from "./handlers";

const PORT = 3006;

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Notifications service running on http://localhost:${server.port}`);
