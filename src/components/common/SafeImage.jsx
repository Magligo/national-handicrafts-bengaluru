import { useState } from 'react';

export default function SafeImage({ src, alt, className = '' }) {
  const resolvedSrc = alt === 'Open brass vessel reference' ? '/assets/hanging-brass-lanterns.png' : src;
  const [imageSrc, setImageSrc] = useState(resolvedSrc);

  return (
    <img
      className={className}
      src={imageSrc || '/assets/heritage-emblem.png'}
      alt={alt === 'Open brass vessel reference' ? 'Handcrafted brass hanging lanterns' : alt}
      onError={() => setImageSrc('/assets/heritage-emblem.png')}
    />
  );
}
