import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES } from '../../constants/catalogue.js';
import { api } from '../../services/api.js';
import ProductCard from './ProductCard.jsx';
import { ErrorState } from '../common/StatusState.jsx';
import { filterAndSortProducts } from '../../services/catalogueFilters.js';

const defaultFilters = { category: '', minPrice: '', maxPrice: '', availability: 'all', sort: 'featured' };

export function ShopBannerCarousel() {
  const [banners, setBanners] = useState([]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api('/shop-banners', { signal: controller.signal }).then((response) => {
      setBanners(Array.isArray(response?.data) ? response.data : []);
    }).catch(() => { if (!controller.signal.aborted) setBanners([]); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (banners.length < 2) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % banners.length), 5600);
    return () => window.clearInterval(timer);
  }, [banners.length]);
  useEffect(() => {
    document.querySelectorAll('.shop-banner-slide video').forEach((video, slideIndex) => {
      if (slideIndex === index) video.play().catch(() => {});
      else video.pause();
    });
  }, [index, banners]);
  useEffect(() => { if (index >= banners.length) setIndex(0); }, [banners.length, index]);
  if (!banners.length) return null;
  const move = (step) => setIndex((current) => (current + step + banners.length) % banners.length);
  return <div className="shop-banner-wrap"><section className="shop-banner" aria-label="Shop promotions" aria-roledescription={banners.length > 1 ? 'carousel' : undefined}>
    <div className="shop-banner-track" style={{ transform: `translateX(-${index * 100}%)` }}>
      {banners.map((banner, slideIndex) => {
        const content = banner.media_type === 'video'
          ? <video src={banner.media_url} muted playsInline loop autoPlay={slideIndex === index} preload={slideIndex === index ? 'metadata' : 'none'} aria-label={banner.title || 'Shop promotion'} />
          : <img src={banner.media_url} alt={banner.title || 'Shop promotion'} loading={slideIndex === 0 ? 'eager' : 'lazy'} />;
        return <div className="shop-banner-slide" key={banner.id} aria-hidden={slideIndex !== index}>
          {banner.link_url ? <a className="shop-banner-media" href={banner.link_url} aria-label={banner.title || 'View promotion'} tabIndex={slideIndex === index ? 0 : -1}>{content}</a> : <div className="shop-banner-media">{content}</div>}
          {banner.title && <div className="shop-banner-caption"><span>{banner.title}</span>{banner.link_url && <span aria-hidden="true">Explore →</span>}</div>}
        </div>;
      })}
    </div>
    {banners.length > 1 && <>
      <button type="button" className="shop-banner-arrow previous" aria-label="Previous promotion" onClick={() => move(-1)}>‹</button>
      <button type="button" className="shop-banner-arrow next" aria-label="Next promotion" onClick={() => move(1)}>›</button>
      <div className="shop-banner-dots" role="group" aria-label="Choose promotion">{banners.map((banner, dotIndex) => <button key={banner.id} type="button" aria-label={`Show promotion ${dotIndex + 1}`} aria-current={dotIndex === index ? 'true' : undefined} className={dotIndex === index ? 'active' : ''} onClick={() => setIndex(dotIndex)} />)}</div>
    </>}
  </section></div>;
}

function CatalogueSkeleton() {
  return <div className="product-grid catalogue-skeleton" role="status" aria-label="Loading products">
    {Array.from({ length: 4 }, (_, index) => <article className="product-card" key={index} aria-hidden="true"><div className="product-image skeleton-block" /><div className="product-meta"><span className="skeleton-line skeleton-short" /><span className="skeleton-line" /><span className="skeleton-line skeleton-price" /></div></article>)}
  </div>;
}

