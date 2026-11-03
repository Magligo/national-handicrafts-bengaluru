import { useRef } from 'react';
import SafeImage from '../common/SafeImage.jsx';
import { CATEGORIES } from '../../constants/catalogue.js';

const CATEGORY_SHOWCASE_IMAGES = {
  Brass: { src: '/assets/categories/brass-products.webp', fallback: '/assets/categories/brass-products.webp.png' },
  Copper: { src: '/assets/categories/copper-products.webp', fallback: '/assets/categories/copper-products.webp.png' },
  'Decorative Handicrafts': { src: '/assets/categories/decorative-handicrafts.webp', fallback: '/assets/categories/decorative-handicrafts.webp.png' },
  'Dining & Thali Sets': { src: '/assets/categories/dinner-thali-sets.webp', fallback: '/assets/categories/dinner-thali-sets.webp.png' },
  'Puja Articles': { src: '/assets/categories/puja-articles.webp', fallback: '/assets/categories/puja-articles.webp.png' },
};

export default function CategoryShowcase({ products, selectedCategory = '', onSelectCategory }) {
  const trackRef = useRef(null);

  return <section className="category-showcase section" aria-labelledby="category-showcase-title">
    <div className="category-showcase-inner">
      <header className="category-showcase-heading">
        <h2 id="category-showcase-title">Shop By Category</h2>
      </header>
      <div className="category-showcase-track" ref={trackRef} role="group" aria-label="Handicraft product categories" tabIndex={0}>
        {CATEGORIES.map((category) => {
          const image = CATEGORY_SHOWCASE_IMAGES[category];
          return <button className={`category-showcase-item${selectedCategory === category ? ' active' : ''}`} type="button" key={category} aria-pressed={selectedCategory === category} onClick={() => onSelectCategory(category)}>
            <span className="category-showcase-image"><SafeImage src={image.src} fallbackSrc={image.fallback} alt={`${category} handicrafts`} /></span>
            <span className="category-showcase-name">{category}</span>
          </button>;
        })}
      </div>
    </div>
  </section>;
}
