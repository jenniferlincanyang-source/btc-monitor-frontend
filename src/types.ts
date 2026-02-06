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
