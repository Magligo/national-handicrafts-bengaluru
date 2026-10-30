import SafeImage from '../common/SafeImage.jsx';
import { formatPrice, imageUrl } from '../../services/api.js';

export default function ProductCard({ product, openProduct, addToCart, buyNow }) {
  const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
  const canBuy = !hasVariants && product.stock !== 0 && product.price_inr != null;
  const open = () => openProduct(product.id);
  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };

  return <article className="product-card" tabIndex="0" role="link" onClick={open} onKeyDown={onKeyDown}>
    <div className="product-image"><SafeImage src={imageUrl(product.image_path)} alt={product.name} /></div>
    <div className="product-meta"><p className="eyebrow">{product.category}</p><h3>{product.name}</h3><div className="product-bottom"><span>{hasVariants ? 'Choose an option' : formatPrice(product.price_inr)}</span><small>{hasVariants ? `${product.variants.length} options` : product.stock === 0 ? 'Out of stock' : 'Available'}</small></div><div className="card-actions"><button className="button secondary card-action" disabled={!hasVariants && !canBuy} onClick={(event) => { event.stopPropagation(); if (hasVariants) open(); else addToCart(product, event.currentTarget); }}>{hasVariants ? 'Choose options' : 'Add to cart'}</button><button className="button primary card-action" disabled={!hasVariants && !canBuy} onClick={(event) => { event.stopPropagation(); if (hasVariants) open(); else buyNow(product); }}>{hasVariants ? 'Choose options' : canBuy ? 'Buy now' : 'Unavailable'}</button></div></div>
  </article>;
}
