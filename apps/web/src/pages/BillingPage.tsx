import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Notice } from '../components/ui';

interface Product { id: string; title: string; runs: number; price_rub: number; price_stars: number }
interface Ledger { balance: number; items: { delta: number; reason: string; at: string; note: string | null }[] }

const REASON: Record<string, string> = {
  purchase: 'Покупка', promo: 'Промокод', admin_grant: 'Начисление', run_reserve: 'Разбор', run_release: 'Возврат разбора', refund: 'Возврат платежа',
};

export function BillingPage() {
  const { me, refresh } = useAuth();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const mockId = params.get('mock_payment');

  const load = () => { void api<Ledger>('/me/ledger').then(setLedger); };
  useEffect(() => {
    api<{ products: Product[] }>('/products').then((r) => setProducts(r.products));
    load();
  }, []);

  async function buy(id: string) {
    try {
      const r = await api<{ confirmation_url: string }>('/payments/yookassa', { json: { product_id: id } });
      window.location.href = r.confirmation_url;
    } catch (e) { setMsg({ kind: 'error', text: errorText(e) }); }
  }

  async function confirmMock() {
    await api(`/payments/mock/${mockId}/succeed`, { method: 'POST' });
    setParams({});
    setMsg({ kind: 'ok', text: 'Тестовая оплата прошла, разборы начислены.' });
    await refresh(); load();
  }

  async function redeem(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ granted_runs: number; kind: string }>('/promo/redeem', { json: { code } });
      setMsg({ kind: 'ok', text: r.granted_runs ? `Начислено разборов: ${r.granted_runs}` : 'Скидка применится к следующей покупке' });
      setCode('');
      await refresh(); load();
    } catch (err) { setMsg({ kind: 'error', text: errorText(err) }); }
  }

  return (
    <div className="page">
      <header className="page-head"><div><h1>Разборы</h1>
        <p className="lead">Один разбор — один чат Telegram или TikTok целиком (история, активность и один чат). Повторный разбор того же чата 30 дней бесплатен.</p></div></header>
      {params.get('paid') && <Notice kind="ok">Спасибо! Разборы появятся на балансе сразу после подтверждения оплаты.</Notice>}
      {mockId && <Notice>Локальный режим: <button className="link-btn" onClick={() => void confirmMock()}>подтвердить тестовую оплату</button></Notice>}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <div className="kpis"><div className="kpi"><div className="kpi-value">{me?.role === 'admin' ? '∞' : ledger?.balance ?? me?.balance}</div><div className="kpi-label">разборов на балансе</div></div></div>

      <div className="products">
        {products.map((p) => (
          <div key={p.id} className="product">
            <div className="product-title">{p.title}</div>
            <div className="product-price">{p.price_rub} ₽</div>
            <div className="muted small">{Math.round(p.price_rub / p.runs)} ₽ за разбор · в боте — {p.price_stars} ⭐</div>
            <button className="btn" onClick={() => void buy(p.id)}>Купить</button>
          </div>
        ))}
      </div>

      <form className="row gap promo" onSubmit={redeem}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Промокод" maxLength={40} required />
        <button className="btn ghost">Применить</button>
      </form>

      {ledger && ledger.items.length > 0 && (
        <section className="block">
          <h2>История</h2>
          <div className="table-wrap"><table><thead><tr><th>Когда</th><th>Что</th><th>Разборов</th></tr></thead><tbody>
            {ledger.items.map((x, i) => <tr key={i}><td>{new Date(x.at).toLocaleString('ru-RU')}</td><td>{REASON[x.reason] ?? x.reason}{x.note ? ` · ${x.note}` : ''}</td><td>{x.delta > 0 ? '+' : ''}{x.delta}</td></tr>)}
          </tbody></table></div>
        </section>
      )}
    </div>
  );
}
