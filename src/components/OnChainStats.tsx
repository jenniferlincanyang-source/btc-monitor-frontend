import { useState, useEffect } from 'react';
import { fetchOnChainMetrics, fetchMempoolInfo } from '../api';
import type { OnChainMetrics } from '../types';

type MempoolData = {
  count: number;
  vsize: number;
  totalFee: number;
  feeRates: { fastest: number; halfHour: number; hour: number; economy: number };
};

export default function OnChainStats() {
  const [metrics, setMetrics] = useState<OnChainMetrics | null>(null);
  const [mempool, setMempool] = useState<MempoolData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const load = () => {
      const errs: string[] = [];

      // 独立请求，互不影响
      const p1 = fetchOnChainMetrics()
        .then(setMetrics)
        .catch((err) => {
          console.error('On-chain metrics error:', err);
          errs.push('链上指标');
        });

      const p2 = fetchMempoolInfo()
        .then(setMempool)
        .catch((err) => {
          console.error('Mempool info error:', err);
          errs.push('内存池');
        });

      Promise.allSettled([p1, p2]).then(() => {
        setErrors(errs);
        setLoading(false);
      });
    };
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingText}>加载链上指标...</div>
      </div>
    );
  }

  // 如果两个都失败了
  if (!metrics && !mempool) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>链上实时指标</h2>
        <div style={styles.errorBox}>
          数据加载失败，请检查网络连接后刷新页面
          {errors.length > 0 && (
            <div style={styles.errorDetail}>失败模块: {errors.join(', ')}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>链上实时指标</h2>

      {errors.length > 0 && (
        <div style={styles.warnBox}>
          部分数据加载失败 ({errors.join(', ')})，已显示可用数据
        </div>
      )}

      <div style={styles.grid}>
        {/* 区块信息 - 来自 metrics */}
        <MetricCard
          label="区块高度"
          value={metrics?.blockHeight ? metrics.blockHeight.toLocaleString() : '-'}
          icon="⛓"
          color="#58a6ff"
        />
        <MetricCard
          label="全网算力"
          value={metrics?.hashRate ? formatHashRate(metrics.hashRate) : '-'}
          icon="⚡"
          color="#3fb950"
        />
        <MetricCard
          label="挖矿难度"
          value={metrics?.difficulty ? (metrics.difficulty / 1e12).toFixed(2) + 'T' : '-'}
          icon="🎯"
          color="#d29922"
        />
        <MetricCard
          label="预估24h交易"
          value={metrics?.transactionCount ? metrics.transactionCount.toLocaleString() : '-'}
          icon="📊"
          color="#bc8cff"
          sub={metrics?.transactionCount ? '基于最近区块估算' : ''}
        />

        {/* 内存池 - 来自 mempool */}
        <MetricCard
          label="内存池交易数"
          value={mempool?.count != null ? mempool.count.toLocaleString() : '-'}
          icon="🔄"
          color="#58a6ff"
          sub={mempool?.vsize ? `${(mempool.vsize / 1e6).toFixed(1)} MB` : ''}
        />
        <MetricCard
          label="最快手续费"
          value={mempool?.feeRates ? `${mempool.feeRates.fastest} sat/vB` : '-'}
          icon="🚀"
          color="#f85149"
        />
        <MetricCard
          label="半小时手续费"
          value={mempool?.feeRates ? `${mempool.feeRates.halfHour} sat/vB` : '-'}
          icon="⏱"
          color="#d29922"
        />
        <MetricCard
          label="经济手续费"
          value={mempool?.feeRates ? `${mempool.feeRates.economy} sat/vB` : '-'}
          icon="💰"
          color="#3fb950"
        />
      </div>

      {/* 手续费等级条 */}
      {mempool?.feeRates && (
        <div style={styles.feeSection}>
          <div style={styles.feeTitle}>手续费等级</div>
          <div style={styles.feeBar}>
            <FeeLevel label="经济" rate={mempool.feeRates.economy} color="#3fb950" max={mempool.feeRates.fastest} />
            <FeeLevel label="1小时" rate={mempool.feeRates.hour} color="#d29922" max={mempool.feeRates.fastest} />
            <FeeLevel label="30分钟" rate={mempool.feeRates.halfHour} color="#f7931a" max={mempool.feeRates.fastest} />
            <FeeLevel label="最快" rate={mempool.feeRates.fastest} color="#f85149" max={mempool.feeRates.fastest} />
          </div>
        </div>
      )}

      <div style={styles.updateNote}>
        数据来源: Mempool.space (全部接口支持 CORS) | 每分钟自动刷新
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon, color, sub }: {
  label: string;
  value: string;
  icon: string;
  color: string;
  sub?: string;
}) {
  return (
    <div style={{ ...cardStyles.card, borderTop: `2px solid ${color}` }}>
      <div style={cardStyles.icon}>{icon}</div>
      <div style={cardStyles.label}>{label}</div>
      <div style={{ ...cardStyles.value, color }}>{value}</div>
      {sub && <div style={cardStyles.sub}>{sub}</div>}
    </div>
  );
}

