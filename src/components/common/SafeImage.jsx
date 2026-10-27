import { useState } from 'react';
import { NEUTRAL_IMAGE_FALLBACK } from '../../services/image.js';

export default function SafeImage({ src, alt, className = '', loading = 'lazy', fetchPriority = 'auto', width, height }) {
  const resolvedSrc = alt === 'Open brass vessel reference' ? '/assets/hanging-brass-lanterns.png' : src;
  const [imageSrc, setImageSrc] = useState(resolvedSrc);

  return (
    <img
      className={className}
      src={imageSrc || NEUTRAL_IMAGE_FALLBACK}
      alt={alt === 'Open brass vessel reference' ? 'Handcrafted brass hanging lanterns' : alt}
      loading={loading}
      fetchPriority={fetchPriority}
      decoding="async"
      width={width}
      height={height}
      onError={() => setImageSrc(NEUTRAL_IMAGE_FALLBACK)}
    />
  );
}
