# National Handicrafts Bengaluru

National Handicrafts Bengaluru is a React/Vite storefront backed by an Express REST API. It presents only verified catalogue records to customers and provides protected customer and administrator workflows for orders, product review, uploads, and payment-status handling.

## Technology stack

- React and Vite for the responsive storefront and admin UI.
- Express for the API, uploads, authentication, CSRF checks, and rate limiting.
- PostgreSQL for durable production data.
- An in-memory repository for tests and explicit local development without PostgreSQL.
- bcryptjs for password hashing and signed HttpOnly cookies for sessions.

## Repository structure

```text
public/                 Browser-served brand, texture, catalogue, and upload assets
src/
  config/               Frontend runtime configuration, including the normalized API URL
  components/common/    Shared React primitives such as SafeImage
  components/product/   Product listing and card components
  constants/            Catalogue categories and asset mappings
  services/             Frontend API, URL, and formatting helpers
  main.jsx              Current application shell and page composition
  admin.jsx             Current protected admin portal UI
  styles.css            Existing shared design system and responsive styles
server/
  config/               Environment-derived server configuration
  middleware/           Reusable request security helpers
  migrations/           Ordered PostgreSQL migrations
  app.js                Express composition and API wiring
  auth.js               Signed admin/customer sessions and CSRF helpers
  repository.js         PostgreSQL and in-memory persistence implementations
  validation.js         Server-side product, order, customer, and address validation
docs/                   Architecture, asset, catalogue, and implementation notes
```

The storefront keeps `main.jsx` and the protected admin portal as compatibility-oriented composition files so the existing navigation, visual design, and feature behavior remain unchanged. Shared configuration, API access, catalogue components, and common UI primitives live in their dedicated folders. New code should go into the relevant boundary instead of adding more fetch logic or styling to unrelated components.

## Frontend and backend communication

The frontend calls `VITE_API_URL` with `credentials: 'include'`. By default this is `http://localhost:4000/api`. The backend enables CORS only for `FRONTEND_ORIGIN` and serves uploaded product images from `/uploads`.

## Environment configuration

Copy the safe template:

```powershell
Copy-Item .env.example .env
```

Set a long random `ADMIN_SESSION_SECRET` and a different `CUSTOMER_SESSION_SECRET`. Set `ADMIN_EMAIL` and a bcrypt hash in `ADMIN_PASSWORD_HASH`; never put a plaintext password in `.env`. Configure `DATABASE_URL` for PostgreSQL, or set `USE_IN_MEMORY_DB=true` for development/test-only storage.

Payment settings remain disabled until the owner supplies real values for `PAYMENT_UPI_ID` and `PAYMENT_UPI_PAYEE_NAME`.

## Local development

Install dependencies once from the project root with `npm.cmd install`.

For local development without PostgreSQL, set the explicit in-memory repository before starting the API:

```powershell
$env:USE_IN_MEMORY_DB = 'true'
```

Terminal 1 — API:

```powershell
npm.cmd run server:dev
```

Terminal 2 — frontend:

```powershell
npm.cmd run dev
```

Open `http://localhost:5173/`. The customer profile is at `http://localhost:5173/profile`; the protected admin entry is `http://localhost:5173/?admin=1`.

The API listens on `http://localhost:4000`; verify it at `/api/health`, with the catalogue at `/api/products`. The Vite client uses `http://localhost:4000/api` by default. If the API runs elsewhere, set `VITE_API_URL` to its `/api` base URL before starting Vite.

## PostgreSQL and migrations

For a new database:

```powershell
psql "$env:DATABASE_URL" -f server/schema.sql
```

For an existing database, apply the ordered files that have not been applied, including:

```powershell
psql "$env:DATABASE_URL" -f server/migrations/001_admin_product_fields.sql
psql "$env:DATABASE_URL" -f server/migrations/002_order_payment_fields.sql
psql "$env:DATABASE_URL" -f server/migrations/003_customer_accounts.sql
psql "$env:DATABASE_URL" -f server/migrations/004_cod_order_fields.sql
```

The project does not claim PostgreSQL persistence until `DATABASE_URL` is configured and migrations complete successfully. In-memory customer accounts, products, and orders reset when the process stops.

With PostgreSQL configured in `.env`, use the production-style API command:

```powershell
npm.cmd run server:prod
```

This requires `DATABASE_URL`; when `NODE_ENV=production`, the API also fails fast unless `ADMIN_SESSION_SECRET` is configured.

## Tests and build

```powershell
npm.cmd test
npm.cmd run build
```

The test suite covers admin authorization, bcrypt login, session/logout behavior, CSRF protection, product verification/publication, image uploads, server-side order totals, duplicate orders, UPI configuration, customer authentication, profile/address ownership, and private customer orders.

## Extension guide

- Add a reusable UI primitive under `src/components/` and keep page orchestration in a page/component module.
- Add API calls to `src/services/` instead of embedding fetch logic in unrelated components.
- Add route and catalogue constants under `src/constants/`.
- Add a page-specific stylesheet only when a rule cannot belong to the shared design system.
- Add an Express endpoint with a route/controller boundary, server validation, authorization middleware, and repository method; preserve the existing response shape unless all callers are migrated.
- Add a product field to server validation, PostgreSQL schema/migrations, both repositories, admin form handling, and tests before exposing it publicly.

## Deployment

Use a managed PostgreSQL instance, a secret manager, HTTPS, a separately hosted frontend/API with an explicit `FRONTEND_ORIGIN`, and durable object storage for uploads. Run migrations before starting the API. Do not use the in-memory repository in production. A real payment provider and verified webhook are still required before treating UPI payments as automatically verified.
