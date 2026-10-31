import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import './styles.css';
import SafeImage from './components/common/SafeImage.jsx';
import ProductsSection, { ShopBannerCarousel } from './components/product/ProductsSection.jsx';
import CatalogueProductCard from './components/product/ProductCard.jsx';
import ScrollToTop from './ScrollToTop.jsx';
import { CATEGORIES as categories, CATEGORY_IMAGES as categoryImages } from './constants/catalogue.js';
import { api, authenticateAccount, formatPrice, imageUrl } from './services/api.js';
import { animateProductToCart } from './services/cartAnimation.js';
import { resolveProfileDestination } from './services/profileSession.js';
import { productPurchaseState } from '../shared/productAvailability.js';

const AdminPortal = lazy(() => import('./admin.jsx'));

function ProtectedCheckout({ setPage, setSkipNextCustomerSessionCheck, sessionVerified = false, ...props }) { const [state, setState] = useState(sessionVerified ? 'ready' : 'loading'); useEffect(() => { if (sessionVerified) { setState('ready'); return undefined; } let active = true; api('/customer/auth/me').then(() => { if (active) setState('ready'); }).catch(() => { if (!active) return; setSkipNextCustomerSessionCheck(true); sessionStorage.setItem('nh_return_to_checkout', '1'); setPage('profile'); }); return () => { active = false; }; }, [sessionVerified]); if (state !== 'ready') return <section className="section checkout-page"><LoadingState label="Checking your account…" /></section>; return <Checkout setPage={setPage} {...props} />; }

const CART_STORAGE_KEY = 'national-handicrafts-cart';
const cartItemKey = (item) => `${item.id}:${item.variantId || 'default'}`;

function useCart() {
  const [cart, setCart] = useState(() => { try { const saved = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]'); return Array.isArray(saved) ? saved : []; } catch { return []; } });
  useEffect(() => { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart)); }, [cart]);
  const addToCart = (product) => setCart((current) => {
    const key = cartItemKey(product);
    const existing = current.find((item) => cartItemKey(item) === key);
    const nextQuantity = (existing?.quantity || 0) + 1;
    if (product.stock !== null && product.stock !== undefined && nextQuantity > product.stock) return current;
    const snapshot = { id: product.id, name: product.name, category: product.category, price_inr: product.price_inr, stock: product.stock, availability: product.availability, image_path: product.image_path || null, variantId: product.variantId || null, variant: product.variant ? { ...product.variant, availability: product.variant.availability || product.availability, source_review_status: product.variant.source_review_status || 'verified' } : null };
    return existing ? current.map((item) => cartItemKey(item) === key ? { ...item, ...snapshot, quantity: nextQuantity } : item) : [...current, { ...snapshot, quantity: 1 }];
  });
  const setQuantity = (id, change) => setCart((current) => current.map((item) => {
    if (cartItemKey(item) !== id) return item;
    if (item.stock === 0) return item;
    const requested = Math.max(1, item.quantity + Math.trunc(Number(change) || 0));
    return { ...item, quantity: item.stock == null ? requested : Math.min(requested, item.stock) };
  }));
  const removeFromCart = (id) => setCart((current) => current.filter((item) => cartItemKey(item) !== id));
  const clearCart = () => setCart([]);
  const reconcile = (products) => setCart((current) => { const byId = new Map(products.map((product) => [product.id, product])); return current.map((item) => { const product = byId.get(item.id); if (!product) return null; const variant = item.variantId ? product.variants?.find((entry) => entry.id === item.variantId) : null; if (item.variantId && !variant) return null; const stock = variant ? variant.stock : product.stock; const quantity = stock == null ? item.quantity : Math.min(item.quantity, stock); if (item.variantId && (!variant || variant.source_review_status !== 'verified')) return null; return { ...item, ...product, price_inr: variant ? variant.price_inr : product.price_inr, stock, variantId: variant?.id || null, availability: variant?.availability || product.availability, variant: variant ? { id: variant.id, name: variant.name, size: variant.size, weight: variant.weight, weightUnit: variant.weight_unit, dimensions: variant.dimensions, capacity: variant.capacity, capacityUnit: variant.capacity_unit, sku: variant.sku, availability: variant.availability, source_review_status: variant.source_review_status } : null, quantity }; }).filter((item) => item && item.quantity > 0); });
  return { cart, addToCart, setQuantity, removeFromCart, clearCart, reconcile };
}

