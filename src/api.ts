import { API, type User } from './auth';
import type { ApiPuzzle, Letters } from './types';

export class UnauthorizedError extends Error {}

async function call<T>(user: User, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${user.credential ?? ''}` },
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export const fetchRandomPuzzle = (user: User) => call<ApiPuzzle>(user, '/api/puzzles/random');

/** Asks the server, which holds the solution, whether the grid is correct. */
export async function verifySolution(user: User, puzzleId: string, letters: Letters): Promise<boolean> {
  const { solved } = await call<{ solved: boolean }>(user, `/api/puzzles/${encodeURIComponent(puzzleId)}/verify`, {
    method: 'POST',
    body: JSON.stringify({ letters }),
  });
  return solved;
}
