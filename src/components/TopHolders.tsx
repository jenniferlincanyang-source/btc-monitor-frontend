import { useState, useEffect, useCallback } from 'react';
import { fetchTopHolders, fetchExchangeFlows } from '../api';
import { predictHolderTrend, adjustConfidence } from '../prediction';
import EmbeddedPredictionPanel from './EmbeddedPredictionPanel';
import type { GenerateResult } from './EmbeddedPredictionPanel';
import type { TopHolder } from '../types';

export default function TopHolders() {
  const [holders, setHolders] = useState<TopHolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<'balance' | 'percent'>('balance');
  const PAGE_SIZE = 20;

  useEffect(() => {
    fetchTopHolders()
      .then((data) => {
        setHolders(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Top holders error:', err);
        setLoading(false);
      });
  }, []);

  const sorted = [...holders].sort((a, b) =>
    sortBy === 'balance' ? b.balance - a.balance : b.percentOfTotal - a.percentOfTotal
  );
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  // 统计
  const exchangeHolders = holders.filter((h) => !['巨鲸地址', 'unknown', 'Satoshi Era Wallet'].includes(h.label));
  const exchangeBTC = exchangeHolders.reduce((s, h) => s + h.balance, 0);
  const totalBTC = holders.reduce((s, h) => s + h.balance, 0);

  const handleGenerate = useCallback(async (): Promise<GenerateResult | null> => {
    if (holders.length === 0) return null;
    const nonExBTC = totalBTC - exchangeBTC;
    const exRatio = totalBTC > 0 ? exchangeBTC / totalBTC : 0;
    const flowData = await fetchExchangeFlows(3).catch(() => []);
    const recentNet = flowData.length > 0 ? flowData.reduce((s: number, f: { netflow: number }) => s + f.netflow, 0) : 0;
    const result = predictHolderTrend(totalBTC, exchangeBTC, nonExBTC, exRatio, recentNet);
    const conf = adjustConfidence(result.confidence, 50);
    return {
      direction: result.direction,
      change: result.change,
      confidence: conf,
      currentValue: totalBTC,
      predictedValue: totalBTC * (1 + result.change / 100),
      reasons: result.reasons,
    };
  }, [holders, totalBTC, exchangeBTC]);

  const handleResolve = useCallback(async (): Promise<number> => {
    const data = await fetchTopHolders().catch(() => []);
    return data.reduce((s: number, h: TopHolder) => s + h.balance, 0);
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>BTC Top 100 持有者</h2>
        <div style={styles.controls}>
          <span style={styles.sortLabel}>排序:</span>
          <button
            onClick={() => setSortBy('balance')}
            style={{ ...styles.sortBtn, ...(sortBy === 'balance' ? styles.sortActive : {}) }}
          >
            余额
          </button>
          <button
            onClick={() => setSortBy('percent')}
            style={{ ...styles.sortBtn, ...(sortBy === 'percent' ? styles.sortActive : {}) }}
          >
            占比
          </button>
        </div>
      </div>

      {/* 概览 */}
      <div style={styles.overview}>
        <div style={styles.overviewItem}>
          <div style={styles.ovLabel}>Top 100 总持有</div>
          <div style={styles.ovValue}>{totalBTC.toLocaleString()} BTC</div>
          <div style={styles.ovSub}>{((totalBTC / 21000000) * 100).toFixed(2)}% 总供应量</div>
        </div>
        <div style={styles.overviewItem}>
          <div style={styles.ovLabel}>交易所持有</div>
          <div style={{ ...styles.ovValue, color: '#d29922' }}>{exchangeBTC.toLocaleString()} BTC</div>
          <div style={styles.ovSub}>{((exchangeBTC / totalBTC) * 100).toFixed(1)}% of Top 100</div>
        </div>
        <div style={styles.overviewItem}>
          <div style={styles.ovLabel}>非交易所巨鲸</div>
          <div style={{ ...styles.ovValue, color: '#bc8cff' }}>{(totalBTC - exchangeBTC).toLocaleString()} BTC</div>
          <div style={styles.ovSub}>{(((totalBTC - exchangeBTC) / totalBTC) * 100).toFixed(1)}% of Top 100</div>
        </div>
      </div>

      {/* 持有者分布条 */}
      <div style={styles.barWrap}>
        <div style={styles.barBg}>
          <div
            style={{
              ...styles.barFill,
              width: `${(exchangeBTC / totalBTC) * 100}%`,
              background: 'linear-gradient(90deg, #d29922, #f7931a)',
            }}
          />
        </div>
        <div style={styles.barLabels}>
          <span style={{ color: '#d29922' }}>交易所 {((exchangeBTC / totalBTC) * 100).toFixed(1)}%</span>
          <span style={{ color: '#bc8cff' }}>非交易所 {(((totalBTC - exchangeBTC) / totalBTC) * 100).toFixed(1)}%</span>
        </div>
      </div>

      {/* 表格 */}
      {loading ? (
        <div style={styles.loadingText}>加载 Top 100 持有者数据...</div>
      ) : (
        <>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>地址</th>
                  <th style={styles.th}>标签</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>余额 (BTC)</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>占比</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((h) => (
                  <tr key={h.rank} style={styles.tr}>
                    <td style={styles.td}>{h.rank}</td>
                    <td style={styles.tdAddr}>
                      <a
                        href={`https://mempool.space/address/${h.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.addrLink}
                      >
                        {h.address.slice(0, 10)}...{h.address.slice(-6)}
                      </a>
                    </td>
                    <td style={styles.td}>
                      <span style={{
                        ...styles.tag,
                        background: getTagColor(h.label),
                      }}>
                        {h.label}
                      </span>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {h.balance.toLocaleString()}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                      {h.percentOfTotal.toFixed(4)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          <div style={styles.pagination}>
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              style={{ ...styles.pageBtn, opacity: page === 0 ? 0.3 : 1 }}
            >
              上一页
            </button>
            <span style={styles.pageInfo}>{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              style={{ ...styles.pageBtn, opacity: page >= totalPages - 1 ? 0.3 : 1 }}
            >
              下一页
            </button>
          </div>
        </>
      )}

      <div style={{ padding: '0 24px 16px' }}>
        <EmbeddedPredictionPanel
          targetType="holder_trend"
          targetLabel="巨鲸持仓趋势"
          storageKey="holder_trend"
          onGenerate={handleGenerate}
          onResolve={handleResolve}
        />
      </div>
    </div>
  );
}

function getTagColor(label: string): string {
  if (label.includes('Binance')) return '#f7931a33';
  if (label.includes('Coinbase')) return '#0052ff33';
  if (label.includes('Bitfinex')) return '#16b15733';
  if (label.includes('Kraken')) return '#5741d933';
  if (label.includes('OKX')) return '#00000033';
  if (label.includes('Huobi')) return '#2daaed33';
  if (label.includes('Gemini')) return '#00dcfa33';
  if (label === '巨鲸地址') return '#bc8cff33';
  if (label.includes('Satoshi')) return '#f7931a22';
  return '#8b949e22';
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
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  sortLabel: {
    fontSize: 12,
    color: '#8b949e',
  },
  sortBtn: {
    padding: '4px 10px',
    fontSize: 12,
    background: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  sortActive: {
    background: '#58a6ff22',
    color: '#58a6ff',
    borderColor: '#58a6ff',
  },
  overview: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
    padding: '0 24px 16px',
  },
  overviewItem: {
    background: '#0d1117',
    borderRadius: 8,
    padding: '12px 16px',
  },
  ovLabel: {
    fontSize: 11,
    color: '#8b949e',
  },
  ovValue: {
    fontSize: 18,
    fontWeight: 700,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#f0f6fc',
    marginTop: 4,
  },
  ovSub: {
    fontSize: 11,
    color: '#8b949e',
    marginTop: 2,
  },
  barWrap: {
    padding: '0 24px 16px',
  },
  barBg: {
    height: 8,
    background: '#bc8cff44',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.5s ease',
  },
  barLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    marginTop: 4,
  },
  loadingText: {
    textAlign: 'center',
    color: '#8b949e',
    padding: 40,
    fontSize: 14,
  },
  tableWrap: {
    overflowX: 'auto',
    padding: '0 24px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '8px 12px',
    color: '#8b949e',
    fontSize: 11,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    borderBottom: '1px solid #30363d',
    whiteSpace: 'nowrap',
  },
  tr: {
    borderBottom: '1px solid #30363d22',
  },
  td: {
    padding: '8px 12px',
    color: '#f0f6fc',
    whiteSpace: 'nowrap',
  },
  tdAddr: {
    padding: '8px 12px',
  },
  addrLink: {
    color: '#58a6ff',
    textDecoration: 'none',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 12,
  },
  tag: {
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    color: '#f0f6fc',
    whiteSpace: 'nowrap',
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    padding: '16px 24px',
  },
  pageBtn: {
    padding: '6px 16px',
    fontSize: 12,
    background: '#0d1117',
    color: '#f0f6fc',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  pageInfo: {
    fontSize: 12,
    color: '#8b949e',
    fontFamily: 'JetBrains Mono, monospace',
  },
};
