import { useState, useEffect, useRef } from 'react';
import { createChart, IChartApi } from 'lightweight-charts';
import { fetchExchangeFlows } from '../api';
import type { ExchangeFlowData } from '../types';

export default function ExchangeFlow() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const [flows, setFlows] = useState<ExchangeFlowData[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchExchangeFlows(days)
      .then((data) => {
        setFlows(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Exchange flow error:', err);
        setLoading(false);
      });
  }, [days]);

  useEffect(() => {
    if (!chartRef.current || flows.length === 0) return;

    if (chartInstance.current) {
      chartInstance.current.remove();
      chartInstance.current = null;
    }

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
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

    // 流入柱状图 (红色)
    const inflowSeries = chart.addHistogramSeries({
      color: '#f8514966',
      priceFormat: { type: 'volume' },
      priceScaleId: 'left',
    });

    // 净流入线
    const netflowSeries = chart.addLineSeries({
      color: '#58a6ff',
      lineWidth: 2,
      priceScaleId: 'right',
    });

    inflowSeries.setData(
      flows.map((f) => ({
        time: f.timestamp as any,
        value: f.inflow,
        color: f.netflow > 0 ? '#f8514988' : '#3fb95088',
      }))
    );

    netflowSeries.setData(
      flows.map((f) => ({
        time: f.timestamp as any,
        value: f.netflow,
      }))
    );

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartRef.current && chartInstance.current) {
        chartInstance.current.applyOptions({ width: chartRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartInstance.current = null;
    };
  }, [flows]);

  const totalInflow = flows.reduce((s, f) => s + f.inflow, 0);
  const totalOutflow = flows.reduce((s, f) => s + f.outflow, 0);
  const totalNetflow = totalInflow - totalOutflow;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>交易所资金流向</h2>
        <div style={styles.dayBtns}>
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                ...styles.dayBtn,
                ...(days === d ? styles.dayActive : {}),
              }}
            >
              {d}天
            </button>
          ))}
        </div>
      </div>

      <div style={styles.statsRow}>
        <div style={{ ...styles.stat, borderLeft: '3px solid #f85149' }}>
          <div style={styles.statLabel}>总流入</div>
          <div style={{ ...styles.statValue, color: '#f85149' }}>
            {totalInflow.toLocaleString()} BTC
          </div>
        </div>
        <div style={{ ...styles.stat, borderLeft: '3px solid #3fb950' }}>
          <div style={styles.statLabel}>总流出</div>
          <div style={{ ...styles.statValue, color: '#3fb950' }}>
            {totalOutflow.toLocaleString()} BTC
          </div>
        </div>
        <div style={{ ...styles.stat, borderLeft: `3px solid ${totalNetflow > 0 ? '#f85149' : '#3fb950'}` }}>
          <div style={styles.statLabel}>净流入</div>
          <div style={{ ...styles.statValue, color: totalNetflow > 0 ? '#f85149' : '#3fb950' }}>
            {totalNetflow > 0 ? '+' : ''}{totalNetflow.toLocaleString()} BTC
          </div>
        </div>
      </div>

      <div style={styles.legend}>
        <span><span style={{ color: '#f85149' }}>■</span> 净流入(红) / <span style={{ color: '#3fb950' }}>■</span> 净流出(绿)</span>
        <span><span style={{ color: '#58a6ff' }}>—</span> 净流入趋势线</span>
      </div>

      <div style={styles.chartWrap}>
        {loading && <div style={styles.loading}>加载中...</div>}
        <div ref={chartRef} style={{ width: '100%' }} />
      </div>

      <div style={styles.note}>
        净流入为正 = 更多 BTC 进入交易所 (潜在卖压) | 净流入为负 = 更多 BTC 离开交易所 (囤币信号)
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
    padding: '20px 24px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  dayBtns: {
    display: 'flex',
    gap: 4,
  },
  dayBtn: {
    padding: '4px 12px',
    fontSize: 12,
    background: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  dayActive: {
    background: '#58a6ff22',
    color: '#58a6ff',
    borderColor: '#58a6ff',
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
    padding: '0 24px 12px',
  },
  stat: {
    background: '#0d1117',
    borderRadius: 8,
    padding: '10px 14px',
  },
  statLabel: {
    fontSize: 11,
    color: '#8b949e',
  },
  statValue: {
    fontSize: 16,
    fontWeight: 700,
    fontFamily: 'JetBrains Mono, monospace',
    marginTop: 2,
  },
  legend: {
    display: 'flex',
    gap: 20,
    padding: '0 24px 8px',
    fontSize: 11,
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
  note: {
    padding: '8px 24px 16px',
    fontSize: 11,
    color: '#8b949e',
    fontStyle: 'italic',
  },
};
