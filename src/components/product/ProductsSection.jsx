import { useState } from 'react';
import { CATEGORIES } from '../../constants/catalogue.js';
import ProductCard from './ProductCard.jsx';
import { ErrorState, LoadingState } from '../common/StatusState.jsx';

export default function ProductsSection({ products, refresh, openProduct, addToCart, buyNow, catalogueState, catalogueError, searchQuery, setSearchQuery }) {
  const [category, setCategory] = useState('');
  const filtered = products.filter((product) => (!category || product.category === category) && (!searchQuery || `${product.name} ${product.category}`.toLowerCase().includes(searchQuery.toLowerCase())));

  return <section className="section products-page"><div className="page-heading"><div><p className="eyebrow">THE CATALOGUE</p><h1>Find a piece with presence.</h1></div><p>Only active, verified products appear in this customer-facing collection.</p></div><div className="toolbar"><input aria-label="Search products" placeholder="Search products" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /><select aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select><button className="text-button" onClick={refresh}>Refresh</button></div>{catalogueState === 'loading' ? <LoadingState /> : catalogueState === 'error' ? <ErrorState onRetry={refresh} message={catalogueError} /> : filtered.length ? <div className="product-grid">{filtered.map((product) => <ProductCard key={product.id} product={product} openProduct={openProduct} addToCart={addToCart} buyNow={buyNow} />)}</div> : <div className="verified-empty"><p>No matching verified products.</p><span>Product records added and verified in the admin portal appear here automatically.</span></div>}</section>;
}
