import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api.js';

export default function GalleryPage() {
  const [images, setImages] = useState([]);
  const [state, setState] = useState('loading');
  const [activeIndex, setActiveIndex] = useState(-1);

  const loadGallery = useCallback(async () => {
    setState('loading');
    try {
      const result = await api('/gallery');
      setImages(Array.isArray(result?.data) ? result.data : []);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => { loadGallery(); }, [loadGallery]);
  useEffect(() => {
    if (activeIndex < 0) return undefined;
    const oldOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setActiveIndex(-1);
      if (event.key === 'ArrowRight') setActiveIndex((index) => (index + 1) % images.length);
      if (event.key === 'ArrowLeft') setActiveIndex((index) => (index - 1 + images.length) % images.length);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKeyDown); };
  }, [activeIndex, images.length]);

  const move = (step) => setActiveIndex((index) => (index + step + images.length) % images.length);
  const activeImage = activeIndex >= 0 ? images[activeIndex] : null;

  return <section className="section gallery-page" aria-labelledby="gallery-title">
    <header className="gallery-heading">
      <p className="eyebrow">A CLOSER LOOK</p>
      <h1 id="gallery-title">The gallery.</h1>
      <p className="lede">Objects, materials, and details from the National Handicrafts collection.</p>
    </header>
    {state === 'loading' ? <div className="gallery-message" role="status">Gathering the collection…</div> : null}
    {state === 'error' ? <div className="gallery-empty" role="alert"><p>The gallery could not be loaded just now.</p><button type="button" className="button secondary" onClick={loadGallery}>Try again</button></div> : null}
    {state === 'ready' && images.length === 0 ? <div className="gallery-empty"><span className="gallery-empty-mark" aria-hidden="true">✳</span><h2>New stories are taking shape.</h2><p>Published photographs from the collection will appear here.</p></div> : null}
    {state === 'ready' && images.length > 0 ? <div className="gallery-grid">{images.map((image, index) => <button className="gallery-card" key={image.id} type="button" onClick={() => setActiveIndex(index)} aria-label={`View ${image.title}`}>
      <span className="gallery-card-image"><img src={image.image_url} alt={image.title} loading="lazy" /></span>
      <span className="gallery-card-copy"><span className="gallery-card-category">{image.category}</span><strong>{image.title}</strong>{image.description && <span className="gallery-card-description">{image.description}</span>}</span>
    </button>)}</div> : null}
    {activeImage && <div className="gallery-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveIndex(-1); }}>
      <section className="gallery-lightbox-dialog" role="dialog" aria-modal="true" aria-label={activeImage.title}>
        <button type="button" className="gallery-lightbox-close" aria-label="Close image viewer" onClick={() => setActiveIndex(-1)}>×</button>
        {images.length > 1 && <button type="button" className="gallery-lightbox-arrow previous" aria-label="Previous image" onClick={() => move(-1)}>‹</button>}
        <figure><img src={activeImage.image_url} alt={activeImage.title} /><figcaption><span>{activeImage.category}</span><strong>{activeImage.title}</strong>{activeImage.description && <p>{activeImage.description}</p>}<small>{activeIndex + 1} / {images.length}</small></figcaption></figure>
        {images.length > 1 && <button type="button" className="gallery-lightbox-arrow next" aria-label="Next image" onClick={() => move(1)}>›</button>}
      </section>
    </div>}
  </section>;
}