function FilterControls({ values, onChange }) {
  return <>
    <label className="catalogue-filter"><span>Category</span><select aria-label="Filter by category" value={values.category} onChange={(event) => onChange('category', event.target.value)}><option value="">All categories</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="catalogue-filter catalogue-price"><span>Price from</span><input aria-label="Minimum price" type="number" min="0" step="1" inputMode="numeric" placeholder="₹ Min" value={values.minPrice} onChange={(event) => onChange('minPrice', event.target.value)} /></label>
    <label className="catalogue-filter catalogue-price"><span>Price to</span><input aria-label="Maximum price" type="number" min="0" step="1" inputMode="numeric" placeholder="₹ Max" value={values.maxPrice} onChange={(event) => onChange('maxPrice', event.target.value)} /></label>
    <label className="catalogue-filter"><span>Availability</span><select aria-label="Filter by availability" value={values.availability} onChange={(event) => onChange('availability', event.target.value)}><option value="all">All products</option><option value="in-stock">In stock</option></select></label>
    <label className="catalogue-filter"><span>Sort by</span><select aria-label="Sort products" value={values.sort} onChange={(event) => onChange('sort', event.target.value)}><option value="featured">Featured</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="name">Name A–Z</option><option value="newest">Newest</option></select></label>
  </>;
}

export default function ProductsSection({ products, refresh, openProduct, addToCart, buyNow, catalogueState, catalogueError, searchQuery, setSearchQuery, filterOpen, setFilterOpen }) {
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const updateDraftFilter = (key, value) => setDraftFilters((current) => ({ ...current, [key]: value }));
  const clearFilters = () => { setFilters(defaultFilters); setDraftFilters(defaultFilters); };
  const applyFilters = () => { setFilters(draftFilters); setFilterOpen(false); };
  useEffect(() => { if (filterOpen) setDraftFilters(filters); }, [filterOpen]);

  const filtered = useMemo(() => {
    return filterAndSortProducts(products, { ...filters, query: searchQuery });
  }, [filters, products, searchQuery]);

  const activeFilterCount = [filters.category, filters.minPrice, filters.maxPrice, filters.availability !== 'all' ? filters.availability : '', filters.sort !== 'featured' ? filters.sort : ''].filter(Boolean).length;
  const hasCriteria = Boolean(searchQuery.trim() || activeFilterCount);
  const invalidRange = filters.minPrice !== '' && filters.maxPrice !== '' && Number(filters.minPrice) > Number(filters.maxPrice);
  const filterSummary = activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active` : 'All products';

  return <section className="section products-page">
    <div className="catalogue-toolbar" aria-label="Product filters">
      <div className="catalogue-filter-desktop"><FilterControls values={filters} onChange={updateFilter} /><button className="catalogue-clear" type="button" onClick={clearFilters} disabled={!activeFilterCount}>Clear all</button></div>
      {filterOpen && <div className="filter-drawer" role="dialog" aria-modal="true" aria-label="Filter and sort products"><div className="filter-drawer-heading"><strong>Filter &amp; Sort</strong><button type="button" onClick={() => setFilterOpen(false)} aria-label="Close filters">×</button></div><div className="catalogue-filter-mobile"><FilterControls values={draftFilters} onChange={updateDraftFilter} /></div><div className="filter-drawer-actions"><button className="button secondary" type="button" onClick={clearFilters}>Clear all</button><button className="button primary" type="button" onClick={applyFilters}>Apply filters</button></div></div>}
    </div>
    <div className="catalogue-results-bar"><p>{catalogueState === 'loading' ? 'Loading verified products…' : catalogueState === 'error' ? 'Catalogue temporarily unavailable' : invalidRange ? 'Choose a maximum price greater than the minimum.' : `Showing ${filtered.length} product${filtered.length === 1 ? '' : 's'}`}</p><span>{filterSummary}{searchQuery.trim() ? ` · “${searchQuery.trim()}”` : ''}</span></div>
    {catalogueState === 'loading' ? <CatalogueSkeleton /> : catalogueState === 'error' ? <ErrorState onRetry={refresh} message={catalogueError} /> : filtered.length ? <div className="product-grid">{filtered.map((product) => <ProductCard key={product.id} product={product} openProduct={openProduct} addToCart={addToCart} buyNow={buyNow} />)}</div> : <div className="verified-empty"><p>{hasCriteria ? 'No products match those choices.' : 'No matching verified products.'}</p><span>{hasCriteria ? 'Try clearing a filter or searching for another product.' : 'Product records added and verified in the admin portal appear here automatically.'}</span>{hasCriteria && <button className="text-button" type="button" onClick={() => { setSearchQuery(''); clearFilters(); }}>Clear search and filters</button>}</div>}
  </section>;
}
