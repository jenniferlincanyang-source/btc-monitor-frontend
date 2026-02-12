import { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, IChartApi } from 'lightweight-charts';
import { fetchPriceHistory, fetchExchangeFlows } from '../api';
import { predictCorrelationSignal, adjustConfidence } from '../prediction';
import EmbeddedPredictionPanel from './EmbeddedPredictionPanel';
import type { GenerateResult } from './EmbeddedPredictionPanel';
import type { ExchangeFlowData } from '../types';

export default function CorrelationDashboard() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [correlation, setCorrelation] = useState<number | null>(null);
  const [signal, setSignal] = useState<{ type: string; message: string; color: string } | null>(null);
  const [pricesCache, setPricesCache] = useState<number[]>([]);
  const [netflowsCache, setNetflowsCache] = useState<number[]>([]);
  const [corrCache, setCorrCache] = useState(0);

  useEffect(() => {
    if (!chartRef.current) return;
    setLoading(true);

    Promise.all([
      fetchPriceHistory(30),
      fetchExchangeFlows(30),
    ])
      .then(([priceData, flowData]) => {
        if (chartInstance.current) {
          chartInstance.current.remove();
          chartInstance.current = null;
        }

        const chart = createChart(chartRef.current!, {
          width: chartRef.current!.clientWidth,
          height: 300,
          layout: {
            background: { color: '#1c2128' },
            textColor: '#8b949e',
            fontFamily: 'JetBrains Mono, monospace',
          },
          grid: {
            vertLines: { color: '#30363d33' },
            horzLines: { color: '#30363d33' },
          },
          rightPriceScale: { borderColor: '#30363d' },
          timeScale: { borderColor: '#30363d', timeVisible: true },
        });
        chartInstance.current = chart;

        // 价格线
        const priceSeries = chart.addLineSeries({
          color: '#f7931a',
          lineWidth: 2,
          priceScaleId: 'right',
          title: 'BTC Price',
        });

        // 净流入线
        const flowSeries = chart.addLineSeries({
          color: '#58a6ff',
          lineWidth: 2,
          priceScaleId: 'left',
          title: 'Net Flow',
        });

        priceSeries.setData(
          priceData.map((p) => ({ time: p.time as any, value: p.price }))
        );

        flowSeries.setData(
          flowData.map((f) => ({ time: f.timestamp as any, value: f.netflow }))
        );

        chart.timeScale().fitContent();

        // 计算相关性
        if (priceData.length > 5 && flowData.length > 5) {
          const prices = priceData.slice(-flowData.length).map((p) => p.price);
          const flows = flowData.map((f) => f.netflow);
          const minLen = Math.min(prices.length, flows.length);
          const corr = pearsonCorrelation(
            prices.slice(0, minLen),
            flows.slice(0, minLen)
          );
          setCorrelation(corr);

          // Cache for prediction
          setPricesCache(prices.slice(0, minLen));
          setNetflowsCache(flows.slice(0, minLen));
          setCorrCache(corr);
          const recentNetflow = flowData.slice(-3).reduce((s, f) => s + f.netflow, 0);
          if (recentNetflow > 3000) {
            setSignal({
              type: '卖压警告',
              message: '近期大量 BTC 流入交易所，可能存在卖压',
              color: '#f85149',
            });
          } else if (recentNetflow < -3000) {
            setSignal({
              type: '囤币信号',
              message: '近期大量 BTC 从交易所流出，持有者在囤币',
              color: '#3fb950',
            });
          } else {
            setSignal({
              type: '中性',
              message: '交易所资金流向平衡，无明显方向信号',
              color: '#d29922',
            });
          }
        }

        setLoading(false);

        const handleResize = () => {
          if (chartRef.current && chartInstance.current) {
            chartInstance.current.applyOptions({ width: chartRef.current.clientWidth });
          }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
      })
      .catch((err) => {
        console.error('Correlation error:', err);
        setLoading(false);
      });

    return () => {
      if (chartInstance.current) {
        chartInstance.current.remove();
        chartInstance.current = null;
      }
    };
  }, []);

  const handleGenerate = useCallback(async (): Promise<GenerateResult | null> => {
    if (pricesCache.length < 10 || netflowsCache.length < 10) return null;
    const result = predictCorrelationSignal(pricesCache, netflowsCache, corrCache);
    const conf = adjustConfidence(result.confidence, 50);
    return {
      direction: result.direction,
      change: result.change,
      confidence: conf,
      currentValue: Math.abs(corrCache) * 100,
      predictedValue: Math.abs(corrCache) * 100 * (1 + result.change / 100),
      reasons: result.reasons,
    };
  }, [pricesCache, netflowsCache, corrCache]);

  const handleResolve = useCallback(async (): Promise<number> => {
    try {
      const [priceData, flowData] = await Promise.all([fetchPriceHistory(30), fetchExchangeFlows(30)]);
      if (priceData.length > 5 && flowData.length > 5) {
        const prices = priceData.slice(-flowData.length).map((p) => p.price);
        const flows = flowData.map((f: ExchangeFlowData) => f.netflow);
        const minLen = Math.min(prices.length, flows.length);
        return Math.abs(pearsonCorrelation(prices.slice(0, minLen), flows.slice(0, minLen))) * 100;
      }
    } catch { /* ignore */ }
    return 0;
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>链上数据与行情关联分析</h2>
      </div>

      {/* 信号卡片 */}
      {signal && (
        <div style={{ ...styles.signalCard, borderLeft: `4px solid ${signal.color}` }}>
          <div style={{ ...styles.signalType, color: signal.color }}>{signal.type}</div>
          <div style={styles.signalMsg}>{signal.message}</div>
          {correlation !== null && (
            <div style={styles.corrValue}>
              价格-资金流相关系数: <span style={{ color: getCorrelationColor(correlation) }}>
                {correlation.toFixed(3)}
              </span>
              <span style={styles.corrLabel}>
                ({getCorrelationLabel(correlation)})
              </span>
            </div>
          )}
        </div>
      )}

      {/* 图例 */}
      <div style={styles.legend}>
        <span><span style={{ color: '#f7931a' }}>—</span> BTC 价格 (右轴)</span>
        <span><span style={{ color: '#58a6ff' }}>—</span> 交易所净流入 (左轴)</span>
      </div>

      {/* 图表 */}
      <div style={styles.chartWrap}>
        {loading && <div style={styles.loading}>分析中...</div>}
        <div ref={chartRef} style={{ width: '100%' }} />
      </div>

      {/* 解读说明 */}
      <div style={styles.interpretation}>
        <div style={styles.interpTitle}>指标解读</div>
        <div style={styles.interpGrid}>
          <div style={styles.interpItem}>
            <div style={{ ...styles.interpDot, background: '#f85149' }} />
            <div>
              <strong>净流入增加</strong>: BTC 大量流入交易所，通常预示卖压增加，价格可能承压
            </div>
          </div>
          <div style={styles.interpItem}>
            <div style={{ ...styles.interpDot, background: '#3fb950' }} />
            <div>
              <strong>净流出增加</strong>: BTC 大量从交易所提出，表示持有者倾向长期持有，看涨信号
            </div>
          </div>
          <div style={styles.interpItem}>
            <div style={{ ...styles.interpDot, background: '#d29922' }} />
            <div>
              <strong>大额充值</strong>: 巨鲸向交易所充值大额 BTC，可能准备出售，需关注后续价格走势
            </div>
          </div>
          <div style={styles.interpItem}>
            <div style={{ ...styles.interpDot, background: '#bc8cff' }} />
            <div>
              <strong>大额提现</strong>: 巨鲸从交易所提取大额 BTC 到冷钱包，通常是看涨的长期持有行为
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '0 24px 16px' }}>
        <EmbeddedPredictionPanel
          targetType="correlation_signal"
          targetLabel="行情联动信号"
          storageKey="correlation_signal"
          onGenerate={handleGenerate}
          onResolve={handleResolve}
        />
      </div>
    </div>
  );
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function getCorrelationColor(corr: number): string {
  if (Math.abs(corr) > 0.7) return '#f85149';
  if (Math.abs(corr) > 0.4) return '#d29922';
  return '#3fb950';
}

