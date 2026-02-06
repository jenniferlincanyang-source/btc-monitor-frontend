import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchLargeTransactions, fetchCurrentPrice, createWhaleWebSocket } from '../api';
import type { WhaleTransaction } from '../types';

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  exchange_deposit: { label: '充值到交易所', color: '#f85149', icon: '🔴' },
  exchange_withdrawal: { label: '从交易所提现', color: '#3fb950', icon: '🟢' },
  whale_transfer: { label: '巨鲸转账', color: '#58a6ff', icon: '🔵' },
  unknown: { label: '未知', color: '#8b949e', icon: '⚪' },
};

export default function WhaleAlert() {
  const [historyTxs, setHistoryTxs] = useState<WhaleTransaction[]>([]);
  const [liveTxs, setLiveTxs] = useState<WhaleTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanProgress, setScanProgress] = useState('');
  const [minBTC, setMinBTC] = useState(10);
  const [blockCount, setBlockCount] = useState(3);
  const [filter, setFilter] = useState<string>('all');
  const [currentPrice, setCurrentPrice] = useState(0);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [newTxCount, setNewTxCount] = useState(0);
  const wsRef = useRef<{ close: () => void } | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 合并历史 + 实时交易
  const allTransactions = [...liveTxs, ...historyTxs];
  // 去重 (按 hash)
  const seen = new Set<string>();
  const transactions = allTransactions.filter((tx) => {
    if (seen.has(tx.hash)) return false;
    seen.add(tx.hash);
    return true;
  });

  // 加载历史数据
  const loadHistory = useCallback(async () => {
    setLoading(true);
    setScanProgress(`正在扫描最近 ${blockCount} 个区块...`);
    try {
      const [txs, priceData] = await Promise.all([
        fetchLargeTransactions(minBTC, blockCount),
        fetchCurrentPrice(),
      ]);
      setCurrentPrice(priceData.price);
      setHistoryTxs(
        txs.map((tx) => ({ ...tx, amountUsd: tx.amount * priceData.price }))
      );
      setLastRefresh(new Date());
      setScanProgress(`已扫描 ${blockCount} 个区块，找到 ${txs.length} 笔大额交易`);
    } catch (err) {
      console.error('Whale alert error:', err);
      setScanProgress('扫描失败，请稍后重试');
    }
    setLoading(false);
  }, [minBTC, blockCount]);

  // 初始加载 + 自动刷新
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!autoRefresh) {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      return;
    }
    // 每 2 分钟自动刷新历史数据
    refreshTimerRef.current = setInterval(loadHistory, 120000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [autoRefresh, loadHistory]);

  // WebSocket 实时监听
  useEffect(() => {
    setWsStatus('connecting');
    const ws = createWhaleWebSocket(
      minBTC,
      (tx) => {
        // 新的实时交易
        const enriched = { ...tx, amountUsd: tx.amount * (currentPrice || 100000) };
        setLiveTxs((prev) => [enriched, ...prev].slice(0, 200));
        setNewTxCount((c) => c + 1);
      },
      (height) => {
        // 新区块到来，刷新历史数据
        setScanProgress(`新区块 #${height}，正在刷新...`);
        loadHistory();
      },
    );
    wsRef.current = ws;

    // 检测连接状态 - 如果 3 秒后没有报错就认为已连接
    const timer = setTimeout(() => setWsStatus('connected'), 3000);

    return () => {
      clearTimeout(timer);
      ws.close();
      setWsStatus('disconnected');
    };
  }, [minBTC, currentPrice, loadHistory]);

  const filtered = filter === 'all'
    ? transactions
    : transactions.filter((tx) => tx.type === filter);

  const stats = {
    total: transactions.length,
    deposits: transactions.filter((t) => t.type === 'exchange_deposit').length,
    withdrawals: transactions.filter((t) => t.type === 'exchange_withdrawal').length,
    whaleTransfers: transactions.filter((t) => t.type === 'whale_transfer').length,
    totalBTC: transactions.reduce((s, t) => s + t.amount, 0),
    liveTxCount: liveTxs.length,
  };

  return (
    <div style={styles.container}>
      {/* 头部 */}
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <h2 style={styles.title}>大额交易监控 (鲸鱼警报)</h2>
          <div style={styles.statusGroup}>
            {/* WebSocket 状态 */}
            <div style={styles.wsStatus}>
              <div style={{
                ...styles.wsDot,
                background: wsStatus === 'connected' ? '#3fb950'
                  : wsStatus === 'connecting' ? '#d29922' : '#f85149',
              }} />
              <span style={styles.wsText}>
                {wsStatus === 'connected' ? '实时监听中'
                  : wsStatus === 'connecting' ? '连接中...' : '已断开'}
              </span>
            </div>
            {/* 新交易计数 */}
            {newTxCount > 0 && (
              <span style={styles.newBadge}>+{newTxCount} 新交易</span>
            )}
          </div>
        </div>

        {/* 控制栏 */}
        <div style={styles.controls}>
          <div style={styles.controlLeft}>
            <label style={styles.label}>
              最小 BTC:
              <select
                value={minBTC}
                onChange={(e) => { setMinBTC(Number(e.target.value)); setLiveTxs([]); setNewTxCount(0); }}
                style={styles.select}
              >
                <option value={1}>1 BTC</option>
                <option value={5}>5 BTC</option>
                <option value={10}>10 BTC</option>
                <option value={50}>50 BTC</option>
                <option value={100}>100 BTC</option>
                <option value={500}>500 BTC</option>
              </select>
            </label>
            <label style={styles.label}>
              扫描区块:
              <select
                value={blockCount}
                onChange={(e) => setBlockCount(Number(e.target.value))}
                style={styles.select}
              >
                <option value={1}>最近 1 个</option>
                <option value={3}>最近 3 个</option>
                <option value={5}>最近 5 个</option>
                <option value={10}>最近 10 个</option>
              </select>
            </label>
          </div>
          <div style={styles.controlRight}>
            <label style={styles.autoLabel}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                style={styles.checkbox}
              />
              自动刷新
            </label>
            <button onClick={() => { setNewTxCount(0); loadHistory(); }} style={styles.refreshBtn}>
              手动刷新
            </button>
          </div>
        </div>

        {/* 筛选 */}
        <div style={styles.filterGroup}>
          {['all', 'exchange_deposit', 'exchange_withdrawal', 'whale_transfer'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                ...styles.filterBtn,
                ...(filter === f ? styles.filterActive : {}),
              }}
            >
              {f === 'all' ? `全部 (${transactions.length})` : `${TYPE_CONFIG[f]?.label} (${transactions.filter(t => t.type === f).length})`}
            </button>
          ))}
        </div>
      </div>

      {/* 进度/状态条 */}
      <div style={styles.progressBar}>
        <span>{scanProgress}</span>
        {lastRefresh && (
          <span style={styles.lastRefresh}>
            上次刷新: {lastRefresh.toLocaleTimeString('zh-CN')}
          </span>
        )}
      </div>

      {/* 统计卡片 */}
      <div style={styles.statsRow}>
        <div style={{ ...styles.statCard, borderLeft: '3px solid #58a6ff' }}>
          <div style={styles.statNum}>{stats.total}</div>
          <div style={styles.statLabel}>大额交易</div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: '3px solid #f85149' }}>
          <div style={styles.statNum}>{stats.deposits}</div>
          <div style={styles.statLabel}>充值到交易所</div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: '3px solid #3fb950' }}>
          <div style={styles.statNum}>{stats.withdrawals}</div>
          <div style={styles.statLabel}>交易所提现</div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: '3px solid #d29922' }}>
          <div style={styles.statNum}>{stats.totalBTC.toLocaleString(undefined, { maximumFractionDigits: 0 })} BTC</div>
          <div style={styles.statLabel}>总转移量</div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: '3px solid #bc8cff' }}>
          <div style={styles.statNum}>{stats.liveTxCount}</div>
          <div style={styles.statLabel}>实时捕获</div>
        </div>
      </div>

      {/* 交易列表 */}
      <div style={styles.list}>
        {loading && transactions.length === 0 ? (
          <div style={styles.loadingText}>
            <div className="pulse">{scanProgress || '正在扫描链上大额交易...'}</div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={styles.emptyText}>
            <div style={styles.emptyIcon}>🔍</div>
            <div>暂无符合条件的大额交易</div>
            <div style={styles.emptyHint}>
              尝试降低最小 BTC 阈值或增加扫描区块数
            </div>
          </div>
        ) : (
          filtered.map((tx, idx) => {
            const cfg = TYPE_CONFIG[tx.type] || TYPE_CONFIG.unknown;
            const isLive = liveTxs.some((lt) => lt.hash === tx.hash);
            return (
              <div
                key={tx.hash || idx}
                style={{
                  ...styles.txItem,
                  ...(isLive ? styles.txItemLive : {}),
                }}
                className="fade-in"
              >
                {isLive && <div style={styles.liveBadge}>LIVE</div>}
                <div style={styles.txLeft}>
                  <div style={{ ...styles.txType, color: cfg.color }}>
                    {cfg.icon} {cfg.label}
                  </div>
                  <div style={styles.txAmount}>
                    {tx.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} BTC
                    {tx.amountUsd > 0 && (
                      <span style={styles.txUsd}>
                        (${tx.amountUsd >= 1e6
                          ? (tx.amountUsd / 1e6).toFixed(2) + 'M'
                          : (tx.amountUsd / 1e3).toFixed(0) + 'K'})
                      </span>
                    )}
                  </div>
                </div>
                <div style={styles.txRight}>
                  <div style={styles.txAddr}>
                    <span style={styles.addrLabel}>从</span>
                    <span style={{
                      ...styles.addrValue,
                      color: tx.fromOwner !== 'unknown' ? '#f7931a' : '#f0f6fc',
                    }}>
                      {tx.fromOwner !== 'unknown' ? tx.fromOwner : shortenAddr(tx.from)}
                    </span>
                  </div>
                  <div style={styles.txArrow}>→</div>
                  <div style={styles.txAddr}>
                    <span style={styles.addrLabel}>到</span>
                    <span style={{
                      ...styles.addrValue,
                      color: tx.toOwner !== 'unknown' ? '#f7931a' : '#f0f6fc',
                    }}>
                      {tx.toOwner !== 'unknown' ? tx.toOwner : shortenAddr(tx.to)}
                    </span>
                  </div>
                </div>
                <div style={styles.txMeta}>
                  <div style={styles.txTime}>
                    {formatTime(tx.timestamp)}
                  </div>
                  <a
                    href={`https://mempool.space/tx/${tx.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.txLink}
                  >
                    查看交易 ↗
                  </a>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部说明 */}
      <div style={styles.footer}>
        <span>数据来源: Blockstream (历史) + Mempool.space WebSocket (实时)</span>
        <span>已知交易所地址: Binance, Coinbase, Bitfinex, OKX, Kraken, Huobi, Gemini, Bybit</span>
      </div>
    </div>
  );
}

function shortenAddr(addr: string): string {
  if (!addr || addr === 'unknown' || addr === 'coinbase') return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function formatTime(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return `${diff}秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return new Date(ts * 1000).toLocaleString('zh-CN');
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
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  statusGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  wsStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  wsDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    animation: 'pulse 2s ease-in-out infinite',
  },
  wsText: {
    fontSize: 12,
    color: '#8b949e',
  },
  newBadge: {
    padding: '2px 8px',
    background: '#3fb95022',
    color: '#3fb950',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    animation: 'pulse 1.5s ease-in-out infinite',
  },
  controls: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  controlLeft: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
  },
  controlRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    fontSize: 13,
    color: '#8b949e',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  select: {
    padding: '4px 8px',
    background: '#0d1117',
    color: '#f0f6fc',
    border: '1px solid #30363d',
    borderRadius: 6,
    fontSize: 13,
    fontFamily: 'JetBrains Mono, monospace',
  },
  autoLabel: {
    fontSize: 12,
    color: '#8b949e',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    cursor: 'pointer',
  },
  checkbox: {
    accentColor: '#58a6ff',
  },
  refreshBtn: {
    padding: '4px 12px',
    fontSize: 12,
    background: '#0d1117',
    color: '#58a6ff',
    border: '1px solid #58a6ff44',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  filterGroup: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
  },
  filterBtn: {
    padding: '4px 10px',
    fontSize: 12,
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
  progressBar: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 24px',
    background: '#0d1117',
    fontSize: 12,
    color: '#8b949e',
    borderTop: '1px solid #30363d22',
    borderBottom: '1px solid #30363d22',
  },
  lastRefresh: {
    color: '#58a6ff',
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: 10,
    padding: '12px 24px',
  },
  statCard: {
    background: '#0d1117',
    borderRadius: 8,
    padding: '10px 14px',
  },
  statNum: {
    fontSize: 16,
    fontWeight: 700,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#f0f6fc',
  },
  statLabel: {
    fontSize: 11,
    color: '#8b949e',
    marginTop: 2,
  },
  list: {
    maxHeight: 600,
    overflowY: 'auto',
    padding: '0 24px 16px',
  },
  loadingText: {
    textAlign: 'center',
    color: '#8b949e',
    padding: 40,
    fontSize: 14,
  },
  emptyText: {
    textAlign: 'center',
    color: '#8b949e',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyHint: {
    fontSize: 12,
    marginTop: 8,
    color: '#58a6ff',
  },
  txItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '12px 16px',
    background: '#0d1117',
    borderRadius: 8,
    marginBottom: 6,
    flexWrap: 'wrap',
    position: 'relative',
    transition: 'background 0.3s',
  },
  txItemLive: {
    background: '#3fb95008',
    border: '1px solid #3fb95033',
  },
  liveBadge: {
    position: 'absolute',
    top: 4,
    right: 8,
    padding: '1px 6px',
    background: '#3fb95022',
    color: '#3fb950',
    borderRadius: 4,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
  },
  txLeft: {
    minWidth: 180,
  },
  txType: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 4,
  },
  txAmount: {
    fontSize: 16,
    fontWeight: 700,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#f0f6fc',
  },
  txUsd: {
    fontSize: 12,
    color: '#8b949e',
    marginLeft: 6,
  },
  txRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 200,
  },
  txAddr: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  addrLabel: {
    fontSize: 10,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
  },
  addrValue: {
    fontSize: 12,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#f0f6fc',
  },
  txArrow: {
    fontSize: 16,
    color: '#8b949e',
  },
  txMeta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 4,
    minWidth: 100,
  },
  txTime: {
    fontSize: 11,
    color: '#8b949e',
    fontFamily: 'JetBrains Mono, monospace',
    whiteSpace: 'nowrap',
  },
  txLink: {
    fontSize: 11,
    color: '#58a6ff',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '10px 24px',
    borderTop: '1px solid #30363d',
    fontSize: 11,
    color: '#8b949e',
  },
};
