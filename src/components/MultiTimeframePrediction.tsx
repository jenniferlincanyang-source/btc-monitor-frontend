import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchPriceHistoryForTimeframe, fetchCurrentPrice, fetchExchangeFlows } from '../api';
import { predictPrice, adjustConfidence } from '../prediction';
import { usePredictions } from '../hooks/usePredictions';
import type { Prediction, PredictionDirection, PredictionTimeframe, TimeframeConfig } from '../types';

const TIMEFRAMES: TimeframeConfig[] = [
  { key: '20m', label: '20分钟', seconds: 1200, priceDays: 1 },
  { key: '1h',  label: '1小时',  seconds: 3600, priceDays: 2 },
  { key: '6h',  label: '6小时',  seconds: 21600, priceDays: 7 },
  { key: '12h', label: '12小时', seconds: 43200, priceDays: 14 },
  { key: '1d',  label: '1天',    seconds: 86400, priceDays: 30 },
  { key: '1w',  label: '1周',    seconds: 604800, priceDays: 90 },
];

const DIR_LABELS: Record<PredictionDirection, { text: string; color: string; arrow: string }> = {
  up: { text: '上升', color: '#3fb950', arrow: '↑' },
  down: { text: '下降', color: '#f85149', arrow: '↓' },
  neutral: { text: '持平', color: '#d29922', arrow: '→' },
};

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '0:00';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}天${h}时${m}分`;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function TimeframeCard({ config }: { config: TimeframeConfig }) {
  const { predictions, addPrediction, resolvePrediction, getAccuracy } = usePredictions(config.key);
  const [countdown, setCountdown] = useState(0);
  const [generating, setGenerating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const resolveRef = useRef<ReturnType<typeof setInterval>>();

  const active = predictions.filter((p) => !p.resolved);
  const resolved = predictions.filter((p) => p.resolved);
  const latestActive = active[0];

  const generate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const [priceHistory, priceData, flows] = await Promise.all([
        fetchPriceHistoryForTimeframe(config.priceDays).catch(() => []),
        fetchCurrentPrice().catch(() => ({ price: 0 })),
        fetchExchangeFlows().catch(() => ({ inflow: 0, outflow: 0 })),
      ]);
      const currentPrice = (priceData as any).price || 0;
      if (currentPrice === 0 || priceHistory.length < 10) {
        setGenerating(false);
        return;
      }
      const prices = priceHistory.map((p) => p.price);
      const result = predictPrice(
        prices,
        ((flows as any).inflow || 0) - ((flows as any).outflow || 0),
      );
      const histAcc = getAccuracy('price');
      const acc = histAcc.length > 0 ? histAcc[0] : undefined;
      const conf = adjustConfidence(
        result.confidence,
        acc ? acc.accuracy : 50,
      );
      const now = Math.floor(Date.now() / 1000);
      addPrediction({
        id: `price-${config.key}-${now}`,
        createdAt: now,
        targetTime: now + config.seconds,
        target: 'price',
        direction: result.direction,
        timeframe: config.key,
        currentValue: currentPrice,
        predictedValue: currentPrice * (1 + result.change / 100),
        predictedChange: result.change,
        confidence: conf,
        signals: result.signals,
        resolved: false,
      });
      setCountdown(config.seconds);
    } catch (err) {
      console.error(`[${config.key}] prediction error:`, err);
    }
    setGenerating(false);
  }, [generating, config, addPrediction, getAccuracy]);

  // resolve expired predictions
  const resolveExpired = useCallback(async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = active.filter((p) => now >= p.targetTime);
    if (expired.length === 0) return;
    try {
      const priceData = await fetchCurrentPrice().catch(() => ({ price: 0 }));
      const price = (priceData as any).price || 0;
      if (price > 0) {
        for (const p of expired) resolvePrediction(p.id, price);
      }
    } catch { /* ignore */ }
  }, [active, resolvePrediction]);

  // countdown timer
  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // auto-generate on mount + cycle
  useEffect(() => {
    // restore countdown from latest active prediction
    if (latestActive) {
      const remaining = latestActive.targetTime - Math.floor(Date.now() / 1000);
      if (remaining > 0) { setCountdown(remaining); }
      else { generate(); }
    } else { generate(); }
    timerRef.current = setInterval(generate, config.seconds * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []); // eslint-disable-line

  // auto-resolve every 30s
  useEffect(() => {
    resolveRef.current = setInterval(resolveExpired, 30000);
    return () => { if (resolveRef.current) clearInterval(resolveRef.current); };
  }, [resolveExpired]);

  const accuracies = getAccuracy('price');
  const acc = accuracies.length > 0 ? accuracies[0] : null;

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <span style={s.cardLabel}>📈 {config.label}趋势</span>
        <span style={s.cardCountdown}>{formatCountdown(countdown)}</span>
      </div>
      {latestActive ? (() => {
        const dir = DIR_LABELS[latestActive.direction];
        return (<>
          <div style={{ ...s.direction, color: dir.color }}>
            <span style={s.arrow}>{dir.arrow}</span> {dir.text}
          </div>
          <div style={s.values}>
            <div><span style={s.valLabel}>当前</span>
              <span style={s.valNum}>${latestActive.currentValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <span style={s.valArrow}>→</span>
            <div><span style={s.valLabel}>预测</span>
              <span style={{ ...s.valNum, color: dir.color }}>${latestActive.predictedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
          <div style={s.confRow}>
            <span style={s.confText}>置信度: <span style={{ color: latestActive.confidence > 60 ? '#3fb950' : latestActive.confidence > 40 ? '#d29922' : '#f85149' }}>{latestActive.confidence}%</span></span>
            <div style={s.confBar}><div style={{ ...s.confFill, width: `${latestActive.confidence}%`, background: latestActive.confidence > 60 ? '#3fb950' : latestActive.confidence > 40 ? '#d29922' : '#f85149' }} /></div>
          </div>
        </>);
      })() : <div style={s.empty}>{generating ? '生成中...' : '等待生成...'}</div>}
      {acc && acc.totalPredictions > 0 && (
        <div style={s.accRow}>准确率: {acc.accuracy.toFixed(0)}% ({acc.correctPredictions}/{acc.totalPredictions})</div>
      )}
      <button onClick={generate} disabled={generating} style={{ ...s.btn, opacity: generating ? 0.5 : 1 }}>
        {generating ? '生成中...' : '立即预测'}
      </button>
    </div>
  );
}

function HistoryPanel({ config }: { config: TimeframeConfig }) {
  const { predictions } = usePredictions(config.key);
  const resolved = predictions.filter((p) => p.resolved);
  if (resolved.length === 0) return null;
  return (
    <div style={s.histSection}>
      <h4 style={s.histTitle}>{config.label} 历史记录 ({resolved.length})</h4>
      <table style={s.table}>
        <thead><tr>
          <th style={s.th}>时间</th><th style={s.th}>预测</th>
          <th style={s.th}>实际</th><th style={s.th}>置信度</th>
          <th style={s.th}>结果</th><th style={s.th}>误差</th>
        </tr></thead>
        <tbody>
          {resolved.slice(0, 30).map((p) => {
            const dir = DIR_LABELS[p.direction];
            return (
              <tr key={p.id}>
                <td style={s.td}>{new Date(p.createdAt * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td style={{ ...s.td, color: dir.color }}>{dir.arrow} {p.predictedChange >= 0 ? '+' : ''}{p.predictedChange.toFixed(2)}%</td>
                <td style={s.td}>{p.actualChange !== undefined ? `${p.actualChange >= 0 ? '+' : ''}${p.actualChange.toFixed(2)}%` : '--'}</td>
                <td style={s.td}>{p.confidence}%</td>
                <td style={s.td}>{p.accurate === true ? <span style={{ color: '#3fb950' }}>✓</span> : p.accurate === false ? <span style={{ color: '#f85149' }}>✗</span> : '--'}</td>
                <td style={s.td}>{p.error !== undefined ? `${p.error.toFixed(2)}%` : '--'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function MultiTimeframePrediction() {
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div style={s.container}>
      <div style={s.header}>
        <h2 style={s.title}>多周期趋势预测</h2>
        <div style={s.disclaimer}>⚠️ 基于技术指标的统计估算，仅供参考。各周期独立运行，按自身周期自动更新。</div>
      </div>
      <div style={s.grid}>
        {TIMEFRAMES.map((tf) => <TimeframeCard key={tf.key} config={tf} />)}
      </div>
      <div style={s.histToggle}>
        <button onClick={() => setShowHistory(!showHistory)} style={s.histBtn}>
          {showHistory ? '隐藏历史记录' : '查看历史记录'}
        </button>
      </div>
      {showHistory && (
        <div style={s.histContainer}>
          {TIMEFRAMES.map((tf) => <HistoryPanel key={tf.key} config={tf} />)}
        </div>
      )}
      <div style={s.footer}>
        <span>各周期独立计时 | 数据保存在本地浏览器 | 使用 SMA/EMA/RSI/MACD/布林带等技术指标</span>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { background: '#1c2128', borderRadius: 12, border: '1px solid #30363d', overflow: 'hidden' },
  header: { padding: '20px 24px 8px' },
  title: { fontSize: 18, fontWeight: 600, color: '#f0f6fc', margin: '0 0 8px' },
  disclaimer: { fontSize: 11, color: '#d29922', background: '#d2992211', padding: '6px 12px', borderRadius: 6, marginBottom: 4 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, padding: '12px 24px' },
  card: { background: '#0d1117', borderRadius: 8, border: '1px solid #30363d', padding: '14px 16px' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 600, color: '#f0f6fc', marginBottom: 10 },
  cardLabel: { },
  cardCountdown: { fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: '#58a6ff' },
  direction: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, marginBottom: 10 },
  arrow: { fontSize: 24 },
  values: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  valLabel: { display: 'block', fontSize: 10, color: '#484f58', marginBottom: 2 },
  valNum: { fontSize: 14, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', color: '#f0f6fc' },
  valArrow: { color: '#484f58', fontSize: 14 },
  confRow: { marginBottom: 10 },
  confText: { fontSize: 11, color: '#8b949e', marginBottom: 4, display: 'block' },
  confBar: { height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' },
  confFill: { height: '100%', borderRadius: 3, transition: 'width 0.5s' },
  empty: { textAlign: 'center', color: '#484f58', padding: 20, fontSize: 13 },
  accRow: { fontSize: 11, color: '#8b949e', marginBottom: 8 },
  btn: { width: '100%', padding: '6px 0', fontSize: 12, background: '#58a6ff22', color: '#58a6ff', border: '1px solid #58a6ff44', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
  histToggle: { padding: '8px 24px', textAlign: 'center' as const },
  histBtn: { padding: '8px 24px', fontSize: 13, background: '#21262d', color: '#8b949e', border: '1px solid #30363d', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' },
  histContainer: { padding: '0 24px 16px' },
  histSection: { marginBottom: 16 },
  histTitle: { fontSize: 13, fontWeight: 600, color: '#f0f6fc', margin: '8px 0' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '6px 8px', color: '#8b949e', borderBottom: '1px solid #21262d', fontWeight: 600 },
  td: { padding: '6px 8px', color: '#c9d1d9', borderBottom: '1px solid #21262d' },
  footer: { padding: '12px 24px', borderTop: '1px solid #21262d', fontSize: 11, color: '#484f58', textAlign: 'center' as const },
};
