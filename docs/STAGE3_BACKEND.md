# Stage 3 backend and admin portal

## Local setup

1. Copy `.env.example` to `.env` and set a long random `ADMIN_SESSION_SECRET`.
2. Create a PostgreSQL database, then run `psql "$DATABASE_URL" -f server/schema.sql`.
3. Hash an admin password; never put the plaintext password in `.env`:

   `node -e "const b=require('bcryptjs'); b.hash(process.argv[1],12).then(console.log)" "replace-me"`

   Put the resulting hash in `ADMIN_PASSWORD_HASH`, with the matching `ADMIN_EMAIL`.
4. Run `npm run server` and `npm run dev` in separate terminals.

For tests and UI/API smoke checks on a machine without PostgreSQL, set `USE_IN_MEMORY_DB=true`. This is explicit test-only storage and is not durable.

The admin portal is available at `http://localhost:5173/?admin=1`. Product image uploads are stored locally in `public/uploads/products` and are ignored by git.

## API surface

Public: `GET /api/products`, `GET /api/products/:id`, `POST /api/orders`.

Admin session: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`.

Admin: dashboard, product CRUD, image upload, order listing, and order-status updates under `/api/admin/*`. All admin routes are server-protected by an HttpOnly signed cookie.

## Production work still required

Use managed PostgreSQL with migrations/backups, a secret manager, HTTPS-only cookies, rate limiting and audit logs, object storage/CDN (S3/R2/etc.) instead of local uploads, hosted API/frontend configuration, email notifications, and a real payment provider only after merchant credentials and order/payment rules are supplied. The current order endpoint is an enquiry/order-storage flow and does not claim payment success.
