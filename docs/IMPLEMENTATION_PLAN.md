# National Handicrafts Bengaluru

## Source review

- The supplied deck describes a premium Indian handicraft shopping experience with Home, About, Products, Contact, Cart, product details, checkout, and an admin catalogue flow.
- The deck's visual direction uses warm ivory backgrounds, terracotta/copper accents, antique gold highlights, deep brown text, serif display typography, and generous editorial spacing.
- The deck includes the supplied heritage emblem plus category/product reference illustrations. These are preserved as source assets and are not treated as verified catalogue photography.
- Eight catalog PDFs were found in `C:\Users\magli\Downloads`. Their binary content contains OCR/image text markers such as INR, puja, diya, bowl, and rate, but reliable page-level extraction is not available in this environment. All catalogue price/specification fields therefore remain review-gated.

## Build stages

1. Establish a Vite React frontend, shared design tokens, responsive shell, and provenance-aware product data.
2. Implement Home, About, Products, Product detail, Cart, Checkout enquiry flow, and Contact pages.
3. Add a Node/Express REST API with PostgreSQL-ready schema, server-side totals, and a development fallback store.
4. Add admin authentication boundaries and product/order management endpoints.
5. Add catalogue import documentation and a review queue for unreadable or ambiguous source records.
6. Run build checks and responsive smoke tests; document deployment and remaining credentials.

## Data safety decisions

- No catalogue price, stock quantity, size, material, or dimension is presented as verified unless it comes from a reviewed record.
- Products with unresolved pricing show `Price on request` and route checkout into an enquiry flow.
- Client prices are never accepted for server-side order totals.
- Real payment is intentionally not enabled until provider credentials and merchant details are supplied.

