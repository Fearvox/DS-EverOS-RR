import { handleRequest } from "./handlers";

const server = Bun.serve({
  port: 3003,
  fetch: handleRequest,
});

console.log(`Products service running on http://localhost:${server.port}`);
