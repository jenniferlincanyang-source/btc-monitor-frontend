import { useState, useEffect, useRef, useCallback } from 'react';
import { usePredictions } from '../hooks/usePredictions';
import { generateResolutionExplanation } from '../prediction';
import type { Prediction, PredictionTarget, PredictionTimeframe, PredictionReason, ResolutionExplanation } from '../types';

export interface GenerateResult {
  direction: 'up' | 'down' | 'neutral';
  change: number;
  confidence: number;
  currentValue: number;
  predictedValue: number;
  reasons: PredictionReason[];
}

interface Props {
  targetType: PredictionTarget;
  targetLabel: string;
  storageKey: PredictionTimeframe;
  onGenerate: () => Promise<GenerateResult | null>;
  onResolve: () => Promise<number>;
}

const DIR = {
  up:      { text: '上升', color: '#3fb950', arrow: '↑' },
  down:    { text: '下降', color: '#f85149', arrow: '↓' },
  neutral: { text: '持平', color: '#d29922', arrow: '→' },
} as const;

const IMPACT_COLOR = { bullish: '#3fb950', bearish: '#f85149', neutral: '#d29922' } as const;

function formatCountdown(sec: number): string {
  if (sec <= 0) return '0:00';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function EmbeddedPredictionPanel({ targetType, targetLabel, storageKey, onGenerate, onResolve }: Props) {
  const { predictions, addPrediction, resolvePrediction, getAccuracy } = usePredictions(storageKey);
  const [countdown, setCountdown] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const resolveRef = useRef<ReturnType<typeof setInterval>>();

  const active = predictions.filter((p) => !p.resolved);
  const resolved = predictions.filter((p) => p.resolved);
  const latest = active[0];

  const generate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await onGenerate();
      if (!result) { setGenerating(false); return; }
      const now = Math.floor(Date.now() / 1000);
      addPrediction({
        id: `${targetType}-${now}`,
        createdAt: now,
        targetTime: now + 300,
        target: targetType,
        direction: result.direction,
        timeframe: storageKey,
        currentValue: result.currentValue,
        predictedValue: result.predictedValue,
        predictedChange: result.change,
        confidence: result.confidence,
        signals: [],
        resolved: false,
        reasons: result.reasons,
      });
      setCountdown(300);
    } catch (err) {
      console.error(`[${targetType}] prediction error:`, err);
    }
    setGenerating(false);
  }, [generating, onGenerate, targetType, storageKey, addPrediction]);

  const resolveExpired = useCallback(async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = active.filter((p) => now >= p.targetTime);
    if (expired.length === 0) return;
    try {
      const actualValue = await onResolve();
      if (actualValue === 0) return;
      for (const p of expired) {
        const resolution = generateResolutionExplanation(p, actualValue);
        resolvePrediction(p.id, actualValue, resolution);
      }
    } catch { /* ignore */ }
  }, [active, onResolve, resolvePrediction]);

  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (latest) {
      const rem = latest.targetTime - Math.floor(Date.now() / 1000);
      if (rem > 0) setCountdown(rem);
      else generate();
    } else { generate(); }
    timerRef.current = setInterval(generate, 300_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []); // eslint-disable-line

  useEffect(() => {
    resolveRef.current = setInterval(resolveExpired, 30_000);
    return () => { if (resolveRef.current) clearInterval(resolveRef.current); };
  }, [resolveExpired]);

  const acc = getAccuracy(targetType);
  const accData = acc.length > 0 ? acc[0] : null;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span style={s.title}>5分钟预测 — {targetLabel}</span>
        <span style={s.cd}>{formatCountdown(countdown)}</span>
      </div>

      {/* 当前预测 */}
      {latest ? (() => {
        const d = DIR[latest.direction];
        return (<div style={s.predBox}>
          <div style={{ ...s.dir, color: d.color }}><span style={s.arrow}>{d.arrow}</span> {d.text} {latest.predictedChange >= 0 ? '+' : ''}{latest.predictedChange.toFixed(2)}%</div>
          <div style={s.confRow}>
            <span style={s.confLabel}>置信度 {latest.confidence}%</span>
            <div style={s.confBar}><div style={{ ...s.confFill, width: `${latest.confidence}%`, background: latest.confidence > 60 ? '#3fb950' : latest.confidence > 40 ? '#d29922' : '#f85149' }} /></div>
          </div>
          {latest.reasons && latest.reasons.length > 0 && (
            <div style={s.reasonsBox}>
              <div style={s.reasonsTitle}>预测原因：</div>
              {latest.reasons.map((r, i) => (
                <div key={i} style={s.reasonRow}>
                  <span style={{ ...s.reasonDot, background: IMPACT_COLOR[r.impact] }} />
                  <span style={s.reasonSignal}>{r.signal}</span>
                  <span style={s.reasonDetail}>{r.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>);
      })() : <div style={s.empty}>{generating ? '生成中...' : '等待数据...'}</div>}

      {accData && accData.totalPredictions > 0 && (
        <div style={s.accRow}>准确率: {accData.accuracy.toFixed(0)}% ({accData.correctPredictions}/{accData.totalPredictions}) | 平均误差: {accData.avgError.toFixed(2)}%</div>
      )}

      <button onClick={generate} disabled={generating} style={{ ...s.btn, opacity: generating ? 0.5 : 1 }}>
        {generating ? '生成中...' : '立即预测'}
      </button>

      {/* 历史记录 */}
      {resolved.length > 0 && (<div style={s.histBox}>
        <div style={s.histTitle}>历史记录 ({resolved.length})</div>
        {resolved.slice(0, 20).map((p) => {
          const d = DIR[p.direction];
          const expanded = expandedId === p.id;
          return (<div key={p.id} style={s.histItem}>
            <div style={s.histRow} onClick={() => setExpandedId(expanded ? null : p.id)}>
              <span style={s.histTime}>{new Date(p.createdAt * 1000).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              <span style={{ color: d.color }}>{d.arrow}{p.predictedChange >= 0 ? '+' : ''}{p.predictedChange.toFixed(2)}%</span>
              <span style={s.histActual}>实际: {p.actualChange !== undefined ? `${p.actualChange >= 0 ? '+' : ''}${p.actualChange.toFixed(2)}%` : '--'}</span>
              <span>{p.accurate === true ? <span style={{ color: '#3fb950' }}>✓</span> : p.accurate === false ? <span style={{ color: '#f85149' }}>✗</span> : '--'}</span>
              <span style={s.histErr}>偏差: {p.error !== undefined ? `${p.error.toFixed(2)}%` : '--'}</span>
              <span style={s.expandArrow}>{expanded ? '▼' : '▶'}</span>
            </div>
            {expanded && p.resolution && (<div style={s.resBox}>
              <div style={s.resSummary}>{p.resolution.summary}</div>
              {p.resolution.reasons.map((r, i) => <div key={i} style={s.resReason}>• {r}</div>)}
              <div style={s.resKey}>关键因素：{p.resolution.keyFactor}</div>
            </div>)}
            {expanded && p.reasons && !p.resolution && (<div style={s.resBox}>
              {p.reasons.map((r, i) => <div key={i} style={s.resReason}>• {r.detail}</div>)}
            </div>)}
          </div>);
        })}
      </div>)}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 16, background: '#161b22', borderRadius: 8, border: '1px solid #30363d', padding: '14px 16px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 13, fontWeight: 600, color: '#58a6ff' },
  cd: { fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: '#8b949e' },
  predBox: { marginBottom: 10 },
  dir: { fontSize: 16, fontWeight: 700, marginBottom: 8 },
  arrow: { fontSize: 20 },
  confRow: { marginBottom: 8 },
  confLabel: { fontSize: 11, color: '#8b949e', display: 'block', marginBottom: 3 },
  confBar: { height: 5, background: '#21262d', borderRadius: 3, overflow: 'hidden' },
  confFill: { height: '100%', borderRadius: 3, transition: 'width 0.5s' },
  reasonsBox: { background: '#0d1117', borderRadius: 6, padding: '8px 10px', marginTop: 8 },
  reasonsTitle: { fontSize: 11, fontWeight: 600, color: '#8b949e', marginBottom: 6 },
  reasonRow: { display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4, fontSize: 11, color: '#c9d1d9' },
  reasonDot: { width: 6, height: 6, borderRadius: '50%', marginTop: 4, flexShrink: 0 },
  reasonSignal: { fontWeight: 600, flexShrink: 0, minWidth: 80 },
  reasonDetail: { color: '#8b949e' },
  empty: { textAlign: 'center', color: '#484f58', padding: 16, fontSize: 12 },
  accRow: { fontSize: 11, color: '#8b949e', marginBottom: 8 },
  btn: { width: '100%', padding: '5px 0', fontSize: 11, background: '#58a6ff22', color: '#58a6ff', border: '1px solid #58a6ff44', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 },
  histBox: { marginTop: 12, borderTop: '1px solid #21262d', paddingTop: 10 },
  histTitle: { fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 6 },
  histItem: { marginBottom: 2 },
  histRow: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#c9d1d9', padding: '4px 0', cursor: 'pointer' },
  histTime: { color: '#484f58', minWidth: 40 },
  histActual: { color: '#8b949e' },
  histErr: { color: '#484f58' },
  expandArrow: { color: '#484f58', fontSize: 9, marginLeft: 'auto' },
  resBox: { background: '#0d1117', borderRadius: 6, padding: '8px 10px', margin: '4px 0 8px', fontSize: 11 },
  resSummary: { fontWeight: 600, color: '#f0f6fc', marginBottom: 6 },
  resReason: { color: '#8b949e', marginBottom: 3 },
  resKey: { color: '#d29922', marginTop: 6, fontWeight: 600 },
};
