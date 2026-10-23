# Architecture

## Runtime flow

The browser loads the Vite bundle from `src/main.jsx`. The application shell owns the existing lightweight URL state: Home and Products are sections on the landing page, while About, Contact, Cart, Profile, product details, checkout, and `?admin=1` are page states. The sticky navigation uses browser history and section IDs rather than introducing a router dependency.

Frontend requests are centralized in `src/services/api.js`. It normalizes `VITE_API_URL`, sends cookies with requests, parses JSON, and exposes shared image URL and INR formatting helpers. `SafeImage` provides a controlled fallback to the existing emblem when an asset fails.

## Backend layers

`server/index.js` loads the environment-aware port and starts the app. `server/app.js` composes Express middleware and currently contains the compatibility route wiring. Dedicated modules hold environment/payment configuration (`server/config/env.js`) and reusable request limiting (`server/middleware/rateLimit.js`). The next safe extraction targets are route controllers and service functions; endpoint paths and response payloads must remain stable during that work.

## Persistence

`server/repository.js` exposes the persistence contract implemented by `MemoryRepository` and `PostgresRepository`. Products are public only when `active = true` and `verification_status = 'verified'`. Orders recalculate line prices from the repository, not from browser totals. PostgreSQL uses `server/schema.sql` for a fresh database and ordered files under `server/migrations/` for existing installations.

Customer accounts are stored in `customers`; saved addresses are stored in `customer_addresses`; `orders.customer_id` associates signed-in orders with the authenticated customer while retaining the existing customer JSON snapshot for order history. Legacy anonymous orders remain available to administrators but are not exposed through a customer account.

## Authentication and authorization

Administrator and customer sessions use different cookie names and different CSRF cookie names. Both sessions are signed, HttpOnly, SameSite cookies with expiry. Passwords are verified with bcryptjs. Admin routes require `role === 'admin'`; customer routes derive ownership from the verified customer session and never accept a browser-supplied customer ID. Mutating authenticated requests require the matching CSRF header. Login/order bursts use an in-process rate limiter; production deployments should place a shared rate limit at the edge as well.

The Profile page can submit credentials to the existing admin login endpoint. Only a server response with the admin role causes navigation to `/?admin=1`; customer credentials continue through customer authentication. The frontend contains no admin password or session secret.

## Catalogue and order flow

An administrator uploads genuine product images and enters source/provenance fields. Products remain unpublished until the existing verification rules allow publication. Customers see only verified public records. Cart and Buy Now retain client-side item selections, but the API reloads each product and calculates price, stock, and total server-side. Orders begin with a separate fulfilment status and payment status; UPI display or screenshot sharing never marks payment as verified.

## Admin portal

The admin portal authenticates through `/api/auth/login`, loads `/api/auth/me` and a CSRF token, then calls protected dashboard, product, upload, order, and payment-verification endpoints. Existing role checks, product publication rules, and order/payment separation are preserved while shared server boundaries are extracted.

## Refactoring policy

Refactor one dependency boundary at a time. After each extraction, run `npm.cmd test` and `npm.cmd run build`. Do not move assets, change API contracts, alter schema semantics, or delete legacy code until all imports and browser paths have been verified. The current extraction leaves the original composition modules in place deliberately so the storefront and admin portal remain behaviorally compatible while further page-level modules are introduced.
