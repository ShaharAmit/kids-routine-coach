import { RefObject, useEffect, useState } from 'react';

export function useVisibility<T extends HTMLElement>(
  ref: RefObject<T | null>,
  threshold = 0.75
): boolean {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting && entry.intersectionRatio >= threshold);
      },
      { threshold: [0.5, threshold] }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, threshold]);

  return isVisible;
}