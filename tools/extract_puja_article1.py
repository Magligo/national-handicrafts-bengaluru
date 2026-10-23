from __future__ import annotations

import csv
import re
import zlib
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / 'reference-files' / 'puja article 1 ( Surya Prakash).pdf'
OUT = ROOT / 'public' / 'product-assets' / 'puja-article-1'
EMBEDDED = OUT / 'embedded-page-sheets'
REVIEW = OUT / 'review'
CSV_PATH = OUT / 'puja-article-1-draft.csv'


def parse_objects(data: bytes):
    pattern = re.compile(rb'(\d+)\s+(\d+)\s+obj\s*(.*?)\s*endobj', re.S)
    return {int(match.group(1)): match.group(3) for match in pattern.finditer(data)}


def undo_predictor(decoded: bytes, width: int, height: int, channels: int) -> np.ndarray:
    row_bytes = width * channels
    rows = np.frombuffer(decoded, dtype=np.uint8).reshape(height, row_bytes + 1)
    filters = rows[:, 0]
    encoded = rows[:, 1:]
    output = np.empty((height, row_bytes), dtype=np.uint8)
    previous = np.zeros(row_bytes, dtype=np.uint16)
    for row in range(height):
        values = encoded[row].astype(np.uint16)
        filter_type = int(filters[row])
        if filter_type == 0:
            current = values
        elif filter_type == 1:
            current = values.copy()
            for channel in range(channels):
                current[channel::channels] = np.cumsum(values[channel::channels], dtype=np.uint32) % 256
        elif filter_type == 2:
            current = (values + previous) % 256
        elif filter_type == 3:
            current = (values + ((previous + np.concatenate(([0] * channels, output[row, :-channels].astype(np.uint16)))) // 2)) % 256
        elif filter_type == 4:
            left = np.concatenate(([0] * channels, output[row, :-channels].astype(np.uint16)))
            above = previous
            upper_left = np.concatenate(([0] * channels, np.array(previous[:-channels], dtype=np.uint16)))
            estimate = left + above - upper_left
            pa = np.abs(estimate - left)
            pb = np.abs(estimate - above)
            pc = np.abs(estimate - upper_left)
            predictor = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, above, upper_left))
            current = (values + predictor) % 256
        else:
            raise ValueError(f'Unsupported PNG predictor filter {filter_type}')
        output[row] = current.astype(np.uint8)
        previous = current
    return output.reshape(height, width, channels)


def extract_image(body: bytes) -> np.ndarray:
    width = int(re.search(rb'/Width\s+(\d+)', body).group(1))
    height = int(re.search(rb'/Height\s+(\d+)', body).group(1))
    start = body.find(b'stream') + 6
    while body[start] in (10, 13, 32):
        start += 1
    end = body.find(b'endstream', start)
    decoded = zlib.decompress(body[start:end])
    if len(decoded) == width * height:
        return np.repeat(np.frombuffer(decoded, dtype=np.uint8).reshape(height, width, 1), 3, axis=2)
    if len(decoded) == width * height * 3:
        return np.frombuffer(decoded, dtype=np.uint8).reshape(height, width, 3)
    channels = 3 if len(decoded) == height * (width * 3 + 1) else 1
    image = undo_predictor(decoded, width, height, channels)
    return np.repeat(image, 3, axis=2) if channels == 1 else image


def save_png(path: Path, rgb: np.ndarray) -> None:
    ok, encoded = cv2.imencode('.png', cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_PNG_COMPRESSION, 3])
    if not ok:
        raise RuntimeError(f'Could not encode {path}')
    path.write_bytes(encoded.tobytes())


def make_contact_sheet(images: list[np.ndarray], output: Path) -> None:
    columns, thumb_w, thumb_h, label_h = 5, 180, 180, 28
    rows = (len(images) + columns - 1) // columns
    sheet = np.full((rows * (thumb_h + label_h), columns * thumb_w, 3), (246, 242, 235), dtype=np.uint8)
    for index, rgb in enumerate(images):
        x, y = (index % columns) * thumb_w, (index // columns) * (thumb_h + label_h)
        thumb = cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
        sheet[y : y + thumb_h, x : x + thumb_w] = thumb
        sheet[y + thumb_h : y + thumb_h + label_h, x : x + thumb_w] = (74, 47, 32)
        cv2.putText(sheet, f'{index + 1:03d}', (x + 8, y + thumb_h + 20), cv2.FONT_HERSHEY_SIMPLEX, .48, (255, 255, 255), 1, cv2.LINE_AA)
    save_png(output, cv2.cvtColor(sheet, cv2.COLOR_BGR2RGB))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    EMBEDDED.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    objects = parse_objects(PDF.read_bytes())
    image_objects = [object_id for object_id, body in objects.items() if b'/Subtype/Image' in body]
    page_images = []
    page_objects = [body for body in objects.values() if b'/Type/Page' in body]
    for page_number, body in enumerate(page_objects, start=1):
        if b'/Type/Page' in body:
            match = re.search(rb'/XObject\s*<</img\d+\s+(\d+)\s+\d+\s+R', body)
            if match:
                page_images.append((page_number, int(match.group(1))))
    extracted, csv_rows = [], []
    object_to_page = {object_id: page for page, object_id in page_images}
    for embed_index, object_id in enumerate(image_objects, start=1):
        rgb = extract_image(objects[object_id])
        filename = f'puja-article-1-embed-{embed_index:03d}.png'
        save_png(EMBEDDED / filename, rgb)
        extracted.append(rgb)
        csv_rows.append({
            'product_name': 'Unidentified puja article image',
            'category': 'Puja Articles',
            'source_pdf': PDF.name,
            'page_number': object_to_page.get(object_id, 'unknown'),
            'image_filename': f'embedded-page-sheets/{filename}',
            'listed_price': '',
            'unit_variant': '',
            'verification_status': 'needs_manual_review',
            'review_notes': 'Embedded 1200x1200 page-sheet image; crop and read printed fields manually before publishing.',
        })
    make_contact_sheet(extracted, REVIEW / 'puja-article-1-contact-sheet.png')
    with CSV_PATH.open('w', newline='', encoding='utf-8-sig') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(csv_rows[0]))
        writer.writeheader()
        writer.writerows(csv_rows)
    print(f'Extracted {len(extracted)} embedded images')
    print(f'Mapped {len(object_to_page)} page image references')
    print(f'Contact sheet: {REVIEW / "puja-article-1-contact-sheet.png"}')
    print(f'Draft CSV: {CSV_PATH}')


if __name__ == '__main__':
    main()
