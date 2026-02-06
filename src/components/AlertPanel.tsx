import type { Alert } from '../types';

const SEVERITY_COLORS: Record<string, string> = {
  info: '#58a6ff',
  warning: '#d29922',
  critical: '#f85149',
};

const CATEGORY_ICONS: Record<string, string> = {
  dormant_activation: '💤',
  long_trap_signal: '⚠️',
  derivatives_hedging: '🛡️',
  new_whale_top100: '🐋',
  large_inflow: '📥',
  large_outflow: '📤',
};

interface AlertPanelProps {
  alerts: Alert[];
  toasts: Alert[];
  unreadCount: number;
  isOpen: boolean;
  onToggle: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onDismissToast: (id: string) => void;
}

export default function AlertPanel({
  alerts,
  toasts,
  unreadCount,
  isOpen,
  onToggle,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
  onDismissToast,
}: AlertPanelProps) {
  return (
    <>
      {/* 铃铛按钮 */}
      <button onClick={onToggle} style={styles.bellBtn}>
        🔔
        {unreadCount > 0 && (
          <span style={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {/* Toast 通知 */}
      <div style={styles.toastContainer}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="toast-slide-in"
            style={{
              ...styles.toast,
              borderLeftColor: SEVERITY_COLORS[toast.severity],
            }}
            onClick={() => onDismissToast(toast.id)}
          >
            <div style={styles.toastHeader}>
              <span>{CATEGORY_ICONS[toast.category] || '🔔'} {toast.title}</span>
              <span style={{ ...styles.toastSeverity, color: SEVERITY_COLORS[toast.severity] }}>
                {toast.severity.toUpperCase()}
              </span>
            </div>
            <div style={styles.toastMsg}>{toast.message}</div>
          </div>
        ))}
      </div>

      {/* 抽屉面板 */}
      {isOpen && (
        <>
          <div style={styles.overlay} onClick={onToggle} />
          <div className="drawer-slide-in" style={styles.drawer}>
            <div style={styles.drawerHeader}>
              <h3 style={styles.drawerTitle}>预警通知</h3>
              <div style={styles.drawerActions}>
                <button onClick={onMarkAllRead} style={styles.actionBtn}>全部已读</button>
                <button onClick={onClearAll} style={styles.actionBtn}>清空</button>
                <button onClick={onToggle} style={styles.closeBtn}>✕</button>
              </div>
            </div>
            <div style={styles.drawerBody}>
              {alerts.length === 0 ? (
                <div style={styles.emptyText}>暂无预警通知</div>
              ) : (
                alerts.map((alert) => (
                  <div
                    key={alert.id}
                    style={{
                      ...styles.alertItem,
                      borderLeftColor: SEVERITY_COLORS[alert.severity],
                      opacity: alert.read ? 0.6 : 1,
                    }}
                    onClick={() => onMarkRead(alert.id)}
                  >
                    <div style={styles.alertTop}>
                      <span style={styles.alertIcon}>
                        {CATEGORY_ICONS[alert.category] || '🔔'}
                      </span>
                      <span style={styles.alertTitle}>{alert.title}</span>
                      <span style={{
                        ...styles.severityTag,
                        background: SEVERITY_COLORS[alert.severity] + '22',
                        color: SEVERITY_COLORS[alert.severity],
                      }}>
                        {alert.severity}
                      </span>
                      {!alert.read && <span style={styles.unreadDot} />}
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
        </>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bellBtn: {
    position: 'relative',
    background: 'transparent',
    border: 'none',
    fontSize: 20,
    cursor: 'pointer',
    padding: '4px 8px',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    background: '#f85149',
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    borderRadius: 10,
    padding: '1px 5px',
    minWidth: 16,
    textAlign: 'center',
  },
  toastContainer: {
    position: 'fixed',
    top: 16,
    right: 16,
    zIndex: 10000,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    maxWidth: 380,
  },
  toast: {
    background: '#1c2128',
    border: '1px solid #30363d',
    borderLeft: '4px solid #58a6ff',
    borderRadius: 8,
    padding: '10px 14px',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  },
  toastHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 13,
    fontWeight: 600,
    color: '#f0f6fc',
    marginBottom: 4,
  },
  toastSeverity: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1,
  },
  toastMsg: {
    fontSize: 12,
    color: '#8b949e',
    lineHeight: 1.4,
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 9998,
  },
  drawer: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 400,
    maxWidth: '90vw',
    background: '#0d1117',
    borderLeft: '1px solid #30363d',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
  },
  drawerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #30363d',
  },
  drawerTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#f0f6fc',
    margin: 0,
  },
  drawerActions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  actionBtn: {
    padding: '4px 10px',
    fontSize: 11,
    background: 'transparent',
    color: '#58a6ff',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#8b949e',
    fontSize: 16,
    cursor: 'pointer',
    padding: '4px 8px',
  },
  drawerBody: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 16px',
  },
  emptyText: {
    textAlign: 'center',
    color: '#8b949e',
    padding: 40,
    fontSize: 14,
  },
  alertItem: {
    padding: '10px 14px',
    background: '#1c2128',
    borderRadius: 8,
    borderLeft: '3px solid #58a6ff',
    marginBottom: 8,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  alertTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  alertIcon: {
    fontSize: 14,
  },
  alertTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#f0f6fc',
    flex: 1,
  },
  severityTag: {
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#58a6ff',
    flexShrink: 0,
  },
  alertMsg: {
    fontSize: 12,
    color: '#8b949e',
    lineHeight: 1.4,
    marginBottom: 4,
  },
  alertTime: {
    fontSize: 10,
    color: '#484f58',
    fontFamily: 'JetBrains Mono, monospace',
  },
};
