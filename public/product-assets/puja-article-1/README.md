# Puja Article 1 asset review

Source: `reference-files/puja article 1 ( Surya Prakash).pdf`

## Extraction result

- 100 PDF page objects were detected.
- 101 embedded 1200x1200 Flate-compressed image objects were decoded without changing the source pixels.
- 100 embedded images map to PDF page resources.
- One embedded image object does not have a reliable page-resource mapping and remains marked `unknown` in the draft CSV.
- The embedded images are full catalogue sheets containing product photography and printed catalogue text. They are not clean product-only images.

## Review decision

- No product image has been promoted to a publishable product asset.
- No price, unit, variant, stock value, or product name has been marked verified.
- Manual cropping is required for the product photos shown in the contact sheet. Crops must exclude printed prices and unrelated catalogue content.
- The contact sheet index corresponds to the `embed-###` filename in `embedded-page-sheets/`.

## Files

- `embedded-page-sheets/`: lossless decoded page-sheet images for review only.
- `review/puja-article-1-contact-sheet.png`: contact sheet indexed 001-101.
- `puja-article-1-draft.csv`: draft records with source page mapping where available.
