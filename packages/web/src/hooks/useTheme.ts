import { useState, useCallback } from 'react';

export function useTheme() {
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem('kyberbot_theme') !== 'light';
  });

  const toggle = useCallback(() => {
    setIsDark(prev => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('kyberbot_theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('kyberbot_theme', 'light');
      }
      return next;
    });
  }, []);

  return { isDark, toggle };
}
