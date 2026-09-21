import { useCallback, useEffect, useState } from 'react';

// Hash routing (#/queue, #/game/:id): works on any static host without rewrite rules.
export const readRoute = () => window.location.hash.slice(1) || '/';
export const gameRoute = (matchId: string) => `/game/${matchId}`;
export const gameIdFromRoute = (route: string) => /^\/game\/(.+)$/.exec(route)?.[1];

export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) window.location.replace(`#${to}`);
    else window.location.hash = to;
  }, []);
  return [route, navigate] as const;
}
