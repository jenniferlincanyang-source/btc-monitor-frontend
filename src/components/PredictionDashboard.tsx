import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchGranularPriceHistory,
  fetchCurrentPrice,
  fetchMempoolInfo,
  fetchLargeTransactions,
  fetchExchangeFlows,
} from '../api';
import {
  predictPrice,
  predictTxVolume,
  predictWhaleMovement,
  predictLargeTx,
  adjustConfidence,
} from '../prediction';
import type {
  Prediction,
  PredictionTarget,
  PredictionDirection,
  PredictionAccuracy,
} from '../types';

const TARGET_LABELS: Record<PredictionTarget, string> = {
  price: 'BTC 价格',
  tx_volume: '交易流量',
  whale_movement: '巨鲸动向',
  large_tx: '大额交易',
};

const TARGET_ICONS: Record<PredictionTarget, string> = {
  price: '💰',
  tx_volume: '📊',
  whale_movement: '🐋',
  large_tx: '💎',
};

const DIR_LABELS: Record<PredictionDirection, { text: string; color: string; arrow: string }> = {
  up: { text: '上升', color: '#3fb950', arrow: '↑' },
  down: { text: '下降', color: '#f85149', arrow: '↓' },
  neutral: { text: '持平', color: '#d29922', arrow: '→' },
};

interface PredictionDashboardProps {
  activePredictions: Prediction[];
  resolvedPredictions: Prediction[];
  addPrediction: (p: Prediction) => void;
  resolvePrediction: (id: string, actualValue: number) => void;
  getAccuracy: (target?: PredictionTarget) => PredictionAccuracy[];
}

