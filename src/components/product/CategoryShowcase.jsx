import { useRef } from 'react';
import SafeImage from '../common/SafeImage.jsx';
import { CUSTOMER_CATEGORIES } from '../../constants/catalogue.js';

const CATEGORY_SHOWCASE_IMAGES = {
  Brass: '/assets/categories/brass-products.webp.png',
  'Decorative Handicrafts': '/assets/categories/decorative-handicrafts.webp.png',
  'Dining & Thali Sets': '/assets/categories/dinner-thali-sets.webp.png',
  'Puja Articles': '/assets/categories/puja-articles.webp.png',
};

export default function CategoryShowcase({ products, selectedCategory = '', onSelectCategory }) {
  const trackRef = useRef(null);

  return <section className="category-showcase section" aria-labelledby="category-showcase-title">
    <div className="category-showcase-inner">
      <header className="category-showcase-heading">
        <h2 id="category-showcase-title">Shop By Category</h2>
      </header>
      <div className="category-showcase-track" ref={trackRef} role="group" aria-label="Handicraft product categories" tabIndex={0}>
        {CUSTOMER_CATEGORIES.map((category, index) => {
          const image = CATEGORY_SHOWCASE_IMAGES[category];
          return <button className={`category-showcase-item${selectedCategory === category ? ' active' : ''}`} type="button" key={category} aria-pressed={selectedCategory === category} onClick={() => onSelectCategory(category)}>
            <span className="category-showcase-image"><SafeImage src={image} alt={`${category} handicrafts`} loading={index === 0 ? 'eager' : 'lazy'} fetchPriority={index === 0 ? 'high' : 'auto'} width={320} height={400} /></span>
            <span className="category-showcase-name">{category}</span>
          </button>;
        })}
      </div>
    </div>
  </section>;
}
