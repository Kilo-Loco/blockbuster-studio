import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { Button } from '../components/ui';

// Three states, from /api/session:
//  - claimed:            normal password login
//  - unclaimed + open:   first visit, create the studio password (setup window after pod start)
//  - unclaimed + closed: nobody claimed it in time; explain how to reopen setup
type Mode = 'loading' | 'login' | 'setup' | 'locked';

const MIN_LENGTH = 8;

const inputClass =
  'mb-3 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2.5 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/60';

export default function Login() {
  const [mode, setMode] = useState<Mode>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .session()
      .then((s) => {
        if (s.authenticated) navigate('/', { replace: true });
        else setMode(s.claimed ? 'login' : s.setupOpen ? 'setup' : 'locked');
      })
      .catch(() => setMode('login'));
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'setup') {
      if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
      if (password !== confirm) return setError("The passwords don't match.");
    }
    setLoading(true);
    try {
      if (mode === 'setup') await api.setup(password);
      else await api.login(password);
      navigate('/', { replace: true });
    } catch (err) {
      if (mode === 'setup') {
        setError(err instanceof Error ? err.message : 'Could not save the password.');
        // Someone else claimed it, or the window just closed: show the matching screen.
        api.session().then((s) => setMode(s.claimed ? 'login' : s.setupOpen ? 'setup' : 'locked')).catch(() => {});
      } else {
        setError('Incorrect password.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[var(--color-bg-0)] film-grain vignette">
      <div
        className="absolute inset-0 opacity-40"
        style={{ background: 'radial-gradient(ellipse 900px 500px at 50% 20%, color-mix(in srgb, var(--color-amber-500) 18%, transparent), transparent)' }}
      />
      <form onSubmit={onSubmit} className="relative z-10 w-full max-w-sm px-6">
        <h1 className="mb-1 text-center font-serif text-5xl tracking-wide text-[var(--color-ink-0)]">BLOCKBUSTER</h1>
        <p className="mb-8 text-center text-xs uppercase tracking-[0.3em] text-[var(--color-ink-3)]">Studio</p>

        {mode === 'loading' ? (
          <div className="mx-auto size-8 animate-spin rounded-full border-2 border-white/10 border-t-[var(--color-amber-400)]" />
        ) : mode === 'locked' ? (
          <div className="rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)]/90 p-6 shadow-2xl backdrop-blur">
            <h2 className="mb-2 text-base font-semibold text-[var(--color-ink-0)]">Setup is locked</h2>
            <p className="mb-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
              For safety, a new studio can only be claimed in the first 15 minutes after the pod starts, and nobody set a
              password in time.
            </p>
            <p className="text-sm leading-relaxed text-[var(--color-ink-2)]">
              In Runpod, <strong className="text-[var(--color-ink-0)]">restart the pod</strong> and open this page again, or
              use <strong className="text-[var(--color-ink-0)]">Edit Pod</strong> to set{' '}
              <span className="chip-mono">STUDIO_PASSWORD</span>. Your models and films are kept either way.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)]/90 p-6 shadow-2xl backdrop-blur">
              {mode === 'setup' && (
                <>
                  <h2 className="mb-1 text-base font-semibold text-[var(--color-ink-0)]">Create your password</h2>
                  <p className="mb-4 text-xs leading-relaxed text-[var(--color-ink-3)]">
                    Your studio is on the public internet. This password is the only thing that keeps others out.
                  </p>
                </>
              )}
              <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-[var(--color-ink-2)]">
                {mode === 'setup' ? 'New password' : 'Password'}
              </label>
              <input
                id="password"
                type="password"
                autoFocus
                autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder={mode === 'setup' ? `At least ${MIN_LENGTH} characters` : '••••••••'}
              />
              {mode === 'setup' && (
                <>
                  <label htmlFor="confirm" className="mb-1.5 block text-xs font-medium text-[var(--color-ink-2)]">
                    Confirm password
                  </label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={inputClass}
                  />
                </>
              )}
              {error && <p className="mb-3 text-xs text-[var(--color-danger)]">{error}</p>}
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
                {mode === 'setup' ? 'Create password & enter' : 'Enter the studio'}
              </Button>
            </div>
            <p className="mt-5 text-center text-xs leading-relaxed text-[var(--color-ink-3)]">
              {mode === 'setup' ? (
                'Your browser can save it for you.'
              ) : (
                <>
                  Forgot it? In Runpod, use <strong>Edit Pod</strong> to set{' '}
                  <span className="chip-mono">STUDIO_PASSWORD</span> to a new one.
                </>
              )}
            </p>
          </>
        )}
      </form>
    </div>
  );
}
