import { OAuth2Client } from 'google-auth-library';
import type { Verifier } from './app.js';

/** Builds a verifier that checks Google ID tokens were issued for this client ID. */
export function googleVerifier(clientId: string): Verifier {
  const google = new OAuth2Client(clientId);
  return async idToken => {
    // Checks signature (Google's public keys), expiry, and audience.
    const ticket = await google.verifyIdToken({ idToken, audience: clientId });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email || !p.email_verified || !p.exp) throw new Error('unusable claims');
    return { sub: p.sub, email: p.email, name: p.name ?? p.email, picture: p.picture, exp: p.exp };
  };
}

export const clientIdFromEnv = () => {
  const id = process.env.GOOGLE_CLIENT_ID ?? process.env.VITE_GOOGLE_CLIENT_ID;
  if (!id) throw new Error('Set GOOGLE_CLIENT_ID (or VITE_GOOGLE_CLIENT_ID)');
  return id;
};
