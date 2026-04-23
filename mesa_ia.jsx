import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ScatterChart, Scatter, ReferenceDot, BarChart, Bar, Cell
} from 'recharts';
import {
  Activity, TrendingUp, TrendingDown, RefreshCw, Send, Sparkles,
  Circle, AlertCircle, Loader2, Zap, ArrowUp, ArrowDown, DollarSign
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const POLL_INTERVAL = 20000;

const ENDPOINTS = {
  bonds: 'https://data912.com/live/arg_bonds',
  notes: 'https://data912.com/live/arg_notes',
  dolares: 'https://dolarapi.com/v1/dolares'
};

// Metadata de soberanos hard-dollar post-reestructuración 2020
const BOND_META = {
  'AL29':  { mat: '2029-07-09', ccy: 'USD', law: 'Local', coupon: 1.0 },
  'AL30':  { mat: '2030-07-09', ccy: 'USD', law: 'Local', coupon: 0.75 },
  'AL35':  { mat: '2035-07-09', ccy: 'USD', law: 'Local', coupon: 3.625 },
  'AE38':  { mat: '2038-01-09', ccy: 'USD', law: 'Local', coupon: 4.25 },
  'AL41':  { mat: '2041-07-09', ccy: 'USD', law: 'Local', coupon: 3.5 },
  'GD29':  { mat: '2029-07-09', ccy: 'USD', law: 'NY',    coupon: 1.0 },
  'GD30':  { mat: '2030-07-09', ccy: 'USD', law: 'NY',    coupon: 0.75 },
  'GD35':  { mat: '2035-07-09', ccy: 'USD', law: 'NY',    coupon: 3.625 },
  'GD38':  { mat: '2038-01-09', ccy: 'USD', law: 'NY',    coupon: 4.25 },
  'GD41':  { mat: '2041-07-09', ccy: 'USD', law: 'NY',    coupon: 3.5 },
  'GD46':  { mat: '2046-07-09', ccy: 'USD', law: 'NY',    coupon: 3.625 }
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const fetchSafe = async (url) => {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error();
    return await r.json();
  } catch {
    const r = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
    if (!r.ok) throw new Error(`fetch failed: ${url}`);
    return await r.json();
  }
};

const fmt = (n, d = 2) => {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
};

const fmtPct = (n, d = 2) => {
  if (n == null || isNaN(n)) return '—';
  const s = n > 0 ? '+' : '';
  return `${s}${fmt(n, d)}%`;
};

const yearsTo = (matStr) => {
  if (!matStr) return null;
  const d = new Date(matStr);
  return (d - new Date()) / (1000 * 60 * 60 * 24 * 365.25);
};

// TIR aproximada para soberanos USD (current yield + pull-to-par annualizado).
// Metodología rough. Para TIR exacta habría que descontar flujos.
const roughYTM = (price, yearsLeft, coupon = 3.5) => {
  if (!price || !yearsLeft || yearsLeft <= 0) return null;
  const pullToPar = ((100 - price) / price) / yearsLeft * 100;
  const currentYield = (coupon / price) * 100;
  return currentYield + pullToPar;
};

// Mod duration rough (Macaulay aprox para bullet) — solo referencial
const roughDuration = (yearsLeft, ytm, coupon) => {
  if (!yearsLeft || !ytm) return null;
  const y = ytm / 100;
  // aproximación simplificada
  return yearsLeft / (1 + y * 0.5);
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function MesaIA() {
  // ─── Data state ──────────────────────────────────────────────────────────
  const [bonds, setBonds] = useState([]);
  const [notes, setNotes] = useState([]);
  const [dolares, setDolares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [err, setErr] = useState(null);
  const [isFetching, setIsFetching] = useState(false);

  // ─── UI state ────────────────────────────────────────────────────────────
  const [tab, setTab] = useState('soberanos');
  const [now, setNow] = useState(new Date());
  const [sortKey, setSortKey] = useState('yearsLeft');
  const [sortDir, setSortDir] = useState('asc');

  // ─── Chat state ──────────────────────────────────────────────────────────
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // ─── Clock tick ──────────────────────────────────────────────────────────
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  // ─── Data fetch ──────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setIsFetching(true);
    try {
      const [b, n, d] = await Promise.allSettled([
        fetchSafe(ENDPOINTS.bonds),
        fetchSafe(ENDPOINTS.notes),
        fetchSafe(ENDPOINTS.dolares)
      ]);
      if (b.status === 'fulfilled') setBonds(b.value || []);
      if (n.status === 'fulfilled') setNotes(n.value || []);
      if (d.status === 'fulfilled') setDolares(d.value || []);
      setLastUpdate(new Date());
      setErr(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
      setTimeout(() => setIsFetching(false), 400);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, POLL_INTERVAL);
    return () => clearInterval(i);
  }, [fetchAll]);

  // ─── Process sovereigns ──────────────────────────────────────────────────
  const sovereignBonds = useMemo(() => {
    if (!bonds.length) return [];
    return bonds
      .filter(b => b.symbol && BOND_META[b.symbol])
      .map(b => {
        const m = BOND_META[b.symbol];
        const yl = yearsTo(m.mat);
        const tir = roughYTM(b.c, yl, m.coupon);
        const dur = roughDuration(yl, tir, m.coupon);
        return {
          symbol: b.symbol,
          price: b.c,
          chg: b.pct_change ?? b.variation ?? null,
          bid: b.px_bid ?? null,
          ask: b.px_ask ?? null,
          vol: b.q_op ?? b.volume ?? null,
          yearsLeft: yl,
          tir,
          dur,
          law: m.law,
          coupon: m.coupon,
          mat: m.mat
        };
      });
  }, [bonds]);

  const sortedSov = useMemo(() => {
    const arr = [...sovereignBonds];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [sovereignBonds, sortKey, sortDir]);

  // ─── Process LECAPs ──────────────────────────────────────────────────────
  const lecaps = useMemo(() => {
    if (!notes.length) return [];
    return notes
      .filter(n => n.symbol && n.c)
      .map(n => ({
        symbol: n.symbol,
        price: n.c,
        chg: n.pct_change ?? n.variation ?? null,
        bid: n.px_bid ?? null,
        ask: n.px_ask ?? null,
        vol: n.q_op ?? n.volume ?? null
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [notes]);

  // ─── Dólar summary ───────────────────────────────────────────────────────
  const dolarBy = useMemo(() => {
    const m = {};
    dolares.forEach(d => { m[d.casa] = d; });
    return m;
  }, [dolares]);

  const dolarCards = [
    { key: 'oficial', label: 'OFICIAL', data: dolarBy.oficial },
    { key: 'mayorista', label: 'MAYORISTA', data: dolarBy.mayorista },
    { key: 'bolsa', label: 'MEP', data: dolarBy.bolsa },
    { key: 'contadoconliqui', label: 'CCL', data: dolarBy.contadoconliqui },
    { key: 'blue', label: 'BLUE', data: dolarBy.blue },
    { key: 'cripto', label: 'CRIPTO', data: dolarBy.cripto },
    { key: 'tarjeta', label: 'TARJETA', data: dolarBy.tarjeta }
  ].filter(x => x.data);

  // Brecha cambiaria
  const brecha = useMemo(() => {
    const of = dolarBy.oficial?.venta;
    const mep = dolarBy.bolsa?.venta;
    const ccl = dolarBy.contadoconliqui?.venta;
    if (!of) return {};
    return {
      mep: mep ? ((mep / of) - 1) * 100 : null,
      ccl: ccl ? ((ccl / of) - 1) * 100 : null
    };
  }, [dolarBy]);

  // TIR avg + stats soberanos
  const sovStats = useMemo(() => {
    const withTir = sovereignBonds.filter(b => b.tir != null);
    if (!withTir.length) return null;
    const avg = withTir.reduce((s, b) => s + b.tir, 0) / withTir.length;
    const max = withTir.reduce((m, b) => b.tir > m.tir ? b : m, withTir[0]);
    const min = withTir.reduce((m, b) => b.tir < m.tir ? b : m, withTir[0]);
    return { avg, max, min, count: withTir.length };
  }, [sovereignBonds]);

  // ─── Scroll chat ─────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // ─── AI call ─────────────────────────────────────────────────────────────
  const askAI = async (question) => {
    if (!question.trim() || chatLoading) return;
    const q = question.trim();
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setInput('');
    setChatLoading(true);

    const ctx = {
      timestamp: now.toISOString(),
      soberanos_usd: sovereignBonds.map(b => ({
        symbol: b.symbol,
        precio: b.price,
        tir_aprox_pct: b.tir?.toFixed(2),
        anios_al_vto: b.yearsLeft?.toFixed(2),
        ley: b.law,
        cupon_pct: b.coupon,
        chg_pct: b.chg
      })),
      lecaps: lecaps.slice(0, 20).map(l => ({
        symbol: l.symbol,
        precio: l.price,
        chg_pct: l.chg
      })),
      dolares: {
        oficial_venta: dolarBy.oficial?.venta,
        mayorista_venta: dolarBy.mayorista?.venta,
        mep_venta: dolarBy.bolsa?.venta,
        ccl_venta: dolarBy.contadoconliqui?.venta,
        blue_venta: dolarBy.blue?.venta,
        cripto_venta: dolarBy.cripto?.venta,
        brecha_mep_pct: brecha.mep?.toFixed(1),
        brecha_ccl_pct: brecha.ccl?.toFixed(1)
      }
    };

    const sys = `Sos un analista financiero senior de un ALyC argentino, experto en mercado de capitales local (BYMA, MERVAL, MAE). Hablás Rioplatense. Sos directo, técnico y concreto. Usás vocabulario de mesa: TIR, paridad, duration, pull-to-par, canje, MEP, CCL, TEM, spread, curve, etc.

Tenés datos live del mercado argentino que se te pasan en cada turno. Estilo:
- Citá números específicos del CONTEXTO
- Respondé como chat de mesa: conciso, máx 180 palabras
- NO uses disclaimers legales ("esto no es consejo de inversión")
- NO uses bullets ni headers markdown excesivos; escribí como trader experto chateando
- Podés usar negritas con ** para destacar tickers/números clave
- Si el dato no está en el contexto, decilo sin vueltas
- Aclará cuando una TIR es aproximada (el contexto las marca como "aprox")

CONTEXTO MERCADO (live):
${JSON.stringify(ctx, null, 2)}`;

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: sys,
          messages: [
            ...messages.slice(-8).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: q }
          ]
        })
      });
      const data = await resp.json();
      const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || 'Error al procesar respuesta.';
      setMessages(prev => [...prev, { role: 'assistant', content: text }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠ Error API: ${e.message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ─── Clock formatters ────────────────────────────────────────────────────
  const timeStr = now.toLocaleTimeString('es-AR', { hour12: false });
  const dateStr = now.toLocaleDateString('es-AR', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  }).toUpperCase();

  const marketOpen = (() => {
    const h = now.getHours(), m = now.getMinutes(), day = now.getDay();
    const mins = h * 60 + m;
    return day >= 1 && day <= 5 && mins >= 660 && mins < 1020; // 11:00 - 17:00
  })();

  const quickQs = [
    '¿Dónde hay valor en la curva hard-dollar hoy?',
    'Analizá el spread GD vs AL (ley NY vs local)',
    '¿Qué pasa con el MEP/CCL y la brecha?',
    'Pickeá la mejor LECAP por relación precio/plazo'
  ];

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-200" style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@400;500;600;700&display=swap');

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
        @keyframes scan {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.0); }
          50% { box-shadow: 0 0 12px 2px rgba(245,158,11,0.25); }
        }
        @keyframes flash-bg {
          0% { background-color: rgba(245,158,11,0.15); }
          100% { background-color: transparent; }
        }
        @keyframes cursor-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        .pulse-dot { animation: pulse-dot 1.8s ease-in-out infinite; }
        .glow-amber { animation: glow 3s ease-in-out infinite; }
        .flash-new { animation: flash-bg 1.5s ease-out; }
        .cursor-blink::after { content: '▊'; animation: cursor-blink 1s infinite; color: #f59e0b; margin-left: 2px; }
        .scanline::before {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(transparent, rgba(245,158,11,0.03), transparent);
          height: 20%;
          animation: scan 8s linear infinite;
          pointer-events: none;
        }
        .font-display { font-family: 'IBM Plex Sans Condensed', sans-serif; letter-spacing: 0.02em; }
        .tabular { font-variant-numeric: tabular-nums; }
        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #0f172a; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 0; }
        ::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}</style>

      {/* ═══════════════════════════════════════════════════════════════════
          HEADER BAR — Bloomberg-style masthead
          ═══════════════════════════════════════════════════════════════════ */}
      <header className="border-b-2 border-amber-500/60 bg-slate-950 relative">
        <div className="px-6 py-3 flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-amber-500 flex items-center justify-center">
                <span className="text-slate-950 font-bold text-lg font-display">M</span>
              </div>
              <div className="flex flex-col leading-none">
                <span className="text-amber-500 font-bold text-[13px] tracking-[0.2em] font-display">MESA IA</span>
                <span className="text-slate-500 text-[10px] tracking-widest">AR CAPITAL MARKETS</span>
              </div>
            </div>
            <div className="h-8 w-px bg-slate-800"/>
            <div className="flex items-center gap-2 text-[11px]">
              <Circle className={`w-2 h-2 ${marketOpen ? 'fill-emerald-400 text-emerald-400 pulse-dot' : 'fill-rose-500 text-rose-500'}`}/>
              <span className={marketOpen ? 'text-emerald-400' : 'text-rose-400'}>
                {marketOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500">BYMA</span>
            </div>
          </div>

          <div className="flex items-center gap-6 text-[11px]">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">LAST</span>
              <span className="text-slate-300 tabular">
                {lastUpdate ? lastUpdate.toLocaleTimeString('es-AR', { hour12: false }) : '--:--:--'}
              </span>
              {isFetching && <Loader2 className="w-3 h-3 text-amber-500 animate-spin"/>}
            </div>
            <button
              onClick={fetchAll}
              className="flex items-center gap-1.5 px-2.5 py-1 border border-slate-800 hover:border-amber-500/60 hover:bg-slate-900 transition-colors text-slate-400 hover:text-amber-400"
            >
              <RefreshCw className="w-3 h-3"/>
              <span className="tracking-wider">REFRESH</span>
            </button>
            <div className="flex flex-col items-end leading-tight">
              <span className="text-amber-500 text-[18px] font-bold tabular">{timeStr}</span>
              <span className="text-slate-500 text-[10px] tracking-wider">{dateStr} · ART</span>
            </div>
          </div>
        </div>

        {/* Dólar strip */}
        <div className="border-t border-slate-900 bg-slate-950 overflow-hidden">
          <div className="px-6 py-1.5 flex items-center gap-6 text-[11px] overflow-x-auto">
            <span className="text-amber-500 font-bold tracking-widest shrink-0">FX · </span>
            {dolarCards.slice(0, 7).map(d => (
              <div key={d.key} className="flex items-center gap-2 shrink-0">
                <span className="text-slate-500 tracking-wider">{d.label}</span>
                <span className="text-slate-200 tabular font-semibold">
                  ${fmt(d.data?.venta, 2)}
                </span>
                {d.data?.variacion != null && (
                  <span className={`tabular ${d.data.variacion > 0 ? 'text-emerald-400' : d.data.variacion < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                    {fmtPct(d.data.variacion, 2)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </header>

      {err && (
        <div className="bg-rose-950/40 border-b border-rose-800/60 px-6 py-2 text-rose-300 text-[11px] flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5"/> API error: {err} — reintentando...
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          MAIN GRID
          ═══════════════════════════════════════════════════════════════════ */}
      <main className="grid grid-cols-12 gap-0 min-h-[calc(100vh-76px)]">

        {/* ─── LEFT: DATA PANELS ──────────────────────────────────────── */}
        <section className="col-span-12 lg:col-span-7 border-r border-slate-900 relative">
          {/* Tabs */}
          <div className="flex border-b border-slate-900 bg-slate-950 sticky top-0 z-20">
            {[
              { k: 'soberanos', l: 'SOBERANOS USD', ic: TrendingUp },
              { k: 'lecaps',    l: 'LECAPS / BONCAPS', ic: Activity },
              { k: 'curva',     l: 'CURVA', ic: Zap },
              { k: 'dolar',     l: 'DÓLARES', ic: DollarSign }
            ].map(({ k, l, ic: Ic }) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`relative px-5 py-3 text-[11px] tracking-[0.15em] flex items-center gap-2 transition-colors ${
                  tab === k
                    ? 'text-amber-400 bg-slate-900'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900/50'
                }`}
              >
                <Ic className="w-3.5 h-3.5"/>
                <span className="font-semibold">{l}</span>
                {tab === k && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-500"/>}
              </button>
            ))}
          </div>

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-32 text-slate-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin mr-3 text-amber-500"/>
              Conectando al mercado...
            </div>
          )}

          {/* ═══ TAB: SOBERANOS ═══ */}
          {!loading && tab === 'soberanos' && (
            <div className="p-5 space-y-5">
              {/* Stats strip */}
              {sovStats && (
                <div className="grid grid-cols-4 gap-3">
                  <StatCard
                    label="TIR PROMEDIO"
                    value={`${fmt(sovStats.avg, 1)}%`}
                    sub={`${sovStats.count} bonos`}
                    tone="amber"
                  />
                  <StatCard
                    label="TIR MÁX"
                    value={`${fmt(sovStats.max.tir, 1)}%`}
                    sub={sovStats.max.symbol}
                    tone="emerald"
                  />
                  <StatCard
                    label="TIR MÍN"
                    value={`${fmt(sovStats.min.tir, 1)}%`}
                    sub={sovStats.min.symbol}
                    tone="rose"
                  />
                  <StatCard
                    label="DISPERSIÓN"
                    value={`${fmt(sovStats.max.tir - sovStats.min.tir, 1)}pp`}
                    sub="max − min"
                    tone="cyan"
                  />
                </div>
              )}

              {/* Table */}
              <div className="border border-slate-900 bg-slate-900/30">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-900 bg-slate-950">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-amber-500 pulse-dot"/>
                    <span className="text-[11px] tracking-[0.2em] text-amber-500 font-semibold">HARD-DOLLAR SOVEREIGNS</span>
                  </div>
                  <span className="text-[10px] text-slate-600 tracking-wider">
                    TIR APROX · CURRENT YIELD + PULL-TO-PAR
                  </span>
                </div>
                <table className="w-full text-[12px] tabular">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-900 text-[10px] tracking-widest">
                      <Th onClick={() => { setSortKey('symbol'); setSortDir(d => sortKey==='symbol' && d==='asc'?'desc':'asc'); }} active={sortKey==='symbol'} dir={sortDir}>TICKER</Th>
                      <Th onClick={() => { setSortKey('yearsLeft'); setSortDir(d => sortKey==='yearsLeft' && d==='asc'?'desc':'asc'); }} active={sortKey==='yearsLeft'} dir={sortDir}>VTO</Th>
                      <Th onClick={() => { setSortKey('price'); setSortDir(d => sortKey==='price' && d==='asc'?'desc':'asc'); }} active={sortKey==='price'} dir={sortDir} align="right">LAST</Th>
                      <Th onClick={() => { setSortKey('chg'); setSortDir(d => sortKey==='chg' && d==='asc'?'desc':'asc'); }} active={sortKey==='chg'} dir={sortDir} align="right">CHG%</Th>
                      <Th onClick={() => { setSortKey('tir'); setSortDir(d => sortKey==='tir' && d==='asc'?'desc':'asc'); }} active={sortKey==='tir'} dir={sortDir} align="right">TIR%</Th>
                      <th className="text-right px-3 py-2">DUR</th>
                      <th className="text-center px-3 py-2">LEY</th>
                      <th className="text-right px-3 py-2">CUP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSov.map((b, i) => (
                      <tr key={b.symbol} className="border-b border-slate-900/60 hover:bg-amber-500/5 transition-colors group">
                        <td className="px-3 py-2 font-bold text-amber-400 group-hover:text-amber-300">{b.symbol}</td>
                        <td className="px-3 py-2 text-slate-400">
                          {b.yearsLeft?.toFixed(1)}<span className="text-slate-600 text-[10px]">Y</span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-200 font-semibold">{fmt(b.price, 2)}</td>
                        <td className={`px-3 py-2 text-right ${
                          b.chg > 0 ? 'text-emerald-400' : b.chg < 0 ? 'text-rose-400' : 'text-slate-500'
                        }`}>
                          {b.chg != null ? (
                            <span className="inline-flex items-center gap-0.5">
                              {b.chg > 0 ? <ArrowUp className="w-3 h-3"/> : b.chg < 0 ? <ArrowDown className="w-3 h-3"/> : null}
                              {fmtPct(b.chg, 2)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-100 font-semibold">{b.tir?.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{b.dur?.toFixed(1)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`text-[10px] px-1.5 py-0.5 ${
                            b.law === 'NY' ? 'bg-cyan-950/50 text-cyan-400 border border-cyan-900'
                                           : 'bg-slate-900 text-slate-400 border border-slate-800'
                          }`}>{b.law}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-500">{b.coupon}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!sortedSov.length && (
                  <div className="py-10 text-center text-slate-600 text-sm">Sin datos de soberanos.</div>
                )}
              </div>

              <p className="text-[10px] text-slate-600 leading-relaxed">
                * TIR y Duration son aproximaciones de mesa (current yield + pull-to-par anualizado). Para TIR exacta descontar flujos del bono.
              </p>
            </div>
          )}

          {/* ═══ TAB: LECAPS ═══ */}
          {!loading && tab === 'lecaps' && (
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="INSTRUMENTOS" value={lecaps.length} sub="cotizando" tone="amber"/>
                <StatCard
                  label="PROMEDIO"
                  value={lecaps.length ? `$${fmt(lecaps.reduce((s,l)=>s+l.price,0)/lecaps.length, 1)}` : '—'}
                  sub="precio simple"
                  tone="cyan"
                />
                <StatCard
                  label="RANGO"
                  value={lecaps.length ? `$${fmt(Math.min(...lecaps.map(l=>l.price)),0)}–${fmt(Math.max(...lecaps.map(l=>l.price)),0)}` : '—'}
                  sub="min - max"
                  tone="emerald"
                />
              </div>

              <div className="border border-slate-900 bg-slate-900/30">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-900 bg-slate-950">
                  <div className="w-1.5 h-1.5 bg-amber-500 pulse-dot"/>
                  <span className="text-[11px] tracking-[0.2em] text-amber-500 font-semibold">LECAPs / BONCAPs — PESOS</span>
                </div>
                <div className="max-h-[500px] overflow-y-auto">
                  <table className="w-full text-[12px] tabular">
                    <thead className="sticky top-0 bg-slate-950">
                      <tr className="text-slate-500 border-b border-slate-900 text-[10px] tracking-widest">
                        <th className="text-left px-3 py-2">TICKER</th>
                        <th className="text-right px-3 py-2">LAST</th>
                        <th className="text-right px-3 py-2">CHG%</th>
                        <th className="text-right px-3 py-2">BID</th>
                        <th className="text-right px-3 py-2">ASK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lecaps.map(l => (
                        <tr key={l.symbol} className="border-b border-slate-900/60 hover:bg-amber-500/5 transition-colors">
                          <td className="px-3 py-2 font-bold text-amber-400">{l.symbol}</td>
                          <td className="px-3 py-2 text-right text-slate-200 font-semibold">{fmt(l.price, 2)}</td>
                          <td className={`px-3 py-2 text-right ${
                            l.chg > 0 ? 'text-emerald-400' : l.chg < 0 ? 'text-rose-400' : 'text-slate-500'
                          }`}>
                            {l.chg != null ? fmtPct(l.chg, 2) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-500">{fmt(l.bid, 2)}</td>
                          <td className="px-3 py-2 text-right text-slate-500">{fmt(l.ask, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ═══ TAB: CURVA ═══ */}
          {!loading && tab === 'curva' && (
            <div className="p-5 space-y-5">
              <div className="border border-slate-900 bg-slate-900/30 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-amber-500 pulse-dot"/>
                    <span className="text-[11px] tracking-[0.2em] text-amber-500 font-semibold">YIELD CURVE — SOVEREIGN USD</span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-amber-500"/>
                      <span>LEY LOCAL</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-cyan-400"/>
                      <span>LEY NY</span>
                    </div>
                  </div>
                </div>
                <div style={{ width: '100%', height: 380 }}>
                  <ResponsiveContainer>
                    <ScatterChart margin={{ top: 20, right: 30, bottom: 40, left: 40 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#1e293b"/>
                      <XAxis
                        dataKey="yearsLeft"
                        name="años"
                        type="number"
                        domain={[0, 'dataMax + 1']}
                        stroke="#475569"
                        tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'JetBrains Mono' }}
                        label={{ value: 'AÑOS AL VTO', position: 'insideBottom', offset: -20, fill: '#64748b', fontSize: 10, letterSpacing: '0.2em' }}
                      />
                      <YAxis
                        dataKey="tir"
                        name="tir"
                        type="number"
                        domain={['dataMin - 1', 'dataMax + 1']}
                        stroke="#475569"
                        tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'JetBrains Mono' }}
                        label={{ value: 'TIR %', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 10, letterSpacing: '0.2em' }}
                      />
                      <Tooltip content={<CurveTooltip/>}/>
                      <Scatter data={sovereignBonds.filter(b => b.law === 'Local' && b.tir != null)} fill="#f59e0b">
                        {sovereignBonds.filter(b => b.law === 'Local' && b.tir != null).map((b, i) => (
                          <Cell key={i} fill="#f59e0b"/>
                        ))}
                      </Scatter>
                      <Scatter data={sovereignBonds.filter(b => b.law === 'NY' && b.tir != null)} fill="#22d3ee">
                        {sovereignBonds.filter(b => b.law === 'NY' && b.tir != null).map((b, i) => (
                          <Cell key={i} fill="#22d3ee"/>
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Spread Ley Local vs NY */}
              <SpreadAnalysis bonds={sovereignBonds}/>
            </div>
          )}

          {/* ═══ TAB: DÓLAR ═══ */}
          {!loading && tab === 'dolar' && (
            <div className="p-5 space-y-5">
              {(brecha.mep != null || brecha.ccl != null) && (
                <div className="grid grid-cols-2 gap-3">
                  <StatCard
                    label="BRECHA MEP / OFICIAL"
                    value={brecha.mep != null ? `${fmt(brecha.mep, 1)}%` : '—'}
                    sub="spread cambiario"
                    tone={brecha.mep > 20 ? 'rose' : 'emerald'}
                  />
                  <StatCard
                    label="BRECHA CCL / OFICIAL"
                    value={brecha.ccl != null ? `${fmt(brecha.ccl, 1)}%` : '—'}
                    sub="spread cambiario"
                    tone={brecha.ccl > 20 ? 'rose' : 'emerald'}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {dolarCards.map(d => (
                  <div key={d.key} className="border border-slate-900 bg-slate-900/30 p-4 hover:border-amber-500/40 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-[10px] tracking-[0.2em] text-slate-500 font-semibold">{d.label}</span>
                      {d.data?.variacion != null && (
                        <span className={`text-[11px] tabular ${d.data.variacion > 0 ? 'text-emerald-400' : d.data.variacion < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                          {fmtPct(d.data.variacion)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-2xl font-bold text-slate-100 tabular">${fmt(d.data?.venta, 2)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                      <span>COMPRA ${fmt(d.data?.compra, 2)}</span>
                      <span className="text-slate-700">·</span>
                      <span>VENTA ${fmt(d.data?.venta, 2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ─── RIGHT: AI ANALYST ──────────────────────────────────────── */}
        <aside className="col-span-12 lg:col-span-5 flex flex-col bg-slate-950 relative">
          <div className="border-b border-slate-900 px-5 py-3 flex items-center justify-between bg-gradient-to-r from-slate-950 via-slate-900/50 to-slate-950">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Sparkles className="w-5 h-5 text-amber-400"/>
                <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-400 rounded-full pulse-dot"/>
              </div>
              <div className="leading-tight">
                <div className="text-[12px] tracking-[0.2em] font-semibold text-amber-400">IA ANALYST</div>
                <div className="text-[10px] tracking-wider text-slate-500">CLAUDE · LIVE CONTEXT</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 tracking-wider flex items-center gap-1.5">
              <Circle className="w-1.5 h-1.5 fill-emerald-400 text-emerald-400 pulse-dot"/>
              <span>READY</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-[400px]">
            {messages.length === 0 && (
              <div className="text-center py-8 space-y-6">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1 border border-amber-500/30 bg-amber-500/5">
                    <Zap className="w-3 h-3 text-amber-400"/>
                    <span className="text-[10px] tracking-widest text-amber-400 font-semibold">MESA AR · CAPITAL MARKETS</span>
                  </div>
                  <h2 className="text-xl font-display font-bold text-slate-200">Analista con data live.</h2>
                  <p className="text-[12px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                    Precios de soberanos, LECAPs y dólares inyectados en cada query.<br/>
                    Preguntá como si fuera un colega de mesa.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2 max-w-md mx-auto">
                  {quickQs.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => askAI(q)}
                      className="text-left px-3 py-2.5 border border-slate-800 hover:border-amber-500/60 hover:bg-amber-500/5 transition-all text-[12px] text-slate-400 hover:text-amber-300 group flex items-start gap-2"
                    >
                      <span className="text-amber-500/70 group-hover:text-amber-400 font-bold">›</span>
                      <span>{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[92%] ${m.role === 'user' ? 'order-1' : ''}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[9px] tracking-[0.2em] font-semibold ${m.role === 'user' ? 'text-cyan-400' : 'text-amber-400'}`}>
                      {m.role === 'user' ? '› YOU' : '‹ IA'}
                    </span>
                    <span className="text-[9px] text-slate-700">{i === messages.length - 1 ? 'now' : ''}</span>
                  </div>
                  <div className={`px-3 py-2 text-[13px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-cyan-950/30 border-l-2 border-cyan-500/60 text-slate-200'
                      : 'bg-slate-900/60 border-l-2 border-amber-500/60 text-slate-300'
                  }`}>
                    <MarkdownLite text={m.content}/>
                  </div>
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex">
                <div className="max-w-[92%]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[9px] tracking-[0.2em] font-semibold text-amber-400">‹ IA</span>
                  </div>
                  <div className="px-3 py-2 bg-slate-900/60 border-l-2 border-amber-500/60 flex items-center gap-2 text-[12px] text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin text-amber-400"/>
                    <span className="cursor-blink">analizando mercado</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef}/>
          </div>

          {/* Input */}
          <div className="border-t border-slate-900 p-3 bg-slate-950">
            <div className="flex gap-2 items-end">
              <div className="flex-1 flex items-center border border-slate-800 focus-within:border-amber-500/60 bg-slate-900/50 transition-colors">
                <span className="pl-3 text-amber-500 text-sm font-bold">›</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') askAI(input); }}
                  disabled={chatLoading}
                  placeholder="consultá a la mesa..."
                  className="flex-1 bg-transparent px-2 py-2.5 text-[13px] text-slate-200 placeholder-slate-600 outline-none tabular"
                />
              </div>
              <button
                onClick={() => askAI(input)}
                disabled={chatLoading || !input.trim()}
                className="px-3 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-600 text-slate-950 transition-colors"
              >
                <Send className="w-4 h-4"/>
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[9px] tracking-wider text-slate-600">
              <span>ENTER para enviar</span>
              <span>POWERED BY CLAUDE SONNET 4</span>
            </div>
          </div>
        </aside>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 px-6 py-2 flex items-center justify-between text-[10px] text-slate-600 tracking-wider">
        <div className="flex items-center gap-4">
          <span>DATA · data912 · dolarapi · allorigins (fallback)</span>
        </div>
        <div className="flex items-center gap-4">
          <span>POLL {POLL_INTERVAL/1000}s</span>
          <span>·</span>
          <span>MESA IA v1.0</span>
        </div>
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function StatCard({ label, value, sub, tone = 'amber' }) {
  const tones = {
    amber:   'border-amber-500/30 text-amber-400',
    emerald: 'border-emerald-500/30 text-emerald-400',
    rose:    'border-rose-500/30 text-rose-400',
    cyan:    'border-cyan-500/30 text-cyan-400'
  };
  return (
    <div className={`border ${tones[tone]} bg-slate-900/30 px-3 py-2.5`}>
      <div className="text-[9px] tracking-[0.2em] text-slate-500 font-semibold mb-1">{label}</div>
      <div className="text-xl font-bold tabular leading-none">{value}</div>
      <div className="text-[10px] text-slate-500 mt-1 tracking-wider">{sub}</div>
    </div>
  );
}

function Th({ children, onClick, active, dir, align = 'left' }) {
  return (
    <th className={`px-3 py-2 cursor-pointer hover:text-amber-400 transition-colors select-none text-${align}`} onClick={onClick}>
      <span className="inline-flex items-center gap-0.5">
        {children}
        {active && (dir === 'asc' ? <ArrowUp className="w-2.5 h-2.5"/> : <ArrowDown className="w-2.5 h-2.5"/>)}
      </span>
    </th>
  );
}

function CurveTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-slate-950 border border-amber-500/60 px-3 py-2 text-[11px] tabular shadow-xl" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
      <div className="text-amber-400 font-bold tracking-wider mb-1">{d.symbol}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-slate-300">
        <span className="text-slate-500">TIR</span><span>{d.tir?.toFixed(2)}%</span>
        <span className="text-slate-500">PRICE</span><span>{fmt(d.price, 2)}</span>
        <span className="text-slate-500">VTO</span><span>{d.yearsLeft?.toFixed(1)}Y</span>
        <span className="text-slate-500">LEY</span><span>{d.law}</span>
        <span className="text-slate-500">CUP</span><span>{d.coupon}%</span>
      </div>
    </div>
  );
}

function SpreadAnalysis({ bonds }) {
  // Match por maturity
  const pairs = [
    ['AL29', 'GD29'], ['AL30', 'GD30'], ['AL35', 'GD35'], ['AE38', 'GD38'], ['AL41', 'GD41']
  ];
  const rows = pairs.map(([al, gd]) => {
    const a = bonds.find(b => b.symbol === al);
    const g = bonds.find(b => b.symbol === gd);
    if (!a || !g || a.tir == null || g.tir == null) return null;
    return {
      maturity: al.slice(2),
      al, gd,
      spread: a.tir - g.tir,
      alPrice: a.price, gdPrice: g.price,
      alTir: a.tir, gdTir: g.tir
    };
  }).filter(Boolean);

  if (!rows.length) return null;

  return (
    <div className="border border-slate-900 bg-slate-900/30">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-900 bg-slate-950">
        <div className="w-1.5 h-1.5 bg-amber-500 pulse-dot"/>
        <span className="text-[11px] tracking-[0.2em] text-amber-500 font-semibold">SPREAD LEY LOCAL vs NY</span>
      </div>
      <table className="w-full text-[12px] tabular">
        <thead>
          <tr className="text-slate-500 border-b border-slate-900 text-[10px] tracking-widest">
            <th className="text-left px-3 py-2">VTO</th>
            <th className="text-right px-3 py-2">AL (LOCAL)</th>
            <th className="text-right px-3 py-2">TIR AL</th>
            <th className="text-right px-3 py-2">GD (NY)</th>
            <th className="text-right px-3 py-2">TIR GD</th>
            <th className="text-right px-3 py-2">SPREAD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.maturity} className="border-b border-slate-900/60 hover:bg-amber-500/5 transition-colors">
              <td className="px-3 py-2 font-bold text-amber-400">20{r.maturity}</td>
              <td className="px-3 py-2 text-right text-slate-300">{fmt(r.alPrice, 2)}</td>
              <td className="px-3 py-2 text-right text-slate-400">{r.alTir.toFixed(2)}%</td>
              <td className="px-3 py-2 text-right text-slate-300">{fmt(r.gdPrice, 2)}</td>
              <td className="px-3 py-2 text-right text-slate-400">{r.gdTir.toFixed(2)}%</td>
              <td className={`px-3 py-2 text-right font-bold ${r.spread > 0 ? 'text-amber-400' : 'text-cyan-400'}`}>
                {r.spread > 0 ? '+' : ''}{r.spread.toFixed(2)}pp
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-3 py-1.5 text-[9px] text-slate-600 tracking-wider border-t border-slate-900">
        * Spread &gt; 0 → mercado castiga ley local · Spread &lt; 0 → anomalía
      </div>
    </div>
  );
}

// Minimal markdown for **bold** and line breaks
function MarkdownLite({ text }) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return <strong key={i} className="text-amber-400 font-semibold">{p.slice(2, -2)}</strong>;
        }
        return <span key={i}>{p.split('\n').map((line, j, arr) => (
          <React.Fragment key={j}>
            {line}
            {j < arr.length - 1 && <br/>}
          </React.Fragment>
        ))}</span>;
      })}
    </span>
  );
}
