import { useEffect, useState } from 'react';
import { login, useStore } from '../store/store';
import { LuDelete } from 'react-icons/lu';
import { BrandMark } from '../components/ui';

export default function Login() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const settings = useStore((s) => s.settings);

  const press = (d: string) => {
    setError('');
    setPin((p) => (p.length < 4 ? p + d : p));
  };

  useEffect(() => {
    if (pin.length === 4) {
      const u = login(pin);
      if (!u) {
        setError('Wrong PIN');
        setPin('');
      }
    }
  }, [pin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app solo">
      <div className="login">
        <div className="card">
          <div className="login-brand">
            <BrandMark withName={false} />
            <div className="name">{settings.restaurantName}</div>
            <div className="muted">{settings.tagline}</div>
          </div>
          <h2 style={{ marginTop: 24, fontSize: 18 }}>Enter your PIN</h2>
          <div className="pin-dots">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={i < pin.length ? 'on' : ''} />
            ))}
          </div>
          <div className="error">{error}</div>
          <div className="keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} onClick={() => press(d)}>
                {d}
              </button>
            ))}
            <button onClick={() => setPin('')} aria-label="Clear">
              C
            </button>
            <button onClick={() => press('0')}>0</button>
            <button onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete last digit">
              <LuDelete aria-hidden="true" />
            </button>
          </div>
          <div className="hint">
            Demo PINs — Owner 1234 · Manager 2222 · Cashier 1111 · Kitchen 3333 · Attendant 4444
          </div>
        </div>
      </div>
    </div>
  );
}
