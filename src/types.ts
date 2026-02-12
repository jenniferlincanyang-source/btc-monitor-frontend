/* ── 类型定义 ── */

export interface PriceData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WhaleTransaction {
  id: string;
  hash: string;
  timestamp: number;
  amount: number;          // BTC 数量
  amountUsd: number;       // USD 价值
  from: string;
  to: string;
  fromOwner: string;       // 来源标签 (交易所名 / unknown)
  toOwner: string;         // 目标标签
  type: 'exchange_deposit' | 'exchange_withdrawal' | 'whale_transfer' | 'unknown';
}

export interface ExchangeFlowData {
  timestamp: number;
  inflow: number;          // 流入交易所 BTC
  outflow: number;         // 流出交易所 BTC
  netflow: number;         // 净流入
}

export interface TopHolder {
  rank: number;
  address: string;
  balance: number;         // BTC
  percentOfTotal: number;
  label: string;           // 标签 (交易所 / 基金 / unknown)
  lastActive: number;      // 最后活跃时间戳
}

export interface OnChainMetrics {
  activeAddresses: number;
  transactionCount: number;
  hashRate: number;
  difficulty: number;
  mempoolSize: number;
  avgFee: number;
  blockHeight: number;
}

export interface CorrelationPoint {
  time: number;
  price: number;
  metric: number;
  metricName: string;
}

/* ── 预警系统 ── */

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertCategory =
  | 'dormant_activation'
  | 'long_trap_signal'
  | 'derivatives_hedging'
  | 'new_whale_top100'
  | 'large_inflow'
  | 'large_outflow';

export interface Alert {
  id: string;
  timestamp: number;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
}

/* ── 预测系统 ── */

export type PredictionTarget = 'price' | 'tx_volume' | 'whale_movement' | 'large_tx';

export type PredictionDirection = 'up' | 'down' | 'neutral';

export type PredictionTimeframe = '5m' | '20m' | '1h' | '6h' | '12h' | '1d' | '1w';

export interface TimeframeConfig {
  key: PredictionTimeframe;
  label: string;
  seconds: number;       // 周期秒数
  priceDays: number;     // CoinGecko market_chart days 参数
}

export interface PredictionSignal {
  name: string;
  direction: PredictionDirection;
  weight: number;
  value: number;
}

export interface Prediction {
  id: string;
  createdAt: number;
  targetTime: number;           // createdAt + timeframe seconds
  target: PredictionTarget;
  direction: PredictionDirection;
  timeframe: PredictionTimeframe;
  currentValue: number;
  predictedValue: number;
  predictedChange: number;      // 百分比
  confidence: number;           // 0-100
  signals: PredictionSignal[];
  resolved: boolean;
  actualValue?: number;
  actualChange?: number;
  accurate?: boolean;           // 方向是否正确
  error?: number;               // 预测误差百分比
}

export interface PredictionAccuracy {
  target: PredictionTarget;
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  avgError: number;
  last24hAccuracy: number;
}
