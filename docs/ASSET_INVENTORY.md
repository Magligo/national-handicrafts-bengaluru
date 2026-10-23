# Asset inventory

## Supplied deck

| Asset | Source | Use | Status |
| --- | --- | --- | --- |
| Heritage emblem | `National_Handicrafts_Redesigned (4).pptx`, `ppt/media/image1.png` | Brand mark and hero visual | Supplied, preserved |
| Dining set illustration | Same deck, `ppt/media/image2.png` | Category reference visual | Supplied, decorative/reference |
| Lidded vessel illustration | Same deck, `ppt/media/image3.png` | Category reference visual | Supplied, decorative/reference |
| Open vessel illustration | Same deck, `ppt/media/image4.png` | Category reference visual | Supplied, decorative/reference |
| Elephant illustration | Same deck, `ppt/media/image5.png` | Decorative handicrafts reference visual | Supplied, decorative/reference |

## Catalogues found

| Source file | Category signal | Price/specification status |
| --- | --- | --- |
| `brass utensils 1 ( Surya Prakash ).pdf` | Brass utensils, diya/rate markers | Needs page-level verification |
| `brass utensils 3 ( Surya Prakash ) .pdf` | Brass utensils, bowl/INR markers | Needs page-level verification |
| `manufacturing bundle rate ( Surya Prakash ).pdf` | Manufacturing/bundle rates | Needs page-level verification |
| `puja article 1 ( Surya Prakash).pdf` | Puja articles, INR/puja markers | Needs page-level verification |
| `puja article 2 ( Surya Prakash ).pdf` | Puja articles, INR markers | Needs page-level verification |
| `puja article 3 ( Surya Prakash ) .pdf` | Puja articles, INR markers | Needs page-level verification |
| `puja article 4 ( Surya Prakash ).pdf` | Puja articles | Needs page-level verification |
| `puja article 5 ( Surya Prakash ).pdf` | Puja articles, INR/puja markers | Needs page-level verification |

## Import review rules

- Keep original PDFs unchanged.
- Extract one product record per clearly identified item.
- Store the source filename and page number on every imported record.
- Use `verificationStatus: pending` for unreadable prices, dimensions, material, stock, or variant labels.
- Use `price: null` instead of guessing; the storefront displays `Price on request`.
- Do not use a full catalogue page as a product image. Crop only after a human confirms the item boundary and that printed pricing is excluded.