function FeeLevel({ label, rate, color, max }: {
  label: string;
  rate: number;
  color: string;
  max: number;
}) {
  const width = Math.max(10, (rate / max) * 100);
  return (
    <div style={feeStyles.item}>
      <span style={feeStyles.label}>{label}</span>
      <div style={feeStyles.barBg}>
        <div style={{ ...feeStyles.barFill, width: `${width}%`, background: color }} />
      </div>
      <span style={{ ...feeStyles.rate, color }}>{rate} sat/vB</span>
    </div>
  );
}

function formatHashRate(rate: number): string {
  if (rate >= 1e18) return (rate / 1e18).toFixed(1) + ' EH/s';
  if (rate >= 1e15) return (rate / 1e15).toFixed(1) + ' PH/s';
  if (rate >= 1e12) return (rate / 1e12).toFixed(1) + ' TH/s';
  if (rate >= 1e9) return (rate / 1e9).toFixed(1) + ' GH/s';
  if (rate >= 1e6) return (rate / 1e6).toFixed(1) + ' MH/s';
  return rate.toFixed(0) + ' H/s';
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#1c2128',
    borderRadius: 12,
    border: '1px solid #30363d',
    padding: '20px 24px',
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: '#f0f6fc',
    marginBottom: 16,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 12,
  },
  loadingText: {
    textAlign: 'center',
    color: '#8b949e',
    padding: 40,
  },
  errorBox: {
    textAlign: 'center',
    color: '#f85149',
    padding: '30px 20px',
    background: '#f8514911',
    borderRadius: 8,
    fontSize: 14,
  },
  errorDetail: {
    marginTop: 8,
    fontSize: 12,
    color: '#8b949e',
  },
  warnBox: {
    padding: '8px 14px',
    marginBottom: 12,
    background: '#d2992211',
    border: '1px solid #d2992244',
    borderRadius: 6,
    fontSize: 12,
    color: '#d29922',
  },
  feeSection: {
    marginTop: 20,
    padding: '16px',
    background: '#0d1117',
    borderRadius: 8,
  },
  feeTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#f0f6fc',
    marginBottom: 12,
  },
  feeBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  updateNote: {
    marginTop: 16,
    fontSize: 11,
    color: '#8b949e',
    textAlign: 'center',
  },
};

const cardStyles: Record<string, React.CSSProperties> = {
  card: {
    background: '#0d1117',
    borderRadius: 8,
    padding: '14px 16px',
  },
  icon: {
    fontSize: 20,
    marginBottom: 4,
  },
  label: {
    fontSize: 11,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 18,
    fontWeight: 700,
    fontFamily: 'JetBrains Mono, monospace',
    marginTop: 4,
  },
  sub: {
    fontSize: 11,
    color: '#8b949e',
    marginTop: 2,
  },
};

const feeStyles: Record<string, React.CSSProperties> = {
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    fontSize: 12,
    color: '#8b949e',
    width: 60,
    textAlign: 'right',
  },
  barBg: {
    flex: 1,
    height: 6,
    background: '#30363d',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.5s ease',
  },
  rate: {
    fontSize: 12,
    fontFamily: 'JetBrains Mono, monospace',
    width: 80,
    fontWeight: 600,
  },
};