export default function PredictionDashboard({
  activePredictions,
  resolvedPredictions,
  addPrediction,
  resolvePrediction,
  getAccuracy,
}: PredictionDashboardProps) {
  const [generating, setGenerating] = useState(false);
  const [lastGenTime, setLastGenTime] = useState<Date | null>(null);
  const [historyFilter, setHistoryFilter] = useState<PredictionTarget | 'all'>('all');
  const [countdown, setCountdown] = useState(300);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dataRef = useRef<{
    prices: number[];
    mempoolSizes: number[];
    feeTrend: number[];
    blockTxCounts: number[];
  }>({ prices: [], mempoolSizes: [], feeTrend: [], blockTxCounts: [] });

  const generatePredictions = useCallback(async () => {
    if (generating) return;
    setGenerating(true);

    try {
      const [priceHistory, priceData, mempoolInfo, txs, flows] = await Promise.all([
        fetchGranularPriceHistory().catch(() => []),
        fetchCurrentPrice().catch(() => ({ price: 0 })),
        fetchMempoolInfo().catch(() => ({ count: 0, feeRates: { fastest: 0, halfHour: 0, hour: 0, economy: 0 } })),
        fetchLargeTransactions(10, 2).catch(() => []),
        fetchExchangeFlows(1).catch(() => []),
      ]);

      const prices = priceHistory.map((p) => p.price);
      const currentPrice = (priceData as any).price || prices[prices.length - 1] || 0;

      // 更新历史数据
      dataRef.current.prices = prices;
      dataRef.current.mempoolSizes.push((mempoolInfo as any).count || 0);
      if (dataRef.current.mempoolSizes.length > 20) dataRef.current.mempoolSizes.shift();
      dataRef.current.feeTrend.push((mempoolInfo as any).feeRates?.fastest || 0);
      if (dataRef.current.feeTrend.length > 20) dataRef.current.feeTrend.shift();

      const now = Math.floor(Date.now() / 1000);
      const accuracies = getAccuracy();
      const getHistAcc = (t: PredictionTarget) => {
        const a = accuracies.find((x) => x.target === t);
        return a && a.totalPredictions > 5 ? a.accuracy : 50;
      };

      // 交易所净流入
      const netflow = flows.length > 0 ? flows[flows.length - 1]?.netflow || 0 : 0;

      // 1. 价格预测
      if (prices.length > 30) {
        const result = predictPrice(prices, netflow);
        const conf = adjustConfidence(result.confidence, getHistAcc('price'));
        const predictedValue = currentPrice * (1 + result.change / 100);
        addPrediction({
          id: `price-${now}`,
          createdAt: now,
          targetTime: now + 300,
          target: 'price',
          direction: result.direction,
          currentValue: currentPrice,
          predictedValue,
          predictedChange: result.change,
          confidence: conf,
          signals: result.signals,
          resolved: false,
        });
      }

      // 2. 交易量预测
      const mempoolCount = (mempoolInfo as any).count || 0;
      {
        const result = predictTxVolume(
          dataRef.current.mempoolSizes,
          dataRef.current.feeTrend,
          dataRef.current.blockTxCounts.length > 0 ? dataRef.current.blockTxCounts : [mempoolCount / 10],
        );
        const conf = adjustConfidence(result.confidence, getHistAcc('tx_volume'));
        addPrediction({
          id: `tx_volume-${now}`,
          createdAt: now,
          targetTime: now + 300,
          target: 'tx_volume',
          direction: result.direction,
          currentValue: mempoolCount,
          predictedValue: mempoolCount * (1 + result.change / 100),
          predictedChange: result.change,
          confidence: conf,
          signals: result.signals,
          resolved: false,
        });
      }

      // 3. 巨鲸动向预测
      {
        const whaleTxCount = txs.length;
        const deposits = txs.filter((t) => t.type === 'exchange_deposit').length;
        const total = txs.length || 1;
        const depositRatio = deposits / total;
        const result = predictWhaleMovement(whaleTxCount, 10, depositRatio, 0);
        const conf = adjustConfidence(result.confidence, getHistAcc('whale_movement'));
        addPrediction({
          id: `whale_movement-${now}`,
          createdAt: now,
          targetTime: now + 300,
          target: 'whale_movement',
          direction: result.direction,
          currentValue: whaleTxCount,
          predictedValue: whaleTxCount * (1 + result.change / 100),
          predictedChange: result.change,
          confidence: conf,
          signals: result.signals,
          resolved: false,
        });
      }

      // 4. 大额交易预测
      {
        const largeTxCount = txs.filter((t) => t.amount > 50).length;
        const result = predictLargeTx(mempoolCount, 30000, largeTxCount, 5);
        const conf = adjustConfidence(result.confidence, getHistAcc('large_tx'));
        addPrediction({
          id: `large_tx-${now}`,
          createdAt: now,
          targetTime: now + 300,
          target: 'large_tx',
          direction: result.direction,
          currentValue: largeTxCount,
          predictedValue: largeTxCount * (1 + result.change / 100),
          predictedChange: result.change,
          confidence: conf,
          signals: result.signals,
          resolved: false,
        });
      }

      setLastGenTime(new Date());
      setCountdown(300);
    } catch (err) {
      console.error('Prediction generation error:', err);
    }
    setGenerating(false);
  }, [generating, addPrediction, getAccuracy]);

  // 自动解析过期预测
  const resolveExpired = useCallback(async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = activePredictions.filter((p) => now >= p.targetTime);
    if (expired.length === 0) return;

    try {
      const [priceData, mempoolInfo, txs] = await Promise.all([
        fetchCurrentPrice().catch(() => ({ price: 0 })),
        fetchMempoolInfo().catch(() => ({ count: 0 })),
        fetchLargeTransactions(10, 1).catch(() => []),
      ]);

      for (const p of expired) {
        let actualValue = 0;
        switch (p.target) {
          case 'price': actualValue = (priceData as any).price || 0; break;
          case 'tx_volume': actualValue = (mempoolInfo as any).count || 0; break;
          case 'whale_movement': actualValue = txs.length; break;
          case 'large_tx': actualValue = txs.filter((t) => t.amount > 50).length; break;
        }
        if (actualValue > 0) {
          resolvePrediction(p.id, actualValue);
        }
      }
    } catch { /* ignore */ }
  }, [activePredictions, resolvePrediction]);

  // 倒计时
  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // 自动生成预测（每5分钟）
  useEffect(() => {
    generatePredictions();
    timerRef.current = setInterval(generatePredictions, 300000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动解析（每30秒检查）
  useEffect(() => {
    resolveTimerRef.current = setInterval(resolveExpired, 30000);
    return () => { if (resolveTimerRef.current) clearInterval(resolveTimerRef.current); };
  }, [resolveExpired]);

  const accuracies = getAccuracy();

  const filteredHistory = historyFilter === 'all'
    ? resolvedPredictions
    : resolvedPredictions.filter((p) => p.target === historyFilter);

  return (
    <div style={styles.container}>
      {/* 头部 */}
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <h2 style={styles.title}>5分钟预测</h2>
          <div style={styles.headerRight}>
            <span style={styles.countdown}>
              下次预测: {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
            </span>
            <button
              onClick={generatePredictions}
              disabled={generating}
              style={{ ...styles.genBtn, opacity: generating ? 0.5 : 1 }}
            >
              {generating ? '生成中...' : '立即预测'}
            </button>
          </div>
        </div>
        <div style={styles.disclaimer}>
          ⚠️ 基于技术指标的统计估算，仅供参考，不构成投资建议。置信度上限 85%。
        </div>
      </div>

      {/* 准确率统计 */}
      <div style={styles.accuracyRow}>
        {accuracies.map((acc) => (
          <div key={acc.target} style={styles.accCard}>
            <div style={styles.accIcon}>{TARGET_ICONS[acc.target]}</div>
            <div style={styles.accName}>{TARGET_LABELS[acc.target]}</div>
            <div style={styles.accValue}>
              {acc.totalPredictions > 0 ? `${acc.accuracy.toFixed(0)}%` : '--'}
            </div>
            <div style={styles.accMeta}>
              {acc.totalPredictions > 0
                ? `${acc.correctPredictions}/${acc.totalPredictions} 正确`
                : '暂无数据'}
            </div>
            {acc.totalPredictions > 0 && (
              <div style={styles.accError}>
                平均误差: {acc.avgError.toFixed(2)}%
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 活跃预测 */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>当前预测</h3>
        <div style={styles.predGrid}>
          {(['price', 'tx_volume', 'whale_movement', 'large_tx'] as PredictionTarget[]).map((target) => {
            const pred = activePredictions.find((p) => p.target === target);
            if (!pred) return (
              <div key={target} style={styles.predCard}>
                <div style={styles.predHeader}>
                  <span>{TARGET_ICONS[target]} {TARGET_LABELS[target]}</span>
                </div>
                <div style={styles.predEmpty}>等待生成...</div>
              </div>
            );

            const dir = DIR_LABELS[pred.direction];
            const remaining = Math.max(0, pred.targetTime - Math.floor(Date.now() / 1000));

            return (
              <div key={target} style={styles.predCard}>
                <div style={styles.predHeader}>
                  <span>{TARGET_ICONS[target]} {TARGET_LABELS[target]}</span>
                  <span style={styles.predTimer}>
                    {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
                  </span>
                </div>

                {/* 方向 */}
                <div style={{ ...styles.predDirection, color: dir.color }}>
                  <span style={styles.predArrow}>{dir.arrow}</span>
                  <span>{dir.text}</span>
                </div>

                {/* 值 */}
                <div style={styles.predValues}>
                  <div style={styles.predCurrent}>
                    <span style={styles.predValLabel}>当前</span>
                    <span style={styles.predValNum}>
                      {target === 'price'
                        ? `$${pred.currentValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        : pred.currentValue.toLocaleString()}
                    </span>
                  </div>
                  <div style={styles.predArrowSmall}>→</div>
                  <div style={styles.predPredicted}>
                    <span style={styles.predValLabel}>预测</span>
                    <span style={{ ...styles.predValNum, color: dir.color }}>
                      {target === 'price'
                        ? `$${pred.predictedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                        : pred.predictedValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>

                {/* 置信度 */}
                <div style={styles.confSection}>
                  <div style={styles.confLabel}>
                    置信度: <span style={{ color: pred.confidence > 60 ? '#3fb950' : pred.confidence > 40 ? '#d29922' : '#f85149' }}>
                      {pred.confidence}%
                    </span>
                  </div>
                  <div style={styles.confBar}>
                    <div style={{
                      ...styles.confFill,
                      width: `${pred.confidence}%`,
                      background: pred.confidence > 60 ? '#3fb950' : pred.confidence > 40 ? '#d29922' : '#f85149',
                    }} />
                  </div>
                </div>

                {/* 信号 */}
                <div style={styles.signalList}>
                  {pred.signals.map((s, i) => (
                    <div key={i} style={styles.signalItem}>
                      <span style={styles.signalName}>{s.name}</span>
                      <span style={{
                        ...styles.signalDir,
                        color: DIR_LABELS[s.direction].color,
                      }}>
                        {DIR_LABELS[s.direction].arrow} {DIR_LABELS[s.direction].text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 历史预测记录 */}
      <div style={styles.section}>
        <div style={styles.historyHeader}>
          <h3 style={styles.sectionTitle}>历史预测记录</h3>
          <div style={styles.historyFilters}>
            {(['all', 'price', 'tx_volume', 'whale_movement', 'large_tx'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setHistoryFilter(f)}
                style={{
                  ...styles.filterBtn,
                  ...(historyFilter === f ? styles.filterActive : {}),
                }}
              >
                {f === 'all' ? '全部' : TARGET_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.historyList}>
          {filteredHistory.length === 0 ? (
            <div style={styles.emptyText}>暂无历史预测记录</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>时间</th>
                  <th style={styles.th}>类型</th>
                  <th style={styles.th}>预测</th>
                  <th style={styles.th}>实际</th>
                  <th style={styles.th}>置信度</th>
                  <th style={styles.th}>结果</th>
                  <th style={styles.th}>误差</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.slice(0, 50).map((p) => {
                  const dir = DIR_LABELS[p.direction];
                  return (
                    <tr key={p.id}>
                      <td style={styles.td}>
                        {new Date(p.createdAt * 1000).toLocaleTimeString('zh-CN')}
                      </td>
                      <td style={styles.td}>
                        {TARGET_ICONS[p.target]} {TARGET_LABELS[p.target]}
                      </td>
                      <td style={{ ...styles.td, color: dir.color }}>
                        {dir.arrow} {p.predictedChange >= 0 ? '+' : ''}{p.predictedChange.toFixed(2)}%
                      </td>
                      <td style={styles.td}>
                        {p.actualChange !== undefined
                          ? `${p.actualChange >= 0 ? '+' : ''}${p.actualChange.toFixed(2)}%`
                          : '--'}
                      </td>
                      <td style={styles.td}>{p.confidence}%</td>
                      <td style={styles.td}>
                        {p.accurate === true && <span style={{ color: '#3fb950' }}>✓ 正确</span>}
                        {p.accurate === false && <span style={{ color: '#f85149' }}>✗ 错误</span>}
                      </td>
                      <td style={styles.td}>
                        {p.error !== undefined ? `${p.error.toFixed(2)}%` : '--'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={styles.footer}>
        <span>预测每 5 分钟自动生成 | 使用 SMA/EMA/RSI/MACD/布林带等技术指标 | 历史记录保存在本地浏览器</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#1c2128',
    borderRadius: 12,
    border: '1px solid #30363d',
    overflow: 'hidden',
  },
  header: {
    padding: '20px 24px 8px',
  },
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: '#f0f6fc',
    margin: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  countdown: {
    fontSize: 13,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#58a6ff',
  },
  genBtn: {
    padding: '6px 16px',
    fontSize: 12,
    background: '#58a6ff22',
    color: '#58a6ff',
    border: '1px solid #58a6ff44',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 600,
  },
  disclaimer: {
    fontSize: 11,
    color: '#d29922',
    background: '#d2992211',
    padding: '6px 12px',
    borderRadius: 6,
    marginBottom: 4,
  },
  accuracyRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: 10,
    padding: '12px 24px',
  },
  accCard: {
    background: '#0d1117',
    borderRadius: 8,
    padding: '12px 14px',
    textAlign: 'center',
  },
  accIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  accName: {
    fontSize: 12,
    color: '#8b949e',
    marginBottom: 4,
  },
  accValue: {
    fontSize: 20,
    fontWeight: 700,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#f0f6fc',
  },
  accMeta: {
    fontSize: 10,
    color: '#484f58',
    marginTop: 2,
  },
  accError: {
    fontSize: 10,
    color: '#8b949e',
    marginTop: 2,
  },
  section: {
    padding: '0 24px 16px',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#f0f6fc',
    margin: '12px 0 8px',
  },
  predGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 12,
  },
  predCard: {
    background: '#0d1117',
    borderRadius: 8,
    border: '1px solid #30363d',
    padding: '14px 16px',
  },
  predHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
    fontWeight: 600,
    color: '#f0f6fc',
    marginBottom: 10,
  },
  predTimer: {
    fontSize: 12,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#58a6ff',
  },
  predEmpty: {
    textAlign: 'center',
    color: '#484f58',
    padding: 20,
    fontSize: 13,
  },
  predDirection: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 10,
  },
  predArrow: {
    fontSize: 24,
  },
  predValues: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  predCurrent: {
    flex: 1,
  },
  predPredicted: {
    flex: 1,
  },
  predArrowSmall: {
    color: '#484f58',
    fontSize: 14,
  },
  predValLabel: {
    display: 'block',
    fontSize: 10,
    color: '#484f58',
    marginBottom: 2,
  },
  predValNum: {
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#f0f6fc',
  },
  confSection: {
    marginBottom: 10,
  },
  confLabel: {
    fontSize: 11,
    color: '#8b949e',
    marginBottom: 4,
  },
  confBar: {
    height: 6,
    background: '#21262d',
    borderRadius: 3,
    overflow: 'hidden',
  },
  confFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.5s',
  },
  signalList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  signalItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    padding: '2px 0',
    borderBottom: '1px solid #21262d',
  },
  signalName: {
    color: '#8b949e',
  },
  signalDir: {
    fontWeight: 600,
    fontSize: 10,
  },
  historyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  historyFilters: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
  },
  filterBtn: {
    padding: '3px 8px',
    fontSize: 11,
    background: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  filterActive: {
    background: '#58a6ff22',
    color: '#58a6ff',
    borderColor: '#58a6ff',
  },
  historyList: {
    maxHeight: 400,
    overflowY: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  },
  th: {
    textAlign: 'left',
    padding: '8px 10px',
    color: '#8b949e',
    borderBottom: '1px solid #30363d',
    fontSize: 11,
    fontWeight: 600,
  },
  td: {
    padding: '6px 10px',
    color: '#f0f6fc',
    borderBottom: '1px solid #21262d',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
  },
  emptyText: {
    textAlign: 'center',
    color: '#484f58',
    padding: 30,
    fontSize: 13,
  },
  footer: {
    padding: '10px 24px',
    borderTop: '1px solid #30363d',
    fontSize: 11,
    color: '#484f58',
  },
};