function getCorrelationLabel(corr: number): string {
  const abs = Math.abs(corr);
  if (abs > 0.7) return '强相关';
  if (abs > 0.4) return '中等相关';
  if (abs > 0.2) return '弱相关';
  return '几乎无关';
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#1c2128',
    borderRadius: 12,
    border: '1px solid #30363d',
    overflow: 'hidden',
  },
  header: {
    padding: '20px 24px 12px',
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  signalCard: {
    margin: '0 24px 16px',
    padding: '14px 18px',
    background: '#0d1117',
    borderRadius: 8,
  },
  signalType: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 4,
  },
  signalMsg: {
    fontSize: 13,
    color: '#f0f6fc',
    marginBottom: 8,
  },
  corrValue: {
    fontSize: 13,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#8b949e',
  },
  corrLabel: {
    fontSize: 12,
    marginLeft: 6,
  },
  legend: {
    display: 'flex',
    gap: 20,
    padding: '0 24px 8px',
    fontSize: 12,
    color: '#8b949e',
  },
  chartWrap: {
    position: 'relative',
    padding: '0 4px 4px',
  },
  loading: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    color: '#8b949e',
    zIndex: 10,
  },
  interpretation: {
    padding: '16px 24px 20px',
    borderTop: '1px solid #30363d',
  },
  interpTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#f0f6fc',
    marginBottom: 12,
  },
  interpGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 10,
  },
  interpItem: {
    display: 'flex',
    gap: 10,
    fontSize: 12,
    color: '#8b949e',
    lineHeight: 1.5,
  },
  interpDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    marginTop: 4,
    flexShrink: 0,
  },
};
