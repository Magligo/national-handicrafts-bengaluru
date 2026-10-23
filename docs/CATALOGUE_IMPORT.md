# Catalogue import workflow

1. Keep the original catalogue PDF outside the application source tree.
2. Review each page and create a row with `source_catalogue` and `source_page`.
3. Record the exact printed item name. Do not normalize away meaningful variant or bundle wording.
4. Enter `price_inr` only when the printed rate and unit are unambiguous. Otherwise leave it null.
5. Enter dimensions, material, stock and variants only when the source explicitly states them.
6. Crop an individual product image after confirming the crop excludes printed pricing and unrelated catalogue content.
7. Set `verification_status` to `verified` only after a second review of name, image, price and units.
8. Import approved rows through the future admin upload/import screen. The storefront must continue to show `Price on request` for pending rows.
