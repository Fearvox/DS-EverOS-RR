import { handleRequest } from "./handlers";

const server = Bun.serve({
  port: 3008,
  fetch: handleRequest,
});

console.log(`Search service running on http://localhost:${server.port}`);
