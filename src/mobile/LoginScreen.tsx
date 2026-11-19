import { useState } from 'react';
import type { ReactElement, SyntheticEvent } from 'react';
import './LoginScreen.css';

interface LoginScreenProps {
  onSubmit: (key: string) => Promise<void>;
}

export function LoginScreen({ onSubmit }: LoginScreenProps): ReactElement {
  const [key, setKey] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    setBusy(true);
    setError(null);
    onSubmit(key.trim())
      .catch((reason: unknown): void => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally((): void => {
        setBusy(false);
      });
  }

  return (
    <form className="login-screen" onSubmit={submit}>
      <h1 className="login-screen__title">Agenten Verwalter</h1>
      <p className="login-screen__hint">
        Schlüssel aus <code>%USERPROFILE%\.verwalter\handy-schluessel.txt</code> auf dem PC.
      </p>
      <input
        className="login-screen__input"
        value={key}
        onChange={(event): void => {
          setKey(event.target.value);
        }}
        placeholder="Schlüssel"
        autoComplete="current-password"
        type="password"
      />
      <button className="login-screen__button" type="submit" disabled={busy || key.trim() === ''}>
        Anmelden
      </button>
      {error !== null && <p className="login-screen__error">{error}</p>}
    </form>
  );
}
