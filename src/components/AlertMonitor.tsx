import { useState, useEffect, useRef, useCallback } from 'react';
import {
  fetchLargeTransactions,
  fetchCurrentPrice,
  fetchMempoolInfo,
  fetchTopHolders,
  fetchExchangeFlows,
  checkAddressDormancy,
} from '../api';
import type { Alert, AlertSeverity, AlertCategory, WhaleTransaction, TopHolder } from '../types';

interface AlertMonitorProps {
  addAlert: (
    severity: AlertSeverity,
    category: AlertCategory,
    title: string,
    message: string,
    data?: Record<string, any>,
  ) => Alert;
  alerts: Alert[];
}

interface RuleStatus {
  name: string;
  category: AlertCategory;
  enabled: boolean;
  lastCheck: number;
  triggerCount: number;
  status: 'idle' | 'checking' | 'triggered' | 'normal';
}

export default function AlertMonitor({ addAlert, alerts }: AlertMonitorProps) {
  const [rules, setRules] = useState<RuleStatus[]>([
    { name: '休眠地址激活', category: 'dormant_activation', enabled: true, lastCheck: 0, triggerCount: 0, status: 'idle' },
    { name: '异常诱多信号', category: 'long_trap_signal', enabled: true, lastCheck: 0, triggerCount: 0, status: 'idle' },
    { name: '衍生品对冲提醒', category: 'derivatives_hedging', enabled: true, lastCheck: 0, triggerCount: 0, status: 'idle' },
    { name: '新巨鲸进入Top100', category: 'new_whale_top100', enabled: true, lastCheck: 0, triggerCount: 0, status: 'idle' },
  ]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<Date | null>(null);
  const [scanLog, setScanLog] = useState<string[]>([]);
  const prevHoldersRef = useRef<TopHolder[]>([]);
  const feeHistoryRef = useRef<number[]>([]);
  const checkedAddrsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback((msg: string) => {
    setScanLog((prev) => [`[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  const updateRule = useCallback((category: AlertCategory, update: Partial<RuleStatus>) => {
    setRules((prev) => prev.map((r) => r.category === category ? { ...r, ...update } : r));
  }, []);

  const runScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    addLog('开始扫描...');

    try {
      const [txs, priceData, mempoolInfo, holders, flows] = await Promise.all([
        fetchLargeTransactions(10, 2).catch(() => [] as WhaleTransaction[]),
        fetchCurrentPrice().catch(() => ({ price: 0, changePercent24h: 0 })),
        fetchMempoolInfo().catch(() => ({ count: 0, vsize: 0, totalFee: 0, feeRates: { fastest: 0, halfHour: 0, hour: 0, economy: 0 } })),
        fetchTopHolders().catch(() => [] as TopHolder[]),
        fetchExchangeFlows(1).catch(() => []),
      ]);

      const now = Math.floor(Date.now() / 1000);

      // ── 规则1: 休眠地址激活 ──
      const rule1 = rules.find((r) => r.category === 'dormant_activation');
      if (rule1?.enabled && txs.length > 0) {
        updateRule('dormant_activation', { status: 'checking', lastCheck: now });
        addLog('检查休眠地址...');
        let dormantCount = 0;
        // 只检查前 10 笔大额交易的发送地址（避免过多 API 调用）
        const toCheck = txs
          .filter((tx) => tx.from !== 'coinbase' && tx.from !== 'unknown' && !checkedAddrsRef.current.has(tx.from))
          .slice(0, 10);

        for (const tx of toCheck) {
          checkedAddrsRef.current.add(tx.from);
          try {
            const { dormantDays } = await checkAddressDormancy(tx.from);
            if (dormantDays > 365 && tx.amount >= 50) {
              dormantCount++;
              addAlert('critical', 'dormant_activation',
                '休眠地址激活 (>1年)',
                `地址 ${tx.from.slice(0, 12)}... 休眠 ${dormantDays} 天后转出 ${tx.amount.toFixed(2)} BTC`,
                { address: tx.from, dormantDays, amount: tx.amount },
              );
              addLog(`⚠️ 发现休眠地址: ${tx.from.slice(0, 12)}... (${dormantDays}天)`);
            } else if (dormantDays > 180 && tx.amount >= 10) {
              dormantCount++;
              addAlert('warning', 'dormant_activation',
                '休眠地址激活 (>180天)',
                `地址 ${tx.from.slice(0, 12)}... 休眠 ${dormantDays} 天后转出 ${tx.amount.toFixed(2)} BTC`,
                { address: tx.from, dormantDays, amount: tx.amount },
              );
              addLog(`⚡ 半休眠地址: ${tx.from.slice(0, 12)}... (${dormantDays}天)`);
            }
          } catch { /* skip */ }
        }
        updateRule('dormant_activation', {
          status: dormantCount > 0 ? 'triggered' : 'normal',
          triggerCount: (rule1.triggerCount || 0) + dormantCount,
        });
        addLog(`休眠检查完成: ${dormantCount} 个激活`);
      }

      // ── 规则2: 异常诱多信号 ──
      const rule2 = rules.find((r) => r.category === 'long_trap_signal');
      if (rule2?.enabled) {
        updateRule('long_trap_signal', { status: 'checking', lastCheck: now });
        addLog('检查诱多信号...');
        const deposits = txs.filter((t) => t.type === 'exchange_deposit');
        const withdrawals = txs.filter((t) => t.type === 'exchange_withdrawal');
        const depositBTC = deposits.reduce((s, t) => s + t.amount, 0);
        const withdrawalBTC = withdrawals.reduce((s, t) => s + t.amount, 0);
        const ratio = withdrawalBTC > 0 ? depositBTC / withdrawalBTC : depositBTC > 0 ? 10 : 1;

        const priceUp = (priceData as any).changePercent24h > 2;
        let triggered = false;

        if (ratio > 2.0 && priceUp) {
          addAlert('warning', 'long_trap_signal',
            '异常诱多信号',
            `交易所充值/提现比 ${ratio.toFixed(1)}:1，24h价格上涨 ${((priceData as any).changePercent24h || 0).toFixed(1)}%，大量BTC流入交易所可能是出货信号`,
            { ratio, depositBTC, withdrawalBTC, priceChange: (priceData as any).changePercent24h },
          );
          triggered = true;
          addLog(`⚠️ 诱多信号: 充提比 ${ratio.toFixed(1)}:1`);
        } else if (ratio > 3.0) {
          addAlert('info', 'long_trap_signal',
            '交易所充值偏高',
            `交易所充值/提现比 ${ratio.toFixed(1)}:1，大量BTC流入交易所，关注后续价格走势`,
            { ratio, depositBTC, withdrawalBTC },
          );
          triggered = true;
          addLog(`📊 充值偏高: 充提比 ${ratio.toFixed(1)}:1`);
        }
        updateRule('long_trap_signal', {
          status: triggered ? 'triggered' : 'normal',
          triggerCount: triggered ? (rule2.triggerCount || 0) + 1 : rule2.triggerCount,
        });
        addLog(`诱多检查完成: ${triggered ? '已触发' : '正常'}`);
      }

      // ── 规则3: 衍生品对冲提醒 ──
      const rule3 = rules.find((r) => r.category === 'derivatives_hedging');
      if (rule3?.enabled) {
        updateRule('derivatives_hedging', { status: 'checking', lastCheck: now });
        addLog('检查对冲信号...');
        const currentFee = mempoolInfo.feeRates.fastest;
        feeHistoryRef.current.push(currentFee);
        if (feeHistoryRef.current.length > 12) feeHistoryRef.current.shift();

        let triggered = false;
        if (feeHistoryRef.current.length >= 3) {
          const avgFee = feeHistoryRef.current.slice(0, -1).reduce((a, b) => a + b, 0) / (feeHistoryRef.current.length - 1);
          const feeSpike = currentFee > avgFee * 2;
          const hasLargeDeposits = txs.filter((t) => t.type === 'exchange_deposit' && t.amount > 50).length > 0;

          if (feeSpike && hasLargeDeposits) {
            addAlert('warning', 'derivatives_hedging',
              '衍生品对冲提醒',
              `手续费飙升至 ${currentFee} sat/vB (均值 ${avgFee.toFixed(0)})，同时检测到大额交易所充值，可能是紧急对冲操作`,
              { currentFee, avgFee, spike: currentFee / avgFee },
            );
            triggered = true;
            addLog(`⚠️ 对冲信号: 手续费 ${currentFee} (均值 ${avgFee.toFixed(0)})`);
          }
        }
        updateRule('derivatives_hedging', {
          status: triggered ? 'triggered' : 'normal',
          triggerCount: triggered ? (rule3.triggerCount || 0) + 1 : rule3.triggerCount,
        });
        addLog(`对冲检查完成: ${triggered ? '已触发' : '正常'}`);
      }

      // ── 规则4: 新巨鲸进入 Top100 ──
      const rule4 = rules.find((r) => r.category === 'new_whale_top100');
      if (rule4?.enabled && holders.length > 0) {
        updateRule('new_whale_top100', { status: 'checking', lastCheck: now });
        addLog('检查Top100变化...');
        let triggered = false;

        if (prevHoldersRef.current.length > 0) {
          const prevAddrs = new Set(prevHoldersRef.current.map((h) => h.address));
          const newWhales = holders.filter((h) => !prevAddrs.has(h.address));
          for (const whale of newWhales) {
            addAlert('critical', 'new_whale_top100',
              '新巨鲸进入Top100',
              `地址 ${whale.address.slice(0, 12)}... 进入Top100，持有 ${whale.balance.toLocaleString()} BTC (${whale.percentOfTotal.toFixed(3)}%)`,
              { address: whale.address, balance: whale.balance, rank: whale.rank },
            );
            triggered = true;
            addLog(`🐋 新巨鲸: ${whale.address.slice(0, 12)}... (#${whale.rank})`);
          }
        }
        prevHoldersRef.current = holders;
        updateRule('new_whale_top100', {
          status: triggered ? 'triggered' : 'normal',
          triggerCount: triggered ? (rule4.triggerCount || 0) + 1 : rule4.triggerCount,
        });
        addLog(`Top100检查完成: ${triggered ? '发现新巨鲸' : '无变化'}`);
      }

      setLastScan(new Date());
      addLog('扫描完成 ✓');
    } catch (err) {
      addLog(`扫描出错: ${err}`);
    }
    setScanning(false);
  }, [scanning, rules, addAlert, addLog, updateRule]);

  // 自动扫描：每 3 分钟
  useEffect(() => {
    runScan();
    timerRef.current = setInterval(runScan, 180000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRule = (category: AlertCategory) => {
    setRules((prev) => prev.map((r) => r.category === category ? { ...r, enabled: !r.enabled } : r));
  };

  const recentAlerts = alerts.filter((a) =>
    ['dormant_activation', 'long_trap_signal', 'derivatives_hedging', 'new_whale_top100', 'large_inflow', 'large_outflow'].includes(a.category)
  ).slice(0, 20);

  const stats = {
    total: recentAlerts.length,
    critical: recentAlerts.filter((a) => a.severity === 'critical').length,
    warning: recentAlerts.filter((a) => a.severity === 'warning').length,
    info: recentAlerts.filter((a) => a.severity === 'info').length,
  };

  return (
    <div style={styles.container}>
      {/* 头部 */}
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <h2 style={styles.title}>实时预警监控</h2>
          <div style={styles.headerRight}>
            {lastScan && (
              <span style={styles.lastScan}>
                上次扫描: {lastScan.toLocaleTimeString('zh-CN')}
              </span>
            )}
            <button
              onClick={runScan}
              disabled={scanning}
              style={{ ...styles.scanBtn, opacity: scanning ? 0.5 : 1 }}
            >
              {scanning ? '扫描中...' : '立即扫描'}
            </button>
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      <div style={styles.statsRow}>
        <div style={{ ...styles.statCard, borderLeft: '3px solid #f0f6fc' }}>
          <div style={styles.statNum}>{stats.total}</div>
          <div style={styles.statLabel}>总预警</div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: '3px solid #f85149' }}>
          <div style={{ ...styles.statNum, color: '#f85149' }}>{stats.critical}</div>
          <div style={styles.statLabel}>严重</div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: '3px solid #d29922' }}>
          <div style={{ ...styles.statNum, color: '#d29922' }}>{stats.warning}</div>
          <div style={styles.statLabel}>警告</div>
        </div>
        <div style={{ ...styles.statCard, borderLeft: '3px solid #58a6ff' }}>
          <div style={{ ...styles.statNum, color: '#58a6ff' }}>{stats.info}</div>
          <div style={styles.statLabel}>信息</div>
        </div>
      </div>

      {/* 预警规则 */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>预警规则</h3>
        <div style={styles.rulesGrid}>
          {rules.map((rule) => (
            <div key={rule.category} style={{
              ...styles.ruleCard,
              borderColor: rule.status === 'triggered' ? '#f85149'
                : rule.status === 'checking' ? '#d29922'
                : rule.status === 'normal' ? '#3fb950' : '#30363d',
            }}>
              <div style={styles.ruleTop}>
                <span style={styles.ruleName}>{rule.name}</span>
                <label style={styles.switchLabel}>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() => toggleRule(rule.category)}
                    style={styles.checkbox}
                  />
                </label>
              </div>
              <div style={styles.ruleStatus}>
                <span style={{
                  ...styles.statusDot,
                  background: rule.status === 'triggered' ? '#f85149'
                    : rule.status === 'checking' ? '#d29922'
                    : rule.status === 'normal' ? '#3fb950' : '#484f58',
                }} />
                <span style={styles.statusText}>
                  {rule.status === 'idle' ? '等待扫描'
                    : rule.status === 'checking' ? '检查中...'
                    : rule.status === 'triggered' ? '已触发'
                    : '正常'}
                </span>
              </div>
              <div style={styles.ruleMeta}>
                触发次数: {rule.triggerCount}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 两列布局：预警列表 + 扫描日志 */}
      <div style={styles.twoCol}>
        {/* 预警列表 */}
        <div style={styles.colLeft}>
          <h3 style={styles.sectionTitle}>最近预警</h3>
          <div style={styles.alertList}>
            {recentAlerts.length === 0 ? (
              <div style={styles.emptyText}>暂无预警，系统正在监控中...</div>
            ) : (
              recentAlerts.map((alert) => (
                <div key={alert.id} style={{
                  ...styles.alertItem,
                  borderLeftColor: alert.severity === 'critical' ? '#f85149'
                    : alert.severity === 'warning' ? '#d29922' : '#58a6ff',
                }}>
                  <div style={styles.alertHeader}>
                    <span style={styles.alertTitle}>{alert.title}</span>
                    <span style={{
                      ...styles.severityBadge,
                      background: (alert.severity === 'critical' ? '#f85149'
                        : alert.severity === 'warning' ? '#d29922' : '#58a6ff') + '22',
                      color: alert.severity === 'critical' ? '#f85149'
                        : alert.severity === 'warning' ? '#d29922' : '#58a6ff',
                    }}>
                      {alert.severity}
                    </span>
                  </div>
                  <div style={styles.alertMsg}>{alert.message}</div>
                  <div style={styles.alertTime}>
                    {new Date(alert.timestamp * 1000).toLocaleString('zh-CN')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 扫描日志 */}
        <div style={styles.colRight}>
          <h3 style={styles.sectionTitle}>扫描日志</h3>
          <div style={styles.logBox}>
            {scanLog.length === 0 ? (
              <div style={styles.emptyText}>等待首次扫描...</div>
            ) : (
              scanLog.map((log, i) => (
                <div key={i} style={styles.logLine}>{log}</div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 说明 */}
      <div style={styles.footer}>
        <span>预警规则每 3 分钟自动扫描一次 | 休眠检测基于 Blockstream 地址历史 | 诱多信号基于交易所充提比 + 价格趋势</span>
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
  titleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
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
  lastScan: {
    fontSize: 12,
    color: '#8b949e',
  },
  scanBtn: {
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
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: 10,
    padding: '12px 24px',
  },
  statCard: {
    background: '#0d1117',
    borderRadius: 8,
    padding: '10px 14px',
  },
  statNum: {
    fontSize: 20,
    fontWeight: 700,
    fontFamily: 'JetBrains Mono, monospace',
    color: '#f0f6fc',
  },
  statLabel: {
    fontSize: 11,
    color: '#8b949e',
    marginTop: 2,
  },
  section: {
    padding: '0 24px 12px',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#f0f6fc',
    margin: '12px 0 8px',
  },
  rulesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 10,
  },
  ruleCard: {
    background: '#0d1117',
    borderRadius: 8,
    border: '1px solid #30363d',
    padding: '12px 14px',
  },
  ruleTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  ruleName: {
    fontSize: 13,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  switchLabel: {
    cursor: 'pointer',
  },
  checkbox: {
    accentColor: '#58a6ff',
  },
  ruleStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  statusText: {
    fontSize: 12,
    color: '#8b949e',
  },
  ruleMeta: {
    fontSize: 11,
    color: '#484f58',
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    padding: '0 24px 16px',
  },
  colLeft: {},
  colRight: {},
  alertList: {
    maxHeight: 400,
    overflowY: 'auto',
  },
  alertItem: {
    padding: '10px 12px',
    background: '#0d1117',
    borderRadius: 8,
    borderLeft: '3px solid #58a6ff',
    marginBottom: 6,
  },
  alertHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  severityBadge: {
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 4,
    textTransform: 'uppercase' as const,
  },
  alertMsg: {
    fontSize: 11,
    color: '#8b949e',
    lineHeight: 1.4,
    marginBottom: 4,
  },
  alertTime: {
    fontSize: 10,
    color: '#484f58',
    fontFamily: 'JetBrains Mono, monospace',
  },
  logBox: {
    maxHeight: 400,
    overflowY: 'auto',
    background: '#0d1117',
    borderRadius: 8,
    padding: 12,
  },
  logLine: {
    fontSize: 11,
    color: '#8b949e',
    fontFamily: 'JetBrains Mono, monospace',
    lineHeight: 1.6,
    borderBottom: '1px solid #21262d',
    padding: '2px 0',
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
