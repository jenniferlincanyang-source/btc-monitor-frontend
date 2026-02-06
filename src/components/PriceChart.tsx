import { useState, useEffect, useRef } from 'react';
import { createChart, IChartApi } from 'lightweight-charts';
import { fetchCurrentPrice, fetchOHLC } from '../api';
import type { PriceData } from '../types';

const INTERVALS = [
  { label: '1天', days: 1 },
  { label: '7天', days: 7 },
  { label: '30天', days: 30 },
  { label: '90天', days: 90 },
  { label: '1年', days: 365 },
];

export default function PriceChart() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const [days, setDays] = useState(30);
  const [price, setPrice] = useState<{
    price: number;
    change24h: number;
    changePercent24h: number;
    high24h: number;
    low24h: number;
    marketCap: number;
    volume24h: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // 获取实时价格
  useEffect(() => {
    const load = () => fetchCurrentPrice().then(setPrice).catch(console.error);
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  // K线图
  useEffect(() => {
    if (!chartRef.current) return;
    setLoading(true);

    // 清理旧图表
    if (chartInstance.current) {
      chartInstance.current.remove();
      chartInstance.current = null;
    }

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 400,
      layout: {
        background: { color: '#1c2128' },
        textColor: '#8b949e',
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: '#30363d33' },
        horzLines: { color: '#30363d33' },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: '#30363d',
      },
      timeScale: {
        borderColor: '#30363d',
        timeVisible: true,
      },
    });
    chartInstance.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#3fb950',
      downColor: '#f85149',
      borderUpColor: '#3fb950',
      borderDownColor: '#f85149',
      wickUpColor: '#3fb950',
      wickDownColor: '#f85149',
    });

    fetchOHLC(days)
      .then((data: PriceData[]) => {
        candleSeries.setData(
          data.map((d) => ({
            time: d.time as any,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          }))
        );
        chart.timeScale().fitContent();
        setLoading(false);
      })
      .catch((err) => {
        console.error('OHLC fetch error:', err);
        setLoading(false);
      });

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
  }, [days]);

  const isUp = price ? price.changePercent24h >= 0 : true;

  return (
    <div style={styles.container}>
      {/* 价格头部 */}
      <div style={styles.header}>
        <div style={styles.priceSection}>
          <div style={styles.symbol}>
            <span style={styles.btcIcon}>₿</span>
            <span style={styles.pairName}>BTC / USD</span>
          </div>
          {price && (
            <>
              <div style={styles.priceValue}>
                ${price.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
              <div style={{ ...styles.change, color: isUp ? '#3fb950' : '#f85149' }}>
                {isUp ? '+' : ''}{price.change24h.toFixed(2)} ({isUp ? '+' : ''}{price.changePercent24h.toFixed(2)}%)
              </div>
            </>
          )}
        </div>

        <div style={styles.statsRow}>
          {price && (
            <>
              <div style={styles.stat}>
                <span style={styles.statLabel}>24h 最高</span>
                <span style={styles.statValue}>${price.high24h.toLocaleString()}</span>
              </div>
              <div style={styles.stat}>
                <span style={styles.statLabel}>24h 最低</span>
                <span style={styles.statValue}>${price.low24h.toLocaleString()}</span>
              </div>
              <div style={styles.stat}>
                <span style={styles.statLabel}>市值</span>
                <span style={styles.statValue}>${(price.marketCap / 1e9).toFixed(1)}B</span>
              </div>
              <div style={styles.stat}>
                <span style={styles.statLabel}>24h 成交量</span>
                <span style={styles.statValue}>${(price.volume24h / 1e9).toFixed(1)}B</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 时间选择 */}
      <div style={styles.intervals}>
        {INTERVALS.map((iv) => (
          <button
            key={iv.days}
            onClick={() => setDays(iv.days)}
            style={{
              ...styles.intervalBtn,
              ...(days === iv.days ? styles.intervalActive : {}),
            }}
          >
            {iv.label}
          </button>
        ))}
      </div>

      {/* 图表 */}
      <div style={styles.chartWrap}>
        {loading && (
          <div style={styles.loading}>加载中...</div>
        )}
        <div ref={chartRef} style={{ width: '100%' }} />
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
  },
  priceSection: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 16,
    flexWrap: 'wrap',
  },
  symbol: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  btcIcon: {
    fontSize: 28,
    color: '#f7931a',
    fontWeight: 700,
  },
  pairName: {
    fontSize: 18,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  priceValue: {
    fontSize: 32,
    fontWeight: 700,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#f0f6fc',
  },
  change: {
    fontSize: 16,
    fontWeight: 600,
    fontFamily: 'JetBrains Mono, monospace',
  },
  statsRow: {
    display: 'flex',
    gap: 24,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  statLabel: {
    fontSize: 11,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 14,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#f0f6fc',
  },
  intervals: {
    display: 'flex',
    gap: 4,
    padding: '0 24px 12px',
  },
  intervalBtn: {
    padding: '4px 12px',
    fontSize: 12,
    background: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s',
  },
  intervalActive: {
    background: '#58a6ff22',
    color: '#58a6ff',
    borderColor: '#58a6ff',
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
    fontSize: 14,
  },
};
