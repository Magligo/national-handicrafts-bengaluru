import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../services/api.js';

const filters = [['all', 'All'], ['photo', 'Photos'], ['video', 'Videos'], ['link', 'Links']];
function itemType(item) { return item.media_type || 'photo'; }
function youtubeEmbed(url) {
  try { const parsed = new URL(url); let id = ''; if (parsed.hostname === 'youtu.be') id = parsed.pathname.slice(1); else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(parsed.hostname)) id = parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:embed|shorts)\/([^/?]+)/)?.[1] || ''; return /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : ''; } catch { return ''; }
}

export default function GalleryPage() {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');
  const [filter, setFilter] = useState('all');
  const [activeId, setActiveId] = useState('');
  const comparisonRef = useRef(null);
  const comparisonPosition = useRef(50);
  const comparisonDragging = useRef(false);
  const loadGallery = useCallback(async () => { setState('loading'); try { const result = await api('/gallery'); setItems(Array.isArray(result?.data) ? result.data : []); setState('ready'); } catch { setState('error'); } }, []);
  useEffect(() => { loadGallery(); }, [loadGallery]);
  const visibleItems = useMemo(() => items.filter((item) => filter === 'all' || itemType(item) === filter), [items, filter]);
  const active = visibleItems.find((item) => item.id === activeId) || items.find((item) => item.id === activeId);
  const photoItems = visibleItems.filter((item) => itemType(item) === 'photo');
  useEffect(() => {
    if (!active) return undefined;
    const priorOverflow = document.body.style.overflow;
    const onKeyDown = (event) => { if (event.key === 'Escape') setActiveId(''); };
    document.body.style.overflow = 'hidden'; document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = priorOverflow; document.removeEventListener('keydown', onKeyDown); };
  }, [active]);
  const movePhoto = (direction) => { const index = photoItems.findIndex((item) => item.id === active?.id); if (photoItems.length) setActiveId(photoItems[(index + direction + photoItems.length) % photoItems.length].id); };
  const close = () => setActiveId('');
  const closeOnBackdrop = (event) => { if (event.target === event.currentTarget) close(); };
  const setComparisonPosition = (next) => {
    const value = Math.max(0, Math.min(100, next));
    comparisonPosition.current = value;
    const slider = comparisonRef.current;
    if (!slider) return;
    slider.style.setProperty('--comparison-position', `${value}%`);
    slider.setAttribute('aria-valuenow', String(Math.round(value)));
    slider.setAttribute('aria-valuetext', `${Math.round(value)}% after image visible`);
  };
  const updateComparisonFromPointer = (event) => {
    const slider = comparisonRef.current;
    if (!slider) return;
    const bounds = slider.getBoundingClientRect();
    setComparisonPosition(((event.clientX - bounds.left) / bounds.width) * 100);
  };
  const startComparisonDrag = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    comparisonDragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateComparisonFromPointer(event);
  };
  const moveComparisonDrag = (event) => {
    if (comparisonDragging.current) updateComparisonFromPointer(event);
  };
  const endComparisonDrag = () => { comparisonDragging.current = false; };
  const handleComparisonKeyDown = (event) => {
    const steps = { ArrowLeft: -2, ArrowRight: 2, ArrowUp: 2, ArrowDown: -2 };
    if (event.key in steps) {
      event.preventDefault();
      setComparisonPosition(comparisonPosition.current + steps[event.key]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setComparisonPosition(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setComparisonPosition(100);
    }
  };
  const renderCard = (item) => {
    const type = itemType(item); const thumb = item.thumbnail_url || item.image_url || item.media_url;
    const copy = <span className="gallery-card-copy"><span className="gallery-card-category">{item.category}</span><strong>{item.title}</strong>{item.description && <span className="gallery-card-description">{item.description}</span>}</span>;
    const media = <span className="gallery-card-image">{thumb ? <img src={thumb} alt={item.title} loading="lazy" /> : <span className="gallery-card-placeholder" aria-hidden="true">{type === 'link' ? '↗' : '▶'}</span>}{type === 'video' && <span className="gallery-media-badge play" aria-label="Video">▶</span>}{type === 'link' && <span className="gallery-media-badge link" aria-label="External link">↗</span>}</span>;
    if (type === 'link') {
      const embedUrl = youtubeEmbed(item.external_url || '');
      return <article className="gallery-card gallery-link-card" key={item.id}>{embedUrl ? <button type="button" className="gallery-card-trigger" onClick={() => setActiveId(item.id)} aria-label={`Play ${item.title}`}>{media}{copy}</button> : <a className="gallery-card-trigger" href={item.external_url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.title} in a new tab`}>{media}{copy}<span className="gallery-external-action">Open link ↗</span></a>}</article>;
    }
    return <button className="gallery-card" key={item.id} type="button" onClick={() => setActiveId(item.id)} aria-label={`${type === 'video' ? 'Play' : 'View'} ${item.title}`}>{media}{copy}</button>;
  };
  return <section className="section gallery-page" aria-labelledby="gallery-title">
    <header className="gallery-heading"><p className="eyebrow">A CLOSER LOOK</p><h1 id="gallery-title">The gallery.</h1><p className="lede">Objects, materials, and details from the National Handicrafts collection.</p></header>
    <section className="gallery-comparison" aria-labelledby="gallery-comparison-title">
      <header className="gallery-comparison-heading">
        <h2 id="gallery-comparison-title">See the Transformation</h2>
        <p>Discover how our handcrafted products transform your sacred space.</p>
      </header>
      <div
        className="gallery-comparison-slider"
        ref={comparisonRef}
        role="slider"
        tabIndex={0}
        aria-label="Before and after comparison"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={50}
        aria-valuetext={`${Math.round(comparisonPosition.current)}% after image visible`}
        onPointerDown={startComparisonDrag}
        onPointerMove={moveComparisonDrag}
        onPointerUp={endComparisonDrag}
        onPointerCancel={endComparisonDrag}
        onLostPointerCapture={endComparisonDrag}
        onKeyDown={handleComparisonKeyDown}
      >
        <img className="gallery-comparison-before" src="/assets/gallery/mandir-before.webp" alt="Sacred mandir space before its National transformation" width="1536" height="1024" draggable="false" />
        <div className="gallery-comparison-after-clip" aria-hidden="true">
          <img src="/assets/gallery/mandir-after.webp" alt="" width="1536" height="1024" draggable="false" />
        </div>
        <span className="gallery-comparison-label before">Before</span>
        <span className="gallery-comparison-label after">After</span>
        <span className="gallery-comparison-divider" aria-hidden="true">
          <span className="gallery-comparison-handle"><span>‹</span><span>›</span></span>
        </span>
      </div>
    </section>
    <div className="gallery-filter-tabs" role="tablist" aria-label="Filter gallery media">{filters.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => { setFilter(value); close(); }}>{label}</button>)}</div>
    {state === 'loading' && <div className="gallery-message" role="status">Gathering the collection…</div>}
    {state === 'error' && <div className="gallery-empty" role="alert"><p>The gallery could not be loaded just now.</p><button type="button" className="button secondary" onClick={loadGallery}>Try again</button></div>}
    {state === 'ready' && (!items.length || !visibleItems.length) && <div className="gallery-empty"><span className="gallery-empty-mark" aria-hidden="true">✳</span><h2>{items.length ? 'Nothing here just yet.' : 'New stories are taking shape.'}</h2><p>{items.length ? 'Choose another media filter to explore the collection.' : 'Published photos, videos and links from the collection will appear here.'}</p></div>}
    {state === 'ready' && visibleItems.length > 0 && <div className="gallery-grid">{visibleItems.map(renderCard)}</div>}
    {active && <div className="gallery-lightbox" role="presentation" onMouseDown={closeOnBackdrop}><section className="gallery-lightbox-dialog" role="dialog" aria-modal="true" aria-label={active.title}><button type="button" className="gallery-lightbox-close" aria-label="Close media viewer" onClick={close}>×</button>
      {itemType(active) === 'photo' && <><figure><img src={active.media_url || active.image_url} alt={active.title} /><figcaption><span>{active.category}</span><strong>{active.title}</strong>{active.description && <p>{active.description}</p>}</figcaption></figure>{photoItems.length > 1 && <><button type="button" className="gallery-lightbox-arrow previous" aria-label="Previous photo" onClick={() => movePhoto(-1)}>‹</button><button type="button" className="gallery-lightbox-arrow next" aria-label="Next photo" onClick={() => movePhoto(1)}>›</button></>}</>}
      {itemType(active) === 'video' && <div className="gallery-media-viewer"><video src={active.media_url || active.image_url} controls autoPlay playsInline poster={active.thumbnail_url || active.image_url} /><div><span>{active.category}</span><strong>{active.title}</strong>{active.description && <p>{active.description}</p>}</div></div>}
      {itemType(active) === 'link' && youtubeEmbed(active.external_url || '') && <div className="gallery-media-viewer"><iframe src={youtubeEmbed(active.external_url)} title={active.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /><div><span>{active.category}</span><strong>{active.title}</strong>{active.description && <p>{active.description}</p>}<a href={active.external_url} target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a></div></div>}
    </section></div>}
  </section>;
}
