# Microservice Suite

Production-ready microservice suite built with TypeScript and Bun runtime.

## Architecture

```
services/
├── shared/          # Shared types, HTTP utilities, in-memory store, validation
├── auth/            # Authentication & session management (port 3001)
├── users/           # User management & profiles (port 3002)
├── products/        # Product catalog & inventory (port 3003)
├── orders/          # Order lifecycle management (port 3004)
├── payments/        # Payment processing & refunds (port 3005)
├── notifications/   # Multi-channel notifications (port 3006)
├── analytics/       # Event tracking & analysis (port 3007)
├── search/          # Full-text search & indexing (port 3008)
└── integration/     # Cross-service workflow tests
```

## Design Decisions

- **Pure function handlers**: Each service exports `handleRequest(req: Request): Promise<Response>` — no server startup needed for testing
- **In-memory stores**: Based on `Map<string, T>` via `MemoryStore<T>` base class — O(1) CRUD, easy to reset between tests
- **Zero external dependencies**: Only Bun built-ins and `bun:test`
- **Shared infrastructure**: Common types, HTTP response builders, validation utilities ensure consistency

## Running Tests

```bash
# All tests
bun test services/

# Single service
bun test services/auth/

# Test runner with summary
bun run services/run-tests.ts

# Shell runner
bash services/run-tests.sh
```

## Running Services

```bash
# Start individual service
bun run services/auth/index.ts
bun run services/users/index.ts
# etc.
```

## Service Overview

| Service | Port | Endpoints | Key Features |
|---------|------|-----------|-------------|
| auth | 3001 | 12 | Registration, login, sessions, password reset, token validation |
| users | 3002 | 12 | CRUD, roles, suspend/activate, activity log, bulk ops |
| products | 3003 | 12 | Catalog, stock management, categories, bulk pricing, search |
| orders | 3004 | 12 | Order lifecycle, status transitions, item management, stats |
| payments | 3005 | 12 | Processing simulation, refunds, multi-currency, receipts |
| notifications | 3006 | 12 | Multi-channel, templates, bulk send, read tracking |
| analytics | 3007 | 13 | Event tracking, funnel analysis, retention, trends |
| search | 3008 | 12 | Full-text search, TF scoring, autocomplete, facets |

## Cross-Service Workflows

Integration tests cover:
1. **User Registration Flow**: Register → Login → Get Profile
2. **Order Workflow**: Create User → Add Products → Create Order → Process Payment
3. **Notification Pipeline**: Payment Complete → Send Notification → Mark Read
4. **Analytics Tracking**: Track events across user journey, verify funnel conversion
