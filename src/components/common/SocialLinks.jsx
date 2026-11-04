import { socialLinks } from '../../config/socialLinks.js';

export default function SocialLinks({ className = '' }) {
  return (
    <div className={`social-links ${className}`.trim()} aria-label="Social media">
      {Object.values(socialLinks).map(({ label, image, url }) => {
        const icon = <img src={image} alt={`${label} logo`} />;
        return url ? (
          <a key={label} href={url} target="_blank" rel="noopener noreferrer" aria-label={`Visit us on ${label}`}>
            {icon}
          </a>
        ) : (
          <span key={label}>{icon}</span>
        );
      })}
    </div>
  );
}
