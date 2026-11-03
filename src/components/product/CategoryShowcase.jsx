import { useRef } from 'react';
import SafeImage from '../common/SafeImage.jsx';
import { CATEGORIES, CATEGORY_IMAGES } from '../../constants/catalogue.js';
import { imageUrl } from '../../services/api.js';

export default function CategoryShowcase({ products, selectedCategory = '', onSelectCategory }) {
  const trackRef = useRef(null);

  const moveTrack = (direction) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * track.clientWidth * 0.78, behavior: 'smooth' });
  };

  return <section className="category-showcase section" aria-labelledby="category-showcase-title">
    <div className="category-showcase-inner">
      <header className="category-showcase-heading">
        <div>
          <h2 id="category-showcase-title">Shop by material and ritual.</h2>
        </div>
        <div className="category-showcase-controls" aria-label="Scroll categories">
          <button type="button" aria-label="Scroll categories left" onClick={() => moveTrack(-1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button type="button" aria-label="Scroll categories right" onClick={() => moveTrack(1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      </header>
      <div className="category-showcase-all"><button type="button" className={!selectedCategory ? 'active' : ''} aria-pressed={!selectedCategory} onClick={() => onSelectCategory('')}>All products</button></div>
      <div className="category-showcase-track" ref={trackRef} role="group" aria-label="Handicraft product categories" tabIndex={0}>
        {CATEGORIES.map((category) => {
          const categoryProduct = products.find((product) => product.category === category && product.image_path);
          const image = categoryProduct ? imageUrl(categoryProduct.image_path) : CATEGORY_IMAGES[category];
          return <button className={`category-showcase-item${selectedCategory === category ? ' active' : ''}`} type="button" key={category} aria-pressed={selectedCategory === category} onClick={() => onSelectCategory(category)}>
            <span className="category-showcase-image"><SafeImage src={image} alt={`${category} handicrafts`} /></span>
            <span className="category-showcase-name">{category}</span>
          </button>;
        })}
      </div>
    </div>
  </section>;
}
