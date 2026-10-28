import { useEffect } from 'react';

function scrollWindowToTop() {
  try {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  } catch {
    // Older browsers may only support the positional overload.
    window.scrollTo(0, 0);
  }

  // Keep the document scroll position in sync in browsers that need it.
  if (document.scrollingElement && document.scrollingElement.scrollTop !== 0) {
    document.scrollingElement.scrollTop = 0;
  }
}

export default function ScrollToTop({ page, pathname, navigationKey }) {
  useEffect(() => {
    scrollWindowToTop();
  }, [page, pathname, navigationKey]);

  return null;
}
