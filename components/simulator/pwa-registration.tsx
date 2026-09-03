'use client';

import { useEffect } from 'react';
import { sitePath } from '@/lib/site-path';

export function PwaRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker.register(sitePath('/sw.js'));
    }
  }, []);
  return null;
}
