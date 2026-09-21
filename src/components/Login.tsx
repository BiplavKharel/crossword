import { useEffect, useRef, useState } from 'react';
import { CLIENT_ID, guestUser, loadGsi, verifyCredential, type User } from '../auth';

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const button = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const clientId = CLIENT_ID;
    if (!clientId) return;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !button.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: r => {
            setError('');
            verifyCredential(r.credential).then(onLogin).catch(e => setError(e.message));
          },
        });
        button.current.innerHTML = '';
        window.google.accounts.id.renderButton(button.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 280 });
      })
      .catch(e => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [onLogin]);

  return (
    <div className="login">
      <div className="login-card">
        <h1>Cross<em>Duel</em></h1>
        <p>Race a friend to finish the same 5×5 crossword.</p>
        {CLIENT_ID ? (
          <div ref={button} className="google-btn" />
        ) : (
          <p className="login-note">
            Google sign-in isn't configured. Set <code>PUBLIC_GOOGLE_CLIENT_ID</code> in <code>.env.local</code> and restart.
          </p>
        )}
        {error && <p className="login-error">{error}</p>}
        {import.meta.env.DEV && <button className="ghost-btn" onClick={() => onLogin(guestUser())}>Continue as guest (dev only)</button>}
      </div>
    </div>
  );
}
