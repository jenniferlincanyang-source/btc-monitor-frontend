import { useState, useCallback, useRef, useEffect } from 'react';
import type { Alert, AlertSeverity, AlertCategory } from '../types';

const STORAGE_KEY = 'btc_monitor_alerts';
const MAX_ALERTS = 200;

function loadAlerts(): Alert[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAlerts(alerts: Alert[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts.slice(0, MAX_ALERTS)));
  } catch { /* quota exceeded */ }
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>(loadAlerts);
  const [toasts, setToasts] = useState<Alert[]>([]);
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const unreadCount = alerts.filter((a) => !a.read).length;

  const addAlert = useCallback((
    severity: AlertSeverity,
    category: AlertCategory,
    title: string,
    message: string,
    data?: Record<string, any>,
  ) => {
    const alert: Alert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Math.floor(Date.now() / 1000),
      severity,
      category,
      title,
      message,
      data,
      read: false,
    };

    setAlerts((prev) => {
      const next = [alert, ...prev].slice(0, MAX_ALERTS);
      saveAlerts(next);
      return next;
    });

    // Toast 通知
    setToasts((prev) => [alert, ...prev].slice(0, 5));
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== alert.id));
      toastTimers.current.delete(alert.id);
    }, 5000);
    toastTimers.current.set(alert.id, timer);

    return alert;
  }, []);

  const markRead = useCallback((id: string) => {
    setAlerts((prev) => {
      const next = prev.map((a) => a.id === id ? { ...a, read: true } : a);
      saveAlerts(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setAlerts((prev) => {
      const next = prev.map((a) => ({ ...a, read: true }));
      saveAlerts(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setAlerts([]);
    saveAlerts([]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimers.current.get(id);
    if (timer) { clearTimeout(timer); toastTimers.current.delete(id); }
  }, []);

  useEffect(() => {
    return () => {
      toastTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  return {
    alerts,
    toasts,
    unreadCount,
    addAlert,
    markRead,
    markAllRead,
    clearAll,
    dismissToast,
  };
}
