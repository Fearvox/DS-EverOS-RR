// Users microservice entry point

import { handleRequest } from "./handlers";

const server = Bun.serve({
  port: 3002,
  fetch: handleRequest,
});

console.log(`Users service running on http://localhost:${server.port}`);
