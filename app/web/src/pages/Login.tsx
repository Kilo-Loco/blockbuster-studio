import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { Button } from '../components/ui';

export default function Login() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.login(password);
      navigate('/', { replace: true });
    } catch {
      setError('Incorrect password.');
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

        <div className="rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)]/90 p-6 shadow-2xl backdrop-blur">
          <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-[var(--color-ink-2)]">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-3 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-3 py-2.5 text-sm text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/60"
            placeholder="••••••••"
          />
          {error && <p className="mb-3 text-xs text-[var(--color-danger)]">{error}</p>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
            Enter the studio
          </Button>
        </div>
        <p className="mt-5 text-center text-xs leading-relaxed text-[var(--color-ink-3)]">
          The password is set by <span className="chip-mono">STUDIO_PASSWORD</span>, or printed in the pod logs / <span className="chip-mono">/workspace/studio/PASSWORD.txt</span>
        </p>
      </form>
    </div>
  );
}
