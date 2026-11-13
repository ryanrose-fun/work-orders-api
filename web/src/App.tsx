import { useState } from 'react';
import { ApiError, request, transitions, type Order, type Status } from './api';

const PAGE_SIZE = 12;
const message = (error: unknown) => error instanceof ApiError && error.status === 401
  ? 'Your session token was rejected. Disconnect and enter the API token again.'
  : error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function OrderCard({ order, token, onUpdate }: { order: Order; token: string; onUpdate: (order: Order) => void }) {
  const [target, setTarget] = useState<Status | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  async function save() {
    if (!target || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await request<Order>(token, `/orders/${order.id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: target, expected_version: order.version }),
      });
      onUpdate(updated); setTarget(''); setNotice('Status saved.'); setConflict(false);
    } catch (e) {
      setError(message(e)); setConflict(e instanceof ApiError && e.status === 409);
    } finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError('');
    try {
      const latest = await request<Order>(token, `/orders/${order.id}`);
      onUpdate(latest); setConflict(false);
      setNotice(`Loaded version ${latest.version}. Review the current status before saving again.`);
      if (target && !transitions[latest.status].includes(target)) setTarget('');
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <article className="order-card">
    <div className="card-top"><span className={`status ${order.status}`}>{order.status}</span><span className="version">v{order.version}</span></div>
    <h3>{order.title}</h3><code title={order.id}>{order.id.slice(0, 8)}</code>
    <div className="card-controls">
      {transitions[order.status].length > 0 ? <>
        <label className="sr-only" htmlFor={`status-${order.id}`}>Next status for {order.title}</label>
        <select id={`status-${order.id}`} value={target} onChange={e => setTarget(e.target.value as Status)} disabled={busy}>
          <option value="">Choose status…</option>{transitions[order.status].map(s => <option key={s}>{s}</option>)}
        </select><button onClick={save} disabled={!target || busy || conflict}>{busy ? 'Working…' : 'Save'}</button>
      </> : <span className="terminal">Closed · no further transitions</span>}
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {conflict && <div className="conflict"><p>Your change has not overwritten anyone else’s work.</p><button onClick={reload} disabled={busy}>Reload latest version</button></div>}
    {notice && <p role="status" className="notice">{notice}</p>}
  </article>;
}

function Console({ token, initialOrders }: {token: string; initialOrders: Order[]}) {
  const [orders, setOrders] = useState(initialOrders);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [createError, setCreateError] = useState('');
  const [created, setCreated] = useState<Order | null>(null);
  async function load(next: number) {
    setLoading(true); setError('');
    try { setOrders(await request<Order[]>(token, `/orders?limit=${PAGE_SIZE}&offset=${next}`)); setOffset(next); setCreated(null); }
    catch (e) { setError(message(e)); } finally { setLoading(false); }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault(); setCreateError('');
    if (!title.trim() || title.trim().length > 200) { setCreateError('Enter a title between 1 and 200 characters.'); return; }
    setCreating(true);
    try {
      const order = await request<Order>(token, '/orders', { method: 'POST', body: JSON.stringify({ title: title.trim() }) });
      setTitle(''); setCreated(order);
    } catch (e) {
      setCreateError(e instanceof ApiError ? message(e) : 'Connection interrupted. The order may have been created. Check the list before trying again.');
    } finally { setCreating(false); }
  }
  const update = (updated: Order) => {
    setOrders(current => current.map(o => o.id === updated.id ? updated : o));
    setCreated(current => current?.id === updated.id ? updated : current);
  };
  return <>
    <section className="intro"><div><p className="eyebrow">OPERATIONS / WORK ORDERS</p><h1>Keep work moving.</h1><p>Create an order, move it forward, keep every update in sync.</p></div><button className="secondary" disabled={loading} onClick={() => load(offset)}>{loading ? 'Loading…' : 'Refresh orders'}</button></section>
    <section className="create-panel"><div><h2>New work order</h2><p>A clear title is all you need to start.</p></div><form onSubmit={create}><label htmlFor="title">Order title</label><div className="input-row"><input id="title" maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Inspect acquisition pipeline" disabled={creating}/><button disabled={creating}>{creating ? 'Creating…' : '+ Create order'}</button></div>{createError && <p role="alert" className="error">{createError}</p>}</form></section>
    {created && !orders.some(o => o.id === created.id) && <section className="created"><h2>Just created</h2><p role="status">Saved to the API. Refresh the list to include it in pagination.</p><OrderCard order={created} token={token} onUpdate={update}/></section>}
    <section aria-label="Work orders" aria-busy={loading}><div className="section-heading"><h2>Order register</h2><span>{orders.length} on this page</span></div>
      {error && <p role="alert" className="error">{error}</p>}
      {!orders.length && <div className="empty"><h3>No orders on this page</h3><p>Create your first order or return to the previous page.</p></div>}
      <div className="order-grid">{orders.map(o => <OrderCard key={`${offset}-${o.id}`} order={o} token={token} onUpdate={update}/>)}</div>
      <nav className="pagination" aria-label="Order pages"><button className="secondary" disabled={loading || offset === 0} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>← Previous</button><span>Page {offset / PAGE_SIZE + 1}</span><button className="secondary" disabled={loading || orders.length < PAGE_SIZE} onClick={() => load(offset + PAGE_SIZE)}>Next →</button></nav>
    </section>
  </>;
}

export function App() {
  const [input, setInput] = useState('');
  const [session, setSession] = useState<{token: string; orders: Order[]} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function connect(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const orders = await request<Order[]>(input, `/orders?limit=${PAGE_SIZE}&offset=0`); setSession({token: input, orders}); setInput(''); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <div className="app"><header><a className="brand" href="/">◈ <strong>Work Orders</strong><span>Engineering demo</span></a>{session && <button className="secondary" onClick={() => setSession(null)}>Disconnect</button>}</header><main>
    {session ? <Console token={session.token} initialOrders={session.orders}/> : <section className="login"><p className="eyebrow">FASTAPI + REACT + TYPESCRIPT</p><h1>Your operations,<br/>in order.</h1><p>A small, working console with real validation and safe concurrent updates.</p><form onSubmit={connect}><label htmlFor="token">API token</label><input id="token" type="password" autoComplete="off" required value={input} onChange={e => setInput(e.target.value)}/><p className="muted">Held in memory for this tab only. Reloading disconnects you.</p><button disabled={busy}>{busy ? 'Connecting…' : 'Open console →'}</button>{error && <p role="alert" className="error">{error}</p>}</form></section>}
  </main><footer>Synthetic work orders · Version-checked updates · No customer data</footer></div>;
}