function App() {
  const params = new URLSearchParams(location.search);
  const initialSection = ['about', 'products'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
  const [page, setPage] = useState(location.pathname === '/profile' ? 'profile' : location.pathname === '/admin' || params.get('admin') === '1' ? 'admin' : params.get('product') ? 'detail' : ['password-reset', 'password-recovery'].includes(params.get('page')) ? 'password-recovery' : params.get('page') || initialSection);
  const [navigationKey, setNavigationKey] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState(params.get('product'));
  const [checkoutItems, setCheckoutItems] = useState([]);
  const [checkoutFromCart, setCheckoutFromCart] = useState(false);
  const [skipNextCustomerSessionCheck, setSkipNextCustomerSessionCheck] = useState(false);
  const [checkoutSessionVerified, setCheckoutSessionVerified] = useState(false);
  const [products, setProducts] = useState([]);
  const [catalogueState, setCatalogueState] = useState('loading');
  const [catalogueError, setCatalogueError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [catalogueFiltersOpen, setCatalogueFiltersOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [profileEntry, setProfileEntry] = useState(null);
  const [verifiedAdminEntry, setVerifiedAdminEntry] = useState(null);
  const [profileNavigationBusy, setProfileNavigationBusy] = useState(false);
  const [profileNavigationError, setProfileNavigationError] = useState('');
  const profileNavigationInFlight = useRef(false);
  const { cart, addToCart: addCartItem, setQuantity, removeFromCart, clearCart, reconcile } = useCart();
  const addToCart = (product, trigger) => {
    if (!productPurchaseState(product, product.variant).canPurchase) return false;
    const existingQuantity = cart.find((item) => cartItemKey(item) === cartItemKey(product))?.quantity || 0;
    const exceedsStock = product.stock !== null && product.stock !== undefined && existingQuantity + 1 > product.stock;
    addCartItem(product);
    if (!exceedsStock) animateProductToCart(trigger);
  };
  const refresh = () => { setCatalogueState('loading'); setCatalogueError(''); return api('/products').then((r) => { const nextProducts = Array.isArray(r?.data) ? r.data : []; setProducts(nextProducts); reconcile(nextProducts); setCatalogueState('ready'); return nextProducts; }).catch((error) => { setCatalogueState('error'); setCatalogueError(error.message); setProducts([]); }); };
  useEffect(() => { refresh(); const onPopState = () => { const nextParams = new URLSearchParams(location.search); const nextPage = location.pathname === '/profile' ? 'profile' : location.pathname === '/admin' || nextParams.get('admin') === '1' ? 'admin' : nextParams.get('product') ? 'detail' : ['password-reset', 'password-recovery'].includes(nextParams.get('page')) ? 'password-recovery' : nextParams.get('page') || (['about', 'products'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home'); setSelectedProductId(nextParams.get('product')); setPage(nextPage); setNavigationKey((key) => key + 1); }; addEventListener('popstate', onPopState); return () => removeEventListener('popstate', onPopState); }, []);
  // The splash is brand polish, not an API gate: data may still be loading underneath it.
  useEffect(() => { const timer = setTimeout(() => setShowSplash(false), 700); return () => clearTimeout(timer); }, []);
  useEffect(() => { if (catalogueState !== 'loading') setShowSplash(false); }, [catalogueState]);
  const navigate = (nextPage) => { const landingPage = ['home', 'products'].includes(nextPage); setPage(nextPage); setNavigationKey((key) => key + 1); if (nextPage !== 'detail') setSelectedProductId(null); if (nextPage !== 'profile') setProfileEntry(null); if (nextPage !== 'admin') setVerifiedAdminEntry(null); if (landingPage) history.pushState({}, '', nextPage === 'home' ? location.pathname : `${location.pathname}#${nextPage}`); else if (nextPage === 'profile') history.pushState({}, '', '/profile'); else if (nextPage === 'admin') history.pushState({}, '', '/admin'); else if (['about', 'contact', 'cart'].includes(nextPage)) history.pushState({}, '', `${location.pathname}?page=${nextPage}`); };
  const openProfile = async () => {
    if (profileNavigationInFlight.current) return;
    profileNavigationInFlight.current = true;
    setProfileNavigationBusy(true);
    setProfileNavigationError('');
    try {
      const destination = await resolveProfileDestination(api);
      if (destination.page === 'admin') {
        if (page !== 'admin') {
          setVerifiedAdminEntry(destination.profile);
          navigate('admin');
        }
        return;
      }
      setProfileEntry({ checked: true, profile: destination.profile });
      navigate('profile');
    } catch (error) {
      setProfileNavigationError(error.message || 'Your account session could not be checked. Please try again.');
    } finally {
      profileNavigationInFlight.current = false;
      setProfileNavigationBusy(false);
    }
  };
  const openProduct = (id) => { setSelectedProductId(id); setPage('detail'); history.pushState({}, '', `${location.pathname}?product=${encodeURIComponent(id)}`); };
  const requireCheckout = async (items, { fromCart = false } = {}) => { setCheckoutItems(items); setCheckoutFromCart(fromCart); try { await api('/customer/auth/me'); setCheckoutSessionVerified(true); navigate('checkout'); } catch { setCheckoutSessionVerified(false); setSkipNextCustomerSessionCheck(true); setProfileEntry(null); sessionStorage.setItem('nh_return_to_checkout', '1'); navigate('profile'); } };
  const buyNow = (product) => requireCheckout([{ id: product.id, name: product.name, category: product.category, price_inr: product.price_inr, stock: product.stock, image_path: product.image_path || null, variantId: product.variantId || null, variant: product.variant || null, quantity: 1 }]);
  const checkoutCart = () => { const unavailable = cart.find((item) => !productPurchaseState(item, item.variant).canPurchase); if (unavailable) { window.alert(`${unavailable.name} is no longer available to purchase. Remove it or choose another option.`); return; } return requireCheckout(cart, { fromCart: true }); };
  const openCatalogueFilters = () => { if (page !== 'products') navigate('products'); setCatalogueFiltersOpen(true); };
  return <><ScrollToTop page={page} pathname={location.pathname} navigationKey={navigationKey} />{showSplash && <LoadingScreen />}<SiteNavigationV2 page={page} setPage={navigate} cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)} searchQuery={searchQuery} setSearchQuery={setSearchQuery} onProfileClick={openProfile} profileNavigationBusy={profileNavigationBusy} profileNavigationError={profileNavigationError} />{page === 'products' && <div className="shop-banner-wrap"><ShopBannerCarousel /></div>}<main>
    {page === 'home' && <LandingHero setPage={navigate} />}
    {['home', 'products'].includes(page) && <div id="products" className="scroll-section"><ProductsSection products={products} refresh={refresh} openProduct={openProduct} addToCart={addToCart} buyNow={buyNow} catalogueState={catalogueState} catalogueError={catalogueError} searchQuery={searchQuery} setSearchQuery={setSearchQuery} filterOpen={catalogueFiltersOpen} setFilterOpen={setCatalogueFiltersOpen} /></div>}
    {page === 'about' && <div id="about" className="scroll-section"><About /></div>}
    {page === 'detail' && <ProductDetailV2 id={selectedProductId} setPage={navigate} addToCart={addToCart} buyNow={buyNow} />}
    {page === 'contact' && <Contact />}
    {page === 'profile' && <CustomerProfile key={navigationKey} setPage={navigate} skipInitialSessionCheck={skipNextCustomerSessionCheck} clearSkipInitialSessionCheck={() => setSkipNextCustomerSessionCheck(false)} profileEntry={profileEntry} />}
    {page === 'password-recovery' && <PasswordRecovery setPage={navigate} />}
    {page === 'cart' && <Cart setPage={navigate} onCheckout={checkoutCart} cart={cart} setQuantity={setQuantity} removeFromCart={removeFromCart} clearCart={clearCart} />}
    {page === 'checkout' && <ProtectedCheckout setPage={navigate} setSkipNextCustomerSessionCheck={setSkipNextCustomerSessionCheck} sessionVerified={checkoutSessionVerified} items={checkoutItems} clearCart={clearCart} isCart={checkoutFromCart} />}
    {page === 'admin' && <Suspense fallback={<section className="section admin-page"><LoadingState label="Loading the admin portal…" /></section>}><AdminPortal refresh={refresh} verifiedAdminEntry={verifiedAdminEntry} onAdminSessionEntryConsumed={() => setVerifiedAdminEntry(null)} /></Suspense>}
  </main><Footer setPage={navigate} /><MobileBottomNavigation page={page} onNavigate={navigate} onOpenFilters={openCatalogueFilters} onAccountClick={openProfile} profileNavigationBusy={profileNavigationBusy} cartCount={cart.reduce((sum, item) => sum + item.quantity, 0)} filtersOpen={catalogueFiltersOpen} /> </>;
}

function MobileBottomNavigation({ page, onNavigate, onOpenFilters, onAccountClick, profileNavigationBusy, cartCount, filtersOpen }) {
  const accountActive = page === 'profile' || page === 'admin';
  return <nav className={`mobile-bottom-navigation${page === 'products' ? ' filters-visible' : ''}`} aria-label="Mobile navigation">
    <button type="button" className={page === 'home' ? 'active' : ''} aria-current={page === 'home' ? 'page' : undefined} onClick={() => onNavigate('home')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" /></svg><span>Home</span>
    </button>
    {page === 'products' && <button type="button" aria-expanded={filtersOpen} aria-label="Open filters" onClick={onOpenFilters}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10m-7 6h4" /><circle cx="8" cy="6" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="11" cy="18" r="1.5" /></svg><span>Filters</span>
    </button>}
    <button type="button" className={page === 'cart' ? 'active' : ''} aria-current={page === 'cart' ? 'page' : undefined} aria-label={`Cart${cartCount ? `, ${cartCount} items` : ''}`} onClick={() => onNavigate('cart')}>
      <span className="mobile-bottom-cart-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8.5h14l-1 12H6l-1-12Z" /><path d="M9 9V7a3 3 0 0 1 6 0v2" /></svg>{cartCount > 0 && <span className="mobile-bottom-cart-count">{cartCount}</span>}</span><span>Cart</span>
    </button>
    <button type="button" className={accountActive ? 'active' : ''} aria-current={accountActive ? 'page' : undefined} aria-label={profileNavigationBusy ? 'Checking account session' : 'Account'} disabled={profileNavigationBusy} onClick={onAccountClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c.8-3.4 3.1-5.1 6.5-5.1s5.7 1.7 6.5 5.1" /></svg><span>Account</span>
    </button>
  </nav>;
}

 function Header({ page, setPage, cartCount }) { const [open, setOpen] = useState(false); const go = (nextPage) => { setPage(nextPage); setOpen(false); }; return <header className="site-header"><button className="brand" onClick={() => go('home')}><SafeImage src="/assets/heritage-emblem.png" alt="National Handicrafts emblem" /><span><b>National</b><small>Handicrafts Bengaluru</small></span></button><button className="menu-toggle" onClick={() => setOpen(!open)} aria-expanded={open}><span>{open ? 'Close' : 'Menu'}</span><i aria-hidden="true">{open ? '×' : 'Menu'}</i></button><nav className={open ? 'open' : ''} aria-label="Primary navigation">{[['home', 'Home'], ['about', 'About'], ['products', 'Products'], ['contact', 'Contact']].map(([id, label]) => <button className={page === id ? 'active' : ''} key={id} onClick={() => go(id)}>{label}</button>)}<button className={page === 'cart' ? 'active cart-link' : 'cart-link'} onClick={() => go('cart')}>Cart{cartCount > 0 && <span>{cartCount}</span>}</button></nav></header>; }
function HeaderWithIcons({ page, setPage, cartCount }) { const [open, setOpen] = useState(false); const [searchOpen, setSearchOpen] = useState(false); const [query, setQuery] = useState(''); const go = (nextPage) => { setPage(nextPage); setOpen(false); }; const submitSearch = (event) => { event.preventDefault(); const input = document.querySelector('.products-page .toolbar input'); if (input) { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; setter?.call(input, query); input.dispatchEvent(new Event('input', { bubbles: true })); } go('products'); setSearchOpen(false); }; return <header className="site-header"><button className="brand" onClick={() => go('home')}><SafeImage src="/assets/heritage-emblem.png" alt="National Handicrafts emblem" /><span><b>National</b><small>Handicrafts Bengaluru</small></span></button><button className="menu-toggle" onClick={() => setOpen(!open)} aria-expanded={open}><span>{open ? 'Close' : 'Menu'}</span><i aria-hidden="true">{open ? '×' : 'Menu'}</i></button><nav className={open ? 'open' : ''} aria-label="Primary navigation">{[['home', 'Home'], ['about', 'About'], ['products', 'Products'], ['contact', 'Contact']].map(([id, label]) => <button className={page === id ? 'active' : ''} key={id} onClick={() => go(id)}>{label}</button>)}</nav><div className="header-actions"><button className="nav-icon-button" aria-label="Search products" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></svg></button><button className={page === 'cart' ? 'nav-icon-button cart-icon active' : 'nav-icon-button cart-icon'} aria-label={`Shopping bag${cartCount > 0 ? `, ${cartCount} items` : ''}`} onClick={() => go('cart')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8.5h14l-1 12H6l-1-12Z" /><path d="M9 9V7a3 3 0 0 1 6 0v2" /></svg>{cartCount > 0 && <span>{cartCount}</span>}</button></div>{searchOpen && <form className="header-search" onSubmit={submitSearch} role="search"><label htmlFor="header-product-search">Search products</label><input id="header-product-search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the catalogue" /><button className="button primary" type="submit">Search</button></form>}</header>; }
function SiteNavigation({ page, setPage, cartCount, searchQuery, setSearchQuery }) {
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const go = (nextPage) => { setPage(nextPage); setOpen(false); setSearchOpen(false); };
  const submitSearch = (event) => { event.preventDefault(); setSearchQuery(event.currentTarget.elements.search.value); setPage('products'); setOpen(false); setSearchOpen(false); };
  return <header className="site-header"><button className="brand" onClick={() => go('home')}><SafeImage src="/assets/heritage-emblem.png" alt="National Handicrafts emblem" /><span><b>National</b><small>Handicrafts Bengaluru</small></span></button><button className="menu-toggle" onClick={() => setOpen(!open)} aria-expanded={open}><span>{open ? 'Close' : 'Menu'}</span><i aria-hidden="true">{open ? '×' : 'Menu'}</i></button><nav className={open ? 'open' : ''} aria-label="Primary navigation">{[['home', 'Home'], ['products', 'Products'], ['about', 'About'], ['contact', 'Contact']].map(([id, label]) => <button className={page === id ? 'active' : ''} key={id} onClick={() => go(id)}>{label}</button>)}</nav><div className="header-actions"><button className="nav-icon-button" aria-label="Search products" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></svg></button><button className={page === 'cart' ? 'nav-icon-button cart-icon active' : 'nav-icon-button cart-icon'} aria-label={`Shopping bag${cartCount > 0 ? `, ${cartCount} items` : ''}`} onClick={() => go('cart')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8.5h14l-1 12H6l-1-12Z" /><path d="M9 9V7a3 3 0 0 1 6 0v2" /></svg>{cartCount > 0 && <span>{cartCount}</span>}</button></div>{searchOpen && <form className="header-search" onSubmit={submitSearch} role="search"><label htmlFor="header-product-search">Search products</label><input id="header-product-search" name="search" autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search the catalogue" /><button className="button primary" type="submit">Search</button><button className="header-search-close" type="button" aria-label="Close search" onClick={() => setSearchOpen(false)}>×</button></form>}</header>;
}
function SiteNavigationV2({ page, setPage, cartCount, searchQuery, setSearchQuery, onProfileClick, profileNavigationBusy, profileNavigationError }) {
  const [open, setOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState('menu');
  const go = (nextPage) => { setPage(nextPage); setOpen(false); setDrawerTab('menu'); };
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); };
  }, [open]);
  const submitSearch = (event) => { event.preventDefault(); setPage('products'); setOpen(false); };
  const closeDrawer = () => { setOpen(false); setDrawerTab('menu'); };
  return <>
    <header className="site-header">
      {open && <button className="mobile-drawer-backdrop" type="button" aria-label="Close navigation menu" onClick={closeDrawer} />}
      <button className="menu-toggle" type="button" onClick={() => { if (open) closeDrawer(); else { setDrawerTab('menu'); setOpen(true); } }} aria-label={open ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={open} aria-controls="primary-navigation"><i aria-hidden="true">{open ? '×' : <><span /><span /><span /></>}</i></button>
      <button className="brand" type="button" onClick={() => go('home')}><SafeImage src="/assets/heritage-emblem.png" alt="National Handicrafts emblem" /><span><b>National Handicrafts</b><small>Bengaluru</small></span></button>
      <form className="header-search" onSubmit={submitSearch} role="search"><label htmlFor="header-product-search">Search the catalogue</label><span className="header-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></svg></span><input id="header-product-search" name="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search for products, categories and more" /><button className="header-search-submit" type="submit" aria-label="Search catalogue"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></svg></button>{searchQuery && <button className="header-search-clear" type="button" aria-label="Clear search" onClick={() => setSearchQuery('')}>×</button>}</form>
      <nav id="primary-navigation" className={open ? 'open' : ''} aria-label="Primary navigation">
        <div className="premium-drawer">
          <div className="drawer-top">
            <img src="/assets/heritage-emblem.png" alt="" />
            <span className="drawer-brand-name"><strong>National Handicrafts</strong><small>Bengaluru</small></span>
            <button type="button" className="drawer-close" aria-label="Close navigation menu" onClick={closeDrawer}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
          </div>
          <div className="drawer-account"><button type="button" onClick={() => { closeDrawer(); onProfileClick(); }} disabled={profileNavigationBusy}><span className="drawer-account-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c.8-3.4 3.1-5.1 6.5-5.1s5.7 1.7 6.5 5.1" /></svg></span><span className="drawer-account-copy"><strong>{profileNavigationBusy ? 'Checking account…' : page === 'admin' ? 'Admin portal' : page === 'profile' ? 'My account' : 'Login / Signup'}</strong><small>{page === 'admin' ? 'Manage your catalogue' : page === 'profile' ? 'View your account' : 'Access your orders, wishlist and more'}</small></span><span className="drawer-account-chevron" aria-hidden="true">›</span></button></div>
          <div key={drawerTab} className={`drawer-view drawer-view-${drawerTab}`}>
            {drawerTab === 'menu' ? <div className="drawer-links">
              <button className={page === 'home' ? 'active' : ''} onClick={() => go('home')}><span className="drawer-link-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m3.5 10 8.5-7 8.5 7v10.5h-6v-6h-5v6h-6V10Z" /></svg></span><span>Home</span></button>
              <button className={page === 'products' ? 'active' : ''} onClick={() => go('products')}><span className="drawer-link-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8h16l-1.2 12H5.2L4 8Z" /><path d="M9 9V6.5a3 3 0 0 1 6 0V9" /></svg></span><span>Shop</span></button>
              <button type="button" className="drawer-mobile-categories" onClick={() => setDrawerTab('categories')}><span className="drawer-link-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" /><rect x="13.5" y="3.5" width="7" height="7" /><rect x="3.5" y="13.5" width="7" height="7" /><rect x="13.5" y="13.5" width="7" height="7" /></svg></span><span>Categories</span><svg className="drawer-row-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>
              <button className={page === 'about' ? 'active' : ''} onClick={() => go('about')}><span className="drawer-link-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg></span><span>About Us</span></button>
              <button className={page === 'contact' ? 'active' : ''} onClick={() => go('contact')}><span className="drawer-link-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1.5" /><path d="m4 7 8 6 8-6" /></svg></span><span>Contact</span></button>
            </div> : <div className="drawer-category-links"><button type="button" className="drawer-category-back" onClick={() => setDrawerTab('menu')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg><span>Back to menu</span></button><h2>Shop by category</h2>{categories.map((category) => <button key={category} onClick={() => { setSearchQuery(category); go('products'); }}>{category}<svg className="drawer-row-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button>)}</div>}
          </div>
          <div className="drawer-ornament" aria-hidden="true"><img src="/assets/elephant-design.png" alt="" /></div>
        </div>
        <div className="drawer-heading"><span>Explore</span><button type="button" aria-label="Close navigation menu" onClick={closeDrawer}>×</button></div>
        <div className="drawer-account"><button type="button" onClick={() => { closeDrawer(); onProfileClick(); }} disabled={profileNavigationBusy}><span className="drawer-account-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c.8-3.4 3.1-5.1 6.5-5.1s5.7 1.7 6.5 5.1" /></svg></span><span><strong>{profileNavigationBusy ? 'Checking account…' : page === 'admin' ? 'Admin portal' : page === 'profile' ? 'My account' : 'Login/Signup'}</strong><small>{page === 'admin' ? 'Manage your catalogue' : page === 'profile' ? 'View your account' : 'Sign in or create an account'}</small></span><span className="drawer-account-chevron" aria-hidden="true">›</span></button></div>
        <div className="drawer-tabs" role="tablist" aria-label="Navigation drawer sections"><button type="button" role="tab" id="drawer-menu-tab" aria-selected={drawerTab === 'menu'} className={drawerTab === 'menu' ? 'active' : ''} onClick={() => setDrawerTab('menu')}>Menu</button><button type="button" role="tab" id="drawer-categories-tab" aria-selected={drawerTab === 'categories'} className={drawerTab === 'categories' ? 'active' : ''} onClick={() => setDrawerTab('categories')}>Categories</button></div>
        {drawerTab === 'menu' ? <div className="drawer-links" role="tabpanel" aria-labelledby="drawer-menu-tab"><button className={page === 'home' ? 'active' : ''} onClick={() => go('home')}>Home</button><button className={page === 'products' ? 'active' : ''} onClick={() => go('products')}>Shop</button><button className="drawer-mobile-categories" type="button" onClick={() => setDrawerTab('categories')}>Categories</button><button className={page === 'about' ? 'active' : ''} onClick={() => go('about')}>About Us</button><button className={page === 'contact' ? 'active' : ''} onClick={() => go('contact')}>Contact</button></div> : <div className="drawer-category-links" role="tabpanel" aria-labelledby="drawer-categories-tab">{categories.map((category) => <button key={category} onClick={() => { setSearchQuery(category); go('products'); }}>{category}</button>)}</div>}
      </nav>
      <div className="header-actions"><button data-cart-target className={page === 'cart' ? 'nav-icon-button cart-icon active' : 'nav-icon-button cart-icon'} aria-label={`Shopping bag${cartCount > 0 ? `, ${cartCount} items` : ''}`} onClick={() => go('cart')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8.5h14l-1 12H6l-1-12Z" /><path d="M9 9V7a3 3 0 0 1 6 0v2" /></svg>{cartCount > 0 && <span data-cart-count>{cartCount}</span>}</button><button className={page === 'profile' || page === 'admin' ? 'nav-icon-button profile-icon active' : 'nav-icon-button profile-icon'} aria-label={profileNavigationBusy ? 'Checking account session' : 'Your profile'} disabled={profileNavigationBusy} aria-busy={profileNavigationBusy} onClick={onProfileClick}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 20c.8-3.4 3.1-5.1 6.5-5.1s5.7 1.7 6.5 5.1" /></svg></button></div>
      {profileNavigationError && <p className="profile-navigation-error" role="alert">{profileNavigationError}</p>}
    </header>
  </>;
}function LoadingState({ label = 'Loading the catalogue…' }) { return <div className="status-state" role="status"><p>{label}</p></div>; }
function LoadingScreen() { return <div className="app-loading-screen" role="status" aria-live="polite"><div className="app-loading-inner"><img src="/assets/heritage-emblem.png" alt="National Handicrafts Bengaluru" /><p className="app-loading-brand">National Handicrafts Bengaluru</p><div className="app-loading-track" aria-hidden="true"><span /></div><p className="app-loading-caption">Crafting something special…</p></div></div>; }

let googleIdentityScriptPromise;

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleIdentityScriptPromise) return googleIdentityScriptPromise;
  googleIdentityScriptPromise = new Promise((resolve, reject) => {
    const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]') || document.createElement('script');
    const onLoad = () => window.google?.accounts?.id ? resolve() : reject(new Error('Google Identity Services did not initialize.'));
    const onError = () => reject(new Error('Google Identity Services could not be loaded.'));
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!script.isConnected) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      document.head.appendChild(script);
    } else if (window.google?.accounts?.id) onLoad();
  }).catch((error) => {
    googleIdentityScriptPromise = undefined;
    throw error;
  });
  return googleIdentityScriptPromise;
}

function GoogleSignIn({ onSuccess, onError }) {
  const host = useRef(null);
  const callbacks = useRef({ onSuccess, onError });
  const [diagnostic, setDiagnostic] = useState('');
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  const validClientId = !clientId || /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId);

  useEffect(() => { callbacks.current = { onSuccess, onError }; }, [onSuccess, onError]);
  useEffect(() => {
    if (!clientId || !validClientId) return undefined;
    let active = true;
    setDiagnostic('');
    loadGoogleIdentityServices().then(() => {
      if (!active || !host.current) return;
      const identity = window.google.accounts.id;
      identity.initialize({
        client_id: clientId,
        callback: (response) => callbacks.current.onSuccess?.(response.credential),
        error_callback: (error) => {
          const message = error?.type === 'popup_failed_to_open'
            ? 'Google sign-in popup could not be opened. Allow popups and try again.'
            : 'Google sign-in could not be started. Check the OAuth web client and authorized origins.';
          callbacks.current.onError?.(message);
        },
      });
      host.current.replaceChildren();
      identity.renderButton(host.current, { theme: 'filled_blue', size: 'large', text: 'continue_with', shape: 'rectangular', width: Math.min(360, host.current.clientWidth || 360) });
    }).catch(() => {
      if (active) setDiagnostic('Google sign-in could not load. Check the network or content blocker, then reload the page.');
    });
    return () => { active = false; };
  }, [clientId, validClientId]);

  if (!clientId) return <div className="google-signin google-signin-unavailable"><button className="google-config-button" type="button" disabled>Continue with Google</button><p className="auth-note" role="status">Google sign-in is unavailable because VITE_GOOGLE_CLIENT_ID is missing from this deployment’s Vite build environment. Add it to the Vercel project’s Production Environment Variables and redeploy.</p></div>;
  if (!validClientId) return <div className="google-signin google-signin-unavailable"><button className="google-config-button" type="button" disabled>Continue with Google</button><p className="auth-note" role="status">Google sign-in is unavailable because VITE_GOOGLE_CLIENT_ID is not a valid Google OAuth client ID. Use a Google OAuth Web application client ID.</p></div>;
  return <div className="google-signin" ref={host} aria-label="Continue with Google">{diagnostic && <p className="auth-note" role="status">{diagnostic}</p>}</div>;
}
function LandingHero({ setPage }) { return <section id="home" className="hero section"><div className="hero-copy"><p className="section-label">National Handicrafts Bengaluru</p><h1>Craft for every day.</h1><p className="lede">Verified brass, copper, puja, dining and decorative objects, presented with the care they deserve.</p><button className="button primary" onClick={() => setPage('products')}>Explore the collection →</button></div><div className="hero-art"><SafeImage src="/assets/hanging-brass-lanterns.png" alt="Handcrafted brass hanging lanterns" loading="eager" fetchPriority="high" width={700} height={650} /></div></section>; }
function ErrorState({ onRetry, message }) { return <div className="status-state error-state" role="alert"><p>We could not load the catalogue.</p><span>{message || 'Check that the API is running, then try again.'}</span>{onRetry && <button className="button secondary" onClick={onRetry}>Try again</button>}</div>; }
function Home({ setPage, openProduct, addToCart, buyNow, products, catalogueState, catalogueError, refresh }) { return <><section className="hero section"><div className="hero-copy"><p className="section-label">National Handicrafts Bengaluru</p><h1>Craft for every day.</h1><p className="lede">Verified brass, copper, puja, dining and decorative objects, presented with the care they deserve.</p><button className="button primary" onClick={() => setPage('products')}>Explore the collection →</button></div><div className="hero-art"><SafeImage src="/assets/open-vessel-reference.png" alt="Open brass vessel reference" /></div></section><section className="section intro"><div><p className="section-label">The collection</p><h2>Familiar forms, thoughtfully chosen.</h2></div><p>Every public product record is reviewed before it reaches the collection. Browse by material and ritual, then enquire or buy when the verified details are ready.</p></section><section className="section category-grid"><div className="category-heading"><h2>Shop by material and ritual.</h2><button className="text-button" onClick={() => setPage('products')}>View all products →</button></div>{categories.map((name) => <button className="category-tile" key={name} onClick={() => setPage('products')}><SafeImage src={categoryImages[name]} alt={`${name} reference`} /><span>{name}</span><small>Explore collection →</small></button>)}</section><section className="section feature-band"><div><p className="section-label">A quiet kind of luxury</p><h2>Traditional material, modern pace.</h2><p>The catalogue stays clear about what has and has not been verified, so every choice begins with trustworthy detail.</p><button className="text-button" onClick={() => setPage('about')}>Read our story →</button></div><div className="feature-orbit"><SafeImage src="/assets/elephant-reference.png" alt="Decorative elephant reference" /></div></section><section className="section featured"><div className="section-heading"><div><p className="section-label">Selected pieces</p><h2>{products.length ? 'Published from the catalogue.' : 'Verified pieces will appear here.'}</h2></div><button className="text-button" onClick={() => setPage('products')}>Open catalogue →</button></div>{catalogueState === 'loading' ? <LoadingState /> : catalogueState === 'error' ? <ErrorState onRetry={refresh} message={catalogueError} /> : products.length ? <div className="product-grid">{products.slice(0, 3).map((product) => <ProductCard key={product.id} product={product} openProduct={openProduct} addToCart={addToCart} buyNow={buyNow} />)}</div> : <div className="verified-empty"><p>No verified product records are published yet.</p><span>An administrator can publish reviewed product records from the admin portal.</span></div>}</section></>; }
function About() { return <section className="section page-content"><div className="about-copy"><p className="eyebrow">ABOUT NATIONAL HANDICRAFTS</p><h1>Traditional craft, presented with clarity.</h1><p className="lede">A considered digital catalogue for Indian brass, copper, puja and dining objects.</p><p>This foundation keeps source references visible and leaves uncertain catalogue details unpublished until they are reviewed.</p></div><div className="about-mark"><SafeImage src="/assets/heritage-emblem.png" alt="National Handicrafts heritage emblem" /></div></section>; }
function LegacyProductCard({ product, openProduct, addToCart, buyNow }) { const canBuy = product.stock !== 0 && product.price_inr != null; return <article className="product-card" tabIndex="0" role="link" onClick={() => openProduct(product.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProduct(product.id); } }}><div className="product-image"><SafeImage src={imageUrl(product.image_path)} alt={product.name} /></div><div className="product-meta"><p className="eyebrow">{product.category}</p><h3>{product.name}</h3><div className="product-bottom"><span>{formatPrice(product.price_inr)}</span><small>{product.stock === 0 ? 'Out of stock' : 'Available'}</small></div><div className="card-actions"><button className="button secondary card-action" disabled={!canBuy} onClick={(event) => { event.stopPropagation(); addToCart(product, event.currentTarget); }}>Add to cart</button><button className="button primary card-action" disabled={!canBuy} onClick={(event) => { event.stopPropagation(); buyNow(product); }}>{canBuy ? 'Buy now' : 'Unavailable'}</button></div></div></article>; }
function LegacyProducts({ products, refresh, openProduct, addToCart, buyNow, catalogueState, catalogueError }) { const [q, setQ] = useState(''); const [category, setCategory] = useState(''); const filtered = products.filter((p) => (!category || p.category === category) && (!q || `${p.name} ${p.category}`.toLowerCase().includes(q.toLowerCase()))); return <section className="section products-page"><div className="page-heading"><div><p className="eyebrow">THE CATALOGUE</p><h1>Find a piece with presence.</h1></div><p>Only active, verified products appear in this customer-facing collection.</p></div><div className="toolbar"><input aria-label="Search products" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} /><select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select><button className="text-button" onClick={refresh}>Refresh</button></div>{catalogueState === 'loading' ? <LoadingState /> : catalogueState === 'error' ? <ErrorState onRetry={refresh} message={catalogueError} /> : filtered.length ? <div className="product-grid">{filtered.map((product) => <ProductCard key={product.id} product={product} openProduct={openProduct} addToCart={addToCart} buyNow={buyNow} />)}</div> : <div className="verified-empty"><p>No matching verified products.</p><span>Product records added and verified in the admin portal appear here automatically.</span></div>}</section>; }
function Products({ products, refresh, openProduct, addToCart, buyNow, catalogueState, catalogueError, searchQuery, setSearchQuery }) { const [category, setCategory] = useState(''); const [filtersOpen, setFiltersOpen] = useState(false); const filtered = products.filter((p) => (!category || p.category === category) && (!searchQuery || `${p.name} ${p.category}`.toLowerCase().includes(searchQuery.toLowerCase()))); return <section className="section products-page"><div className="page-heading"><div><p className="eyebrow">THE CATALOGUE</p><h1>Find a piece with presence.</h1></div><p>Only active, verified products appear in this customer-facing collection.</p></div><div className="toolbar"><label className="product-search"><span aria-hidden="true">⌕</span><input aria-label="Search products" placeholder="Search products" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></label><button className="filter-toggle" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>Filters <span aria-hidden="true">{filtersOpen ? '−' : '+'}</span></button><button className="text-button product-refresh" onClick={refresh}>Refresh</button></div><div className="category-chips" aria-label="Product categories"><button className={!category ? 'active' : ''} onClick={() => setCategory('')}>All</button>{categories.map((c) => <button className={category === c ? 'active' : ''} key={c} onClick={() => setCategory(c)}>{c}</button>)}</div>{filtersOpen && <div className="mobile-filter-panel"><label htmlFor="product-category-filter">Category<select id="product-category-filter" aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></label><button className="button secondary" type="button" onClick={() => setFiltersOpen(false)}>Done</button></div>}{catalogueState === 'loading' ? <LoadingState /> : catalogueState === 'error' ? <ErrorState onRetry={refresh} message={catalogueError} /> : filtered.length ? <div className="product-grid">{filtered.map((product) => <ProductCard key={product.id} product={product} openProduct={openProduct} addToCart={addToCart} buyNow={buyNow} />)}</div> : <div className="verified-empty"><p>No matching verified products.</p><span>Product records added and verified in the admin portal appear here automatically.</span></div>}</section>; }
function ProductDetail({ id, setPage, addToCart, buyNow }) { const [state, setState] = useState({ status: 'loading', product: null, error: '' }); const load = () => { if (!id) { setState({ status: 'error', product: null, error: 'Product not found.' }); return; } setState({ status: 'loading', product: null, error: '' }); api(`/products/${encodeURIComponent(id)}`).then((response) => setState({ status: 'ready', product: response.data, error: '' })).catch((error) => setState({ status: 'error', product: null, error: error.message })); }; useEffect(load, [id]); if (state.status === 'loading') return <section className="section"><LoadingState label="Loading product details…" /></section>; if (state.status === 'error') return <section className="section page-content"><p className="eyebrow">PRODUCT DETAILS</p><h1>That piece is not available.</h1><p className="lede">{state.error || 'This product may have been unpublished or could not be found.'}</p><button className="button secondary" onClick={() => setPage('products')}>Back to catalogue</button><button className="text-button detail-retry" onClick={load}>Try again</button></section>; const product = state.product; const canBuy = product.stock !== 0 && product.price_inr != null; return <section className="section detail-page"><button className="back-link" onClick={() => setPage('products')}>← Back to catalogue</button><div className="detail-grid"><div className="detail-image"><SafeImage src={imageUrl(product.image_path)} alt={product.name} /></div><div className="detail-copy"><p className="eyebrow">{product.category}</p><h1>{product.name}</h1><p className="price-large">{formatPrice(product.price_inr)}</p>{product.description && <p className="lede">{product.description}</p>}<div className="verification"><span>{product.stock === 0 ? 'Currently out of stock' : 'Available to order'}</span><small>Published from a verified catalogue record.</small></div><div className="detail-actions"><button className="button secondary" disabled={!canBuy} onClick={(event) => addToCart(product, event.currentTarget)}>{canBuy ? 'Add to cart' : 'Unavailable'}</button><button className="button primary" disabled={!canBuy} onClick={() => buyNow(product)}>{canBuy ? 'Buy now' : 'Price unavailable'}</button></div><p className="fine-print">Payment remains pending until independently verified by the administrator. No payment credentials are stored.</p></div></div></section>; }
function Cart({ setPage, onCheckout, cart, setQuantity, removeFromCart, clearCart }) {
  const subtotal = cart.some((item) => item.price_inr == null)
    ? null
    : cart.reduce((sum, item) => sum + Number(item.price_inr) * item.quantity, 0);
  const updateQuantity = (item, amount) => {
    setQuantity(cartItemKey(item), amount);
  };
  const removeItem = (item) => {
    if (window.confirm(`Remove ${item.name} from your cart?`)) removeFromCart(cartItemKey(item));
  };
  return <section className="section cart-page">
    <p className="eyebrow">YOUR CART</p>
    <h1>{cart.length ? 'Review your pieces.' : 'Your cart is quiet for now.'}</h1>
    {cart.length ? <div className="cart-layout">
      <div className="cart-list-column">
        <div className="cart-items">{cart.map((item) => <article className="cart-item" key={cartItemKey(item)}>
          <SafeImage src={imageUrl(item.image_path) || categoryImages[item.category]} alt={item.name} />
          <div className="cart-item-details">
            <p className="eyebrow">{item.category}</p>
            <h2>{item.name}</h2>
            {item.variant && <small className="cart-variant">{[item.variant.name, item.variant.size, item.variant.weight != null ? `${item.variant.weight} ${item.variant.weightUnit || ''}` : '', item.variant.capacity ? `${item.variant.capacity} ${item.variant.capacityUnit || ''}` : ''].filter(Boolean).join(' · ')}</small>}
            <span className="cart-unit-price">{formatPrice(item.price_inr)} each</span>
            <div className="quantity" aria-label={`Quantity for ${item.name}`}>
              <button type="button" aria-label={`Decrease quantity of ${item.name}`} disabled={item.quantity <= 1} onClick={() => updateQuantity(item, -1)}><svg className="quantity-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
              <span aria-live="polite">{item.quantity}</span>
              <button type="button" aria-label={`Increase quantity of ${item.name}`} disabled={item.stock != null && item.quantity >= item.stock} onClick={() => updateQuantity(item, 1)}><svg className="quantity-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></button>
            </div>
          </div>
          <div className="cart-item-end">
            <strong className="cart-line-total">{item.price_inr == null ? 'Price on request' : formatPrice(Number(item.price_inr) * item.quantity)}</strong>
            <button type="button" className="cart-remove" aria-label={`Remove ${item.name} from cart`} onClick={() => removeItem(item)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m4 3v6m4-6v6" /></svg>
              <span>Remove</span>
            </button>
          </div>
        </article>)}</div>
        <button type="button" className="text-button cart-clear" onClick={() => { if (window.confirm('Remove all pieces from your cart?')) clearCart(); }}>Clear cart</button>
      </div>
      <aside className="cart-summary">
        <p className="eyebrow">ORDER SUMMARY</p>
        <div><span>Items</span><span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span></div>
        <div><span>Subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
        <div className="cart-total"><span>Total</span><strong>{formatPrice(subtotal)}</strong></div>
        <p className="fine-print">Final availability and prices are verified against the catalogue when your order is placed.</p>
        <button type="button" className="button primary" onClick={onCheckout}>Proceed to Checkout <svg className="cart-continue-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg></button>
        <button type="button" className="text-button cart-continue" onClick={() => setPage('products')}>Continue shopping</button>
      </aside>
    </div> : <div className="empty-state cart-empty">
      <div className="cart-empty-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 3v26M3 16h26M6.8 6.8l18.4 18.4M25.2 6.8 6.8 25.2" /></svg></div>
      <h2>Your saved cart has no pieces yet.</h2>
      <p>Explore the verified collection and keep the pieces you love here.</p>
      <button type="button" className="button primary" onClick={() => setPage('products')}>Continue Shopping</button>
    </div>}
  </section>;
}
function Checkout({ setPage, items, clearCart, isCart = false }) {
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '', houseStreet: '', locality: '', city: '', state: '', pin: '', landmark: '' });
  const [status, setStatus] = useState({ type: 'idle', message: '' });
  const [order, setOrder] = useState(null);
  const submissionInFlight = useRef(false);
  const idempotencyKey = useRef(null);
  const subtotal = items.some((item) => item.price_inr == null)
    ? null
    : items.reduce((sum, item) => sum + Number(item.price_inr) * item.quantity, 0);
  const update = (key, value) => setCustomer((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!items.length || submissionInFlight.current) return;
    if (!window.confirm(`Place this Cash on Delivery order for ${formatPrice(subtotal)}?`)) return;
    submissionInFlight.current = true;
    setStatus({ type: 'submitting', message: '' });
    idempotencyKey.current ||= crypto.randomUUID();
    const address = [customer.houseStreet.trim(), customer.locality.trim()].filter(Boolean).join(', ');
    const orderCustomer = { ...customer, address };
    try {
      const response = await api('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify({ customer: orderCustomer, paymentMethod: 'COD', items: items.map((item) => ({ id: item.id, variantId: item.variantId || null, quantity: item.quantity })) }),
      });
      setOrder(response.data);
      if (isCart) clearCart?.();
      setStatus({ type: 'success', message: '' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      submissionInFlight.current = false;
    }
  };
  if (order) return <section className="section checkout-page"><p className="eyebrow">ORDER RECEIVED</p><h1>Thank you. Your order is reserved.</h1><div className="success-state"><p>Order reference: <strong>{order.id}</strong></p><p>Payment method: <strong>Cash on Delivery</strong></p><p>Payment status: <strong>Pending. Payment is collected on delivery for COD orders.</strong></p></div><button className="button secondary" onClick={() => setPage('products')}>Continue browsing</button><button className="text-button checkout-account-link" onClick={() => setPage('profile')}>View your account</button></section>;
  if (!items.length) return <section className="section empty-state"><p>Your checkout has no verified pieces.</p><button className="button secondary" onClick={() => setPage('products')}>Browse catalogue</button></section>;
  return <section className="section checkout-page">
    <button type="button" className="checkout-back" onClick={() => setPage(isCart ? 'cart' : 'products')}><svg className="checkout-back-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5m6 6-6-6 6-6" /></svg>{isCart ? 'Back to cart' : 'Back to collection'}</button>
    <p className="eyebrow">SECURE CHECKOUT</p><h1>Complete your order.</h1>
    <div className="checkout-layout">
      <div className="checkout-summary"><h2>Order summary</h2>
        {items.map((item) => <div className="checkout-item" key={cartItemKey(item)}>
          <SafeImage src={imageUrl(item.image_path) || categoryImages[item.category]} alt={item.name} />
          <div><strong>{item.name}</strong>{item.variant && <span>{[item.variant.name, item.variant.size, item.variant.weight != null ? `${item.variant.weight} ${item.variant.weightUnit || ''}` : ''].filter(Boolean).join(' · ')}</span>}<span>{formatPrice(item.price_inr)} each | Quantity {item.quantity}</span><b>{item.price_inr == null ? 'Price on request' : formatPrice(Number(item.price_inr) * item.quantity)}</b></div>
        </div>)}
        <div className="summary-total"><span>Total</span><strong>{formatPrice(subtotal)}</strong></div>
        <p className="fine-print">The server verifies current catalogue prices and stock before creating your order.</p>
      </div>
      <form className="checkout-form checkout-details" onSubmit={submit}>
        <h2>Delivery details</h2>
        <label>Full name<input required autoComplete="name" maxLength="160" value={customer.name} onChange={(event) => update('name', event.target.value)} /></label>
        <label>Mobile number<input required type="tel" inputMode="tel" autoComplete="tel" pattern="(?:\+91[ -]?)?[6-9][0-9]{9}" title="Enter a valid 10-digit Indian mobile number, optionally prefixed by +91." value={customer.phone} onChange={(event) => update('phone', event.target.value)} /></label>
        <label>Email address<input required type="email" autoComplete="email" value={customer.email} onChange={(event) => update('email', event.target.value)} /></label>
        <label>House number / Street address<input required autoComplete="address-line1" maxLength="300" value={customer.houseStreet} onChange={(event) => update('houseStreet', event.target.value)} /></label>
        <label>Area / Locality<input required autoComplete="address-line2" maxLength="200" value={customer.locality} onChange={(event) => update('locality', event.target.value)} /></label>
        <div className="checkout-two-column"><label>City<input required autoComplete="address-level2" maxLength="100" value={customer.city} onChange={(event) => update('city', event.target.value)} /></label><label>State<input required autoComplete="address-level1" maxLength="100" value={customer.state} onChange={(event) => update('state', event.target.value)} /></label></div>
        <label>PIN code<input required inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{6}" maxLength="6" title="Enter a 6-digit PIN code." value={customer.pin} onChange={(event) => update('pin', event.target.value)} /></label>
        <label>Landmark <span>(optional)</span><input autoComplete="off" maxLength="200" value={customer.landmark} onChange={(event) => update('landmark', event.target.value)} /></label>
        <fieldset className="payment-choice"><legend>Payment method</legend><label className="cod-choice"><input type="radio" name="paymentMethod" value="COD" checked readOnly /> <span><strong>Cash on Delivery</strong><small>Pay when your order arrives.</small></span></label></fieldset>
        {status.type === 'error' && <p className="form-error" role="alert">{status.message}</p>}
        <button className="button primary" disabled={status.type === 'submitting'}>{status.type === 'submitting' ? 'Placing your order...' : 'Place Order'}</button>
      </form>
    </div>
  </section>;
}
function PaymentPanel({ order, payment }) { const [qr, setQr] = useState(''); const configured = payment?.enabled && order?.payment_status !== 'not_configured' && order?.payment_method !== 'COD'; const intent = configured ? `upi://pay?${new URLSearchParams({ pa: payment.upiId, pn: payment.payeeName, am: String(order.total_inr), cu: 'INR', tn: order.id }).toString()}` : ''; useEffect(() => { if (intent) QRCode.toDataURL(intent, { margin: 1, width: 220 }).then(setQr).catch(() => setQr('')); }, [intent]); if (order?.payment_method === 'COD') return <p className="payment-not-configured">Your order is confirmed for Cash on Delivery. Payment remains pending until collected when the order arrives.</p>; if (!configured) return <p className="payment-not-configured">Online payment is not configured yet. Your order is recorded, and the administrator can contact you with the next steps.</p>; return <div className="payment-panel"><h2>Pay by UPI</h2><p>Pay <strong>{formatPrice(order.total_inr)}</strong> to <strong>{payment.payeeName}</strong>.</p><p className="payment-reference">Reference: <strong>{order.id}</strong></p>{qr && <img className="payment-qr" src={qr} alt="UPI payment QR code" />}<div className="payment-actions"><a className="button primary" href={intent}>Open UPI app</a><button className="button secondary" onClick={() => navigator.clipboard?.writeText(payment.upiId)}>Copy UPI ID</button></div><p className="fine-print">Payment remains pending until independently verified by National Handicrafts. Opening the app, scanning this QR code, or sharing a screenshot does not mark the order paid.</p></div>; }
function Admin({ refresh }) { return null; }
function Contact() { return <section className="section page-content"><p className="eyebrow">CONTACT</p><h1>Catalogue enquiries are open through your cart.</h1><p className="lede">Add verified pieces to your cart and send an enquiry with your contact details. Verified business contact details were not supplied in the source materials, so this site does not invent them.</p></section>; }
function Footer({ setPage }) { return <footer className="site-footer"><div><SafeImage src="/assets/heritage-emblem.png" alt="" /><p>National Handicrafts Bengaluru</p></div><div><p className="eyebrow">EXPLORE</p><button onClick={() => setPage('products')}>Shop</button><button onClick={() => setPage('about')}>About Us</button><button onClick={() => setPage('contact')}>Contact</button><button onClick={() => setPage('cart')}>Cart</button><button onClick={() => setPage('admin')}>Admin</button></div><div><p className="eyebrow">CATALOGUE NOTE</p><p className="footer-note">Rates and specifications are shown only after source review.</p></div></footer>; }
function ProductSpecifications({ specifications = {} }) {
  const labels = { brand: 'Brand', productType: 'Product type', material: 'Material', customMaterial: 'Material', finish: 'Finish', customFinish: 'Finish', colour: 'Colour', countryOfOrigin: 'Country of origin', size: 'Size / Number', weight: 'Weight', length: 'Length', width: 'Width', height: 'Height', diameter: 'Diameter', capacity: 'Capacity', pieces: 'Pieces', itemsIncluded: 'Set contents', accessories: 'Accessories', packagingType: 'Packaging', giftBox: 'Gift box', packagingColours: 'Packaging colours', usage: 'Usage', careInstructions: 'Care instructions', specialFeatures: 'Special features', additionalNotes: 'Additional notes' };
  const excluded = new Set(['sourceReviewStatus','sourceReviewNotes','countryOfOriginVerified','weightUnit','capacityUnit','measurementUnit']);
  const rows = Object.entries(specifications).filter(([key, value]) => !excluded.has(key) && value !== '' && value !== null && value !== undefined && (key !== 'countryOfOrigin' || specifications.countryOfOriginVerified)).map(([key,value]) => [labels[key] || key, key === 'giftBox' ? (value ? 'Available' : 'Not available') : value]);
  const measurementUnit = specifications.measurementUnit;
  const combined = rows.map(([label,value]) => [label, label === 'Weight' && specifications.weightUnit ? `${value} ${specifications.weightUnit}` : label === 'Capacity' && specifications.capacityUnit ? `${value} ${specifications.capacityUnit}` : ['Length','Width','Height','Diameter'].includes(label) && measurementUnit ? `${value} ${measurementUnit}` : value]);
  return combined.length ? <section className="product-specifications"><h2>Product details</h2><dl>{combined.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl></section> : null;
}
function ProductDetailV2({ id, setPage, addToCart, buyNow }) {
  const [state, setState] = useState({ status: 'loading', product: null, error: '' });
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const load = () => { if (!id) { setState({ status: 'error', product: null, error: 'Product not found.' }); return; } setState({ status: 'loading', product: null, error: '' }); api(`/products/${encodeURIComponent(id)}`).then((response) => { setState({ status: 'ready', product: response.data, error: '' }); setSelectedVariantId(response.data.variants?.[0]?.id || ''); }).catch((error) => setState({ status: 'error', product: null, error: error.message })); };
  useEffect(load, [id]);
  if (state.status === 'loading') return <section className="section"><LoadingState label="Loading product details…" /></section>;
  if (state.status === 'error') return <section className="section page-content"><p className="eyebrow">PRODUCT DETAILS</p><h1>That piece is not available.</h1><p className="lede">{state.error || 'This product may have been unpublished or could not be found.'}</p><button className="button secondary" onClick={() => setPage('products')}>Back to catalogue</button><button className="text-button detail-retry" onClick={load}>Try again</button></section>;
  const product = state.product;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const selectedVariant = variants.length ? variants.find((variant) => variant.id === selectedVariantId) : null;
  const price = selectedVariant ? selectedVariant.price_inr : product.price_inr;
  const stock = selectedVariant ? selectedVariant.stock : product.stock;
  const availabilityState = productPurchaseState(product, selectedVariant);
  const inStock = availabilityState.canPurchase;
  const canBuy = availabilityState.canPurchase;
  const detailPrice = price == null ? selectedVariant && selectedVariant.source_review_status !== 'verified' ? 'Price awaiting review' : 'Price on request' : formatPrice(price);
  const selectedProduct = selectedVariant ? { ...product, variantId: selectedVariant.id, variant: { id: selectedVariant.id, name: selectedVariant.name, size: selectedVariant.size, weight: selectedVariant.weight, weightUnit: selectedVariant.weight_unit, dimensions: selectedVariant.dimensions, capacity: selectedVariant.capacity, capacityUnit: selectedVariant.capacity_unit, sku: selectedVariant.sku, availability: selectedVariant.availability, source_review_status: selectedVariant.source_review_status }, price_inr: selectedVariant.price_inr, stock: selectedVariant.stock, name: product.name } : product;
  return <section className="section detail-page"><button className="back-link" onClick={() => setPage('products')}>← Back to catalogue</button><div className="detail-grid"><div className="detail-image"><SafeImage src={imageUrl(product.image_path) || categoryImages[product.category]} alt={product.name} /></div><div className="detail-copy"><p className="eyebrow">{product.category}</p><h1>{product.name}</h1>{variants.length > 0 && <label className="variant-select-label">Choose an option<select value={selectedVariantId} onChange={(event) => setSelectedVariantId(event.target.value)}>{variants.map((variant) => <option key={variant.id} value={variant.id}>{[variant.name, variant.size, variant.weight != null ? `${variant.weight} ${variant.weight_unit || ''}` : '', variant.capacity ? `${variant.capacity} ${variant.capacity_unit || ''}` : ''].filter(Boolean).join(' · ') || 'Catalogue option'}{variant.price_inr == null ? ' · Price awaiting review' : ` · ${formatPrice(variant.price_inr)}`}</option>)}</select></label>}<p className="price-large product-detail-price" aria-label={detailPrice}>{detailPrice}</p>{product.description && <p className="lede">{product.description}</p>}<div className={`verification ${inStock ? 'is-in-stock' : 'is-unavailable'}`}><span>{inStock ? <><i aria-hidden="true" />{availabilityState.label}</> : availabilityState.label}</span><small>Published from a verified catalogue record.</small></div><ProductSpecifications specifications={product.specifications} /><div className="detail-actions"><button className="button secondary" disabled={!canBuy && availabilityState.kind !== 'enquiry'} onClick={(event) => { if (availabilityState.kind === 'enquiry') setPage('contact'); else addToCart(selectedProduct, event.currentTarget); }}>{canBuy ? 'Add to cart' : availabilityState.kind === 'enquiry' ? 'Enquire' : 'Unavailable'}</button><button className="button primary" disabled={!canBuy} onClick={() => buyNow(selectedProduct)}>{canBuy ? 'Buy now' : 'Unavailable'}</button></div><p className="fine-print">Payment remains pending until independently verified by National Handicrafts. No payment credentials are stored.</p></div></div></section>;
}function PasswordRecovery({ setPage }) {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const resetMode = params.get('page') === 'password-reset' && Boolean(token);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState({ type: '', message: '' });
  const submit = async (event) => {
    event.preventDefault();
    if (resetMode && password !== confirmPassword) { setStatus({ type: 'error', message: 'Passwords do not match.' }); return; }
    setStatus({ type: 'loading', message: '' });
    try {
      if (resetMode) {
        const result = await api('/customer/auth/password/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
        setStatus({ type: 'success', message: result.message });
        history.replaceState({}, '', '/profile');
      } else {
        const result = await api('/customer/auth/password/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        setStatus({ type: 'success', message: result.message });
      }
    } catch (error) { setStatus({ type: 'error', message: error.message }); }
  };
  return <section className="section profile-auth"><div className="profile-auth-card"><p className="eyebrow">YOUR ACCOUNT</p><h1>{resetMode ? 'Choose a new password.' : 'Reset your password.'}</h1><p className="lede">{resetMode ? 'Use a password between 8 and 200 characters.' : 'Enter your account email. If recovery is configured, we will send a secure reset link.'}</p><form className="profile-auth-form" onSubmit={submit}>{resetMode ? <><label>New password<input required minLength="8" maxLength="200" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Confirm new password<input required minLength="8" maxLength="200" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label></> : <label>Email address<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}{status.message && <p className={status.type === 'error' ? 'form-error' : 'form-success'} role={status.type === 'error' ? 'alert' : 'status'}>{status.message}</p>}<button className="button primary" disabled={status.type === 'loading'}>{status.type === 'loading' ? 'Please wait…' : resetMode ? 'Reset password' : 'Send reset link'}</button></form><button className="text-button auth-switch" type="button" onClick={() => setPage('profile')}>Back to sign in</button></div></section>;
}
function CustomerProfile({ setPage, skipInitialSessionCheck = false, clearSkipInitialSessionCheck = () => {}, profileEntry = null }) {
  const [authState, setAuthState] = useState('loading');
  const [mode, setMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [profile, setProfile] = useState(null);
  const [draft, setDraft] = useState(null);
  const [orders, setOrders] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [csrf, setCsrf] = useState('');
  const googleLoginInFlight = useRef(false);
  const [addressDraft, setAddressDraft] = useState({ label: '', recipientName: '', phone: '', address: '', city: '', state: '', pin: '', isDefault: false });
  const [editingAddress, setEditingAddress] = useState(null);
  const [status, setStatus] = useState({ type: '', message: '' });
  const loadAccount = async (verifiedProfile = null) => { const me = verifiedProfile ? { data: verifiedProfile } : await api('/customer/auth/me'); setProfile(me.data); setDraft(me.data); setAuthState('ready'); try { const [token, orderResponse, addressResponse] = await Promise.all([api('/customer/auth/csrf'), api('/customer/orders'), api('/customer/addresses')]); setCsrf(token.data.token); setOrders(orderResponse.data || []); setAddresses(addressResponse.data || []); return true; } catch (error) { setStatus({ type: 'error', message: `You are signed in, but account details could not be fully loaded. ${error.message}` }); return false; } };
  useEffect(() => { if (profileEntry?.checked) { if (!profileEntry.profile) { setAuthState('signed-out'); return; } loadAccount(profileEntry.profile).catch(() => setAuthState('signed-out')); return; } if (skipInitialSessionCheck) { setAuthState('signed-out'); clearSkipInitialSessionCheck(); return; } loadAccount().catch(() => setAuthState('signed-out')); }, []);
  useEffect(() => { if (authState !== 'ready') return; const timer = window.setInterval(() => api('/customer/orders').then((response) => setOrders(response.data || [])).catch(() => {}), 30000); return () => window.clearInterval(timer); }, [authState]);
  const submitAuth = async (event) => { event.preventDefault(); if (mode === 'register' && authForm.password !== authForm.confirmPassword) { setStatus({ type: 'error', message: 'Passwords do not match.' }); return; } setStatus({ type: 'loading', message: '' }); try { if (mode === 'login') { const account = await authenticateAccount(authForm); if (account.role === 'admin') { window.location.assign('/admin'); return; } await loadAccount(); if (sessionStorage.getItem('nh_return_to_checkout')) { sessionStorage.removeItem('nh_return_to_checkout'); setPage('checkout'); } else setStatus({ type: 'success', message: 'Signed in securely.' }); return; } await api('/customer/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: authForm.name, email: authForm.email, password: authForm.password }) }); await loadAccount(); if (sessionStorage.getItem('nh_return_to_checkout')) { sessionStorage.removeItem('nh_return_to_checkout'); setPage('checkout'); } else setStatus({ type: 'success', message: 'Your customer account is ready.' }); } catch (error) { setStatus({ type: 'error', message: error.message }); } };
  const googleSignIn = async (credential) => { if (googleLoginInFlight.current) return; googleLoginInFlight.current = true; setStatus({ type: 'loading', message: '' }); try { await api('/customer/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) }); const accountDetailsLoaded = await loadAccount(); if (sessionStorage.getItem('nh_return_to_checkout')) { sessionStorage.removeItem('nh_return_to_checkout'); setPage('checkout'); } else if (accountDetailsLoaded) setStatus({ type: 'success', message: 'Signed in with Google.' }); } catch (error) { setStatus({ type: 'error', message: error.message }); } finally { googleLoginInFlight.current = false; } };
  const saveProfile = async (event) => { event.preventDefault(); setStatus({ type: 'loading', message: '' }); try { const response = await api('/customer/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(draft) }); setProfile(response.data); setDraft(response.data); setStatus({ type: 'success', message: 'Profile details saved.' }); } catch (error) { setStatus({ type: 'error', message: error.message }); } };
  const saveAddress = async (event) => { event.preventDefault(); setStatus({ type: 'loading', message: '' }); try { const path = editingAddress ? `/customer/addresses/${encodeURIComponent(editingAddress)}` : '/customer/addresses'; const response = await api(path, { method: editingAddress ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(addressDraft) }); setAddresses((current) => editingAddress ? current.map((item) => item.id === editingAddress ? response.data : item) : [response.data, ...current]); setEditingAddress(null); setAddressDraft({ label: '', recipientName: '', phone: '', address: '', city: '', state: '', pin: '', isDefault: false }); setStatus({ type: 'success', message: 'Address saved.' }); } catch (error) { setStatus({ type: 'error', message: error.message }); } };
  const deleteAddress = async (id) => { if (!window.confirm('Remove this saved address?')) return; try { await api(`/customer/addresses/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } }); setAddresses((current) => current.filter((item) => item.id !== id)); setStatus({ type: 'success', message: 'Address removed.' }); } catch (error) { setStatus({ type: 'error', message: error.message }); } };
  const requestCancellation = async (order) => { const shipped = order.status === 'shipped'; if (!window.confirm(shipped ? `Request cancellation for ${order.id}? An administrator will review it.` : `Cancel order ${order.id}?`)) return; try { await api(`/customer/orders/${encodeURIComponent(order.id)}/cancellation`, { method: 'POST', headers: { 'X-CSRF-Token': csrf } }); await loadAccount(); setStatus({ type: 'success', message: shipped ? 'Cancellation request submitted for review.' : 'Order cancelled.' }); } catch (error) { setStatus({ type: 'error', message: error.message }); } };
  const logout = async () => { try { await api('/customer/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } }); } finally { setProfile(null); setAuthState('signed-out'); setPage('profile'); } };
  if (authState === 'loading') return <section className="section profile-page"><LoadingState label="Loading your profile…" /></section>;
  if (authState === 'signed-out') return <section className="section profile-auth"><div className="profile-auth-card"><img className="profile-auth-logo" src="/assets/heritage-emblem.png" alt="National Handicrafts Bengaluru" /><p className="eyebrow">YOUR ACCOUNT</p><h1>{mode === 'login' ? 'Welcome back.' : 'Create your account.'}</h1><p className="lede">Sign in or create an account to continue.</p><GoogleSignIn onSuccess={googleSignIn} onError={(message) => setStatus({ type: 'error', message })} /><div className="auth-divider"><span>or use email</span></div><form className="profile-auth-form" onSubmit={submitAuth}>{mode === 'register' && <label>Full name<input required autoComplete="name" value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} /></label>}<label>Email address<input required type="email" autoComplete="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} /></label><label>Password<span className="password-field"><input required minLength="8" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></span></label>{mode === 'register' && <label>Confirm password<input required minLength="8" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={authForm.confirmPassword} onChange={(e) => setAuthForm({ ...authForm, confirmPassword: e.target.value })} /></label>}{status.message && <p className={status.type === 'error' ? 'form-error' : 'form-success'} role={status.type === 'error' ? 'alert' : 'status'}>{status.message}</p>}<button className="button primary" disabled={status.type === 'loading'}>{status.type === 'loading' ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button></form>{mode === 'login' && <button className="text-button auth-recovery" type="button" onClick={() => setPage('password-recovery')}>Forgot password?</button>}<button className="text-button auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setStatus({}); setShowPassword(false); }}>{mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button>{import.meta.env.DEV && !import.meta.env.VITE_GOOGLE_CLIENT_ID && <p className="auth-note">Google sign-in needs VITE_GOOGLE_CLIENT_ID in the development environment.</p>}</div></section>;
  const initials = (profile?.name || profile?.email || '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return <section className="section profile-page"><div className="profile-heading"><div><p className="eyebrow">YOUR ACCOUNT</p><h1>Your profile.</h1><p className="lede">A private place for your details, saved addresses, and orders.</p></div><button className="button secondary" onClick={logout}>Log out</button></div>{status.message && <p className={status.type === 'error' ? 'form-error' : 'form-success'} role={status.type === 'error' ? 'alert' : 'status'}>{status.message}</p>}<div className="profile-overview"><div className="profile-avatar" aria-hidden="true">{initials}</div><div><h2>{profile.name || 'Add your name'}</h2><p>{profile.email}</p><small>{profile.phone || 'Phone number not added'}</small></div></div><div className="profile-grid"><form className="profile-panel profile-form" onSubmit={saveProfile}><div className="profile-panel-heading"><div><p className="eyebrow">PERSONAL DETAILS</p><h2>Edit your details.</h2></div><button className="text-button" type="button" onClick={() => setDraft(profile)}>Cancel</button></div><label>Full name<input required value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label><label>Email address<input value={draft.email || ''} disabled /></label><label>Phone number<input value={draft.phone || ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label><label>Delivery address<textarea rows="3" value={draft.address || ''} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></label><div className="profile-two-column"><label>City<input value={draft.city || ''} onChange={(e) => setDraft({ ...draft, city: e.target.value })} /></label><label>State<input value={draft.state || ''} onChange={(e) => setDraft({ ...draft, state: e.target.value })} /></label></div><label>PIN code<input inputMode="numeric" maxLength="6" value={draft.pin || ''} onChange={(e) => setDraft({ ...draft, pin: e.target.value })} /></label><button className="button primary" disabled={status.type === 'loading'}>Save changes</button></form><div className="profile-panel"><div className="profile-panel-heading"><div><p className="eyebrow">SAVED ADDRESSES</p><h2>Delivery addresses.</h2></div><span>{addresses.length} saved</span></div>{addresses.length ? <div className="address-list">{addresses.map((address) => <div className="address-card" key={address.id}><div><strong>{address.label}</strong>{address.is_default && <span className="profile-badge">Default</span>}<p>{address.recipient_name}<br />{address.address}, {address.city}<br />{address.state} — {address.pin}<br />{address.phone}</p></div><div className="address-actions"><button className="text-button" onClick={() => { setEditingAddress(address.id); setAddressDraft({ label: address.label, recipientName: address.recipient_name, phone: address.phone, address: address.address, city: address.city, state: address.state, pin: address.pin, isDefault: address.is_default }); }}>Edit</button><button className="text-button" onClick={() => deleteAddress(address.id)}>Delete</button></div></div>)}</div> : <div className="profile-empty">No saved addresses yet.</div>}<form className="address-form" onSubmit={saveAddress}><h3>{editingAddress ? 'Edit address' : 'Add an address'}</h3><div className="profile-two-column"><label>Label<input required placeholder="Home or studio" value={addressDraft.label} onChange={(e) => setAddressDraft({ ...addressDraft, label: e.target.value })} /></label><label>Recipient name<input required value={addressDraft.recipientName} onChange={(e) => setAddressDraft({ ...addressDraft, recipientName: e.target.value })} /></label></div><label>Phone<input required value={addressDraft.phone} onChange={(e) => setAddressDraft({ ...addressDraft, phone: e.target.value })} /></label><label>Address<textarea required rows="2" value={addressDraft.address} onChange={(e) => setAddressDraft({ ...addressDraft, address: e.target.value })} /></label><div className="profile-two-column"><label>City<input required value={addressDraft.city} onChange={(e) => setAddressDraft({ ...addressDraft, city: e.target.value })} /></label><label>State<input required value={addressDraft.state} onChange={(e) => setAddressDraft({ ...addressDraft, state: e.target.value })} /></label></div><div className="profile-two-column"><label>PIN code<input required inputMode="numeric" maxLength="6" value={addressDraft.pin} onChange={(e) => setAddressDraft({ ...addressDraft, pin: e.target.value })} /></label><label className="profile-checkbox"><input type="checkbox" checked={addressDraft.isDefault} onChange={(e) => setAddressDraft({ ...addressDraft, isDefault: e.target.checked })} /> Use as default</label></div><button className="button secondary">{editingAddress ? 'Update address' : 'Save address'}</button></form></div></div><div className="profile-panel profile-orders"><div className="profile-panel-heading"><div><p className="eyebrow">ORDER HISTORY</p><h2>My orders.</h2></div><span>{orders.length} total</span></div>{orders.length ? <div className="profile-orders-list">{orders.map((order) => <article className="profile-order" key={order.id}><div><strong>{order.id}</strong><small>{new Date(order.created_at).toLocaleDateString()}</small></div><div>{(order.items || []).map((item) => <span key={`${order.id}-${item.productId}-${item.variantId || 'base'}`}>{item.name}{item.variant?.size ? ` · ${item.variant.size}` : item.variant?.name ? ` · ${item.variant.name}` : ''} × {item.quantity}</span>)}</div><strong>{formatPrice(order.total_inr)}</strong><div className="profile-order-status"><span className="profile-badge">{order.status}</span><span className="profile-badge payment">{order.payment_method === "COD" && order.payment_status === "verified" ? "COD Collected" : order.payment_method === "COD" ? "COD Pending" : order.payment_status}</span>{order.cancellation_request_status && <span className="profile-badge">Cancellation: {order.cancellation_request_status === "pending" ? "Pending Review" : order.cancellation_request_status === "approved" ? "Approved" : "Rejected"}</span>}{!order.cancellation_request_status && !["delivered", "completed", "cancelled"].includes(order.status) && <button className="button secondary" onClick={() => requestCancellation(order)}>{order.status === "shipped" ? "Request Cancellation" : "Cancel Order"}</button>}</div></article>)}</div> : <div className="profile-empty">You have not placed any orders yet. <button className="text-button" onClick={() => setPage('products')}>Browse the collection</button></div>}</div></section>;
}
const ProductCard = CatalogueProductCard;
createRoot(document.getElementById('root')).render(<App />);
