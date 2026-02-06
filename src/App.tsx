import { useState } from 'react';
import ErrorBoundary from './ErrorBoundary';
import PriceChart from './components/PriceChart';
import WhaleAlert from './components/WhaleAlert';
import ExchangeFlow from './components/ExchangeFlow';
import TopHolders from './components/TopHolders';
import OnChainStats from './components/OnChainStats';
import CorrelationDashboard from './components/CorrelationDashboard';
import AlertMonitor from './components/AlertMonitor';
import AlertPanel from './components/AlertPanel';
import PredictionDashboard from './components/PredictionDashboard';
import { useAlerts } from './hooks/useAlerts';
import { usePredictions } from './hooks/usePredictions';

type Tab = 'overview' | 'whale' | 'exchange' | 'holders' | 'correlation' | 'alerts' | 'prediction';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'overview', label: '总览', icon: '📊' },
  { key: 'whale', label: '大额交易', icon: '🐋' },
  { key: 'exchange', label: '交易所流向', icon: '🏦' },
  { key: 'holders', label: 'Top 100', icon: '👑' },
  { key: 'correlation', label: '关联分析', icon: '🔗' },
  { key: 'alerts', label: '实时预警', icon: '🚨' },
  { key: 'prediction', label: '预测', icon: '🔮' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);

  const {
    alerts,
    toasts,
    unreadCount,
    addAlert,
    markRead,
    markAllRead,
    clearAll,
    dismissToast,
  } = useAlerts();

  const {
    activePredictions,
    resolvedPredictions,
    addPrediction,
    resolvePrediction,
    getAccuracy,
  } = usePredictions();

  return (
    <div style={styles.app}>
      {/* 顶部导航 */}
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.btcIcon}>₿</span>
          <span style={styles.logoText}>BTC 链上数据与行情联动看板</span>
        </div>
        <nav style={styles.nav}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                ...styles.navBtn,
                ...(tab === t.key ? styles.navActive : {}),
              }}
            >
              <span style={styles.navIcon}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
        <div style={styles.headerRight}>
          <AlertPanel
            alerts={alerts}
            toasts={toasts}
            unreadCount={unreadCount}
            isOpen={alertPanelOpen}
            onToggle={() => setAlertPanelOpen((o) => !o)}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
            onClearAll={clearAll}
            onDismissToast={dismissToast}
          />
          <div style={styles.liveDot} />
          <span style={styles.liveText}>实时</span>
        </div>
      </header>

      {/* 内容区 */}
      <main style={styles.main}>
        <ErrorBoundary>
          {tab === 'overview' && (
            <div style={styles.overviewGrid}>
              <div style={styles.fullWidth}>
                <PriceChart />
              </div>
              <div style={styles.fullWidth}>
                <OnChainStats />
              </div>
              <div style={styles.halfWidth}>
                <ExchangeFlow />
              </div>
              <div style={styles.halfWidth}>
                <CorrelationDashboard />
              </div>
            </div>
          )}
          {tab === 'whale' && <WhaleAlert />}
          {tab === 'exchange' && <ExchangeFlow />}
          {tab === 'holders' && <TopHolders />}
          {tab === 'correlation' && <CorrelationDashboard />}
          {tab === 'alerts' && <AlertMonitor addAlert={addAlert} alerts={alerts} />}
          {tab === 'prediction' && (
            <PredictionDashboard
              activePredictions={activePredictions}
              resolvedPredictions={resolvedPredictions}
              addPrediction={addPrediction}
              resolvePrediction={resolvePrediction}
              getAccuracy={getAccuracy}
            />
          )}
        </ErrorBoundary>
      </main>

      {/* 底部 */}
      <footer style={styles.footer}>
        <span>数据来源: CoinGecko | Blockchain.com | Mempool.space | Blockchair | Blockstream</span>
        <span>所有 API 均为免费公开接口，无需 API Key</span>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 24px',
    background: '#161b22',
    borderBottom: '1px solid #30363d',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    flexWrap: 'wrap',
    gap: 12,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  btcIcon: {
    fontSize: 28,
    color: '#f7931a',
    fontWeight: 700,
  },
  logoText: {
    fontSize: 16,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  nav: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
  },
  navBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    fontSize: 13,
    background: 'transparent',
    color: '#8b949e',
    border: '1px solid transparent',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s',
  },
  navActive: {
    background: '#58a6ff15',
    color: '#58a6ff',
    borderColor: '#58a6ff44',
  },
  navIcon: {
    fontSize: 14,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#3fb950',
    animation: 'pulse 2s ease-in-out infinite',
  },
  liveText: {
    fontSize: 12,
    color: '#3fb950',
    fontWeight: 600,
  },
  main: {
    flex: 1,
    padding: 24,
    maxWidth: 1400,
    margin: '0 auto',
    width: '100%',
  },
  overviewGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
  },
  fullWidth: {
    gridColumn: '1 / -1',
  },
  halfWidth: {
    gridColumn: 'span 1',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 24px',
    borderTop: '1px solid #30363d',
    fontSize: 11,
    color: '#8b949e',
    flexWrap: 'wrap',
    gap: 8,
  },
};
