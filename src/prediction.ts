/*
 * 预测引擎 - 基于技术指标的统计估算
 * 注意：这是客户端启发式方法，非机器学习模型，预测仅供参考
 */

import type { PredictionSignal, PredictionDirection } from './types';

/* ── 技术指标计算 ── */

export function calcSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

export function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export function calcRSI(data: number[], period: number = 14): number[] {
  const result: number[] = new Array(data.length).fill(NaN);
  if (data.length < period + 1) return result;

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function calcMACD(data: number[]): {
  macd: number[]; signal: number[]; histogram: number[];
} {
  const ema12 = calcEMA(data, 12);
  const ema26 = calcEMA(data, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine, 9);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macd: macdLine, signal: signalLine, histogram };
}

export function calcBollingerBands(data: number[], period: number = 20): {
  upper: number[]; middle: number[]; lower: number[];
} {
  const sma = calcSMA(data, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue; }
    const slice = data.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    upper.push(mean + 2 * std);
    lower.push(mean - 2 * std);
  }
  return { upper, middle: sma, lower };
}

function calcMomentum(data: number[], period: number = 10): number[] {
  return data.map((v, i) => i < period ? NaN : ((v - data[i - period]) / data[i - period]) * 100);
}

/* ── 价格预测 ── */

export function predictPrice(
  prices: number[],
  exchangeNetflow: number,
): { direction: PredictionDirection; change: number; confidence: number; signals: PredictionSignal[] } {
  if (prices.length < 30) {
    return { direction: 'neutral', change: 0, confidence: 15, signals: [] };
  }

  const signals: PredictionSignal[] = [];
  const last = prices[prices.length - 1];

  // 1. SMA 趋势
  const sma5 = calcSMA(prices, 5);
  const sma20 = calcSMA(prices, 20);
  const sma5Last = sma5[sma5.length - 1];
  const sma20Last = sma20[sma20.length - 1];
  if (!isNaN(sma5Last) && !isNaN(sma20Last)) {
    const smaDir: PredictionDirection = sma5Last > sma20Last ? 'up' : sma5Last < sma20Last ? 'down' : 'neutral';
    signals.push({ name: 'SMA交叉', direction: smaDir, weight: 0.2, value: sma5Last - sma20Last });
  }

  // 2. RSI
  const rsi = calcRSI(prices);
  const rsiLast = rsi[rsi.length - 1];
  if (!isNaN(rsiLast)) {
    const rsiDir: PredictionDirection = rsiLast < 30 ? 'up' : rsiLast > 70 ? 'down' : 'neutral';
    signals.push({ name: 'RSI', direction: rsiDir, weight: 0.2, value: rsiLast });
  }

  // 3. MACD
  const { histogram } = calcMACD(prices);
  const macdLast = histogram[histogram.length - 1];
  const macdPrev = histogram[histogram.length - 2];
  if (!isNaN(macdLast) && !isNaN(macdPrev)) {
    const macdDir: PredictionDirection = macdLast > macdPrev ? 'up' : macdLast < macdPrev ? 'down' : 'neutral';
    signals.push({ name: 'MACD', direction: macdDir, weight: 0.2, value: macdLast });
  }

  // 4. 动量
  const momentum = calcMomentum(prices);
  const momLast = momentum[momentum.length - 1];
  if (!isNaN(momLast)) {
    const momDir: PredictionDirection = momLast > 0.1 ? 'up' : momLast < -0.1 ? 'down' : 'neutral';
    signals.push({ name: '动量', direction: momDir, weight: 0.15, value: momLast });
  }

  // 5. 布林带位置
  const bb = calcBollingerBands(prices);
  const bbUpper = bb.upper[bb.upper.length - 1];
  const bbLower = bb.lower[bb.lower.length - 1];
  if (!isNaN(bbUpper) && !isNaN(bbLower)) {
    const bbRange = bbUpper - bbLower;
    const bbPos = bbRange > 0 ? (last - bbLower) / bbRange : 0.5;
    const bbDir: PredictionDirection = bbPos < 0.2 ? 'up' : bbPos > 0.8 ? 'down' : 'neutral';
    signals.push({ name: '布林带', direction: bbDir, weight: 0.15, value: bbPos });
  }

  // 6. 交易所净流入
  if (exchangeNetflow !== 0) {
    const flowDir: PredictionDirection = exchangeNetflow > 0 ? 'down' : 'up'; // 净流入交易所 = 卖压
    signals.push({ name: '交易所净流入', direction: flowDir, weight: 0.1, value: exchangeNetflow });
  }

  return aggregateSignals(signals, last);
}

/* ── 交易量预测 ── */

export function predictTxVolume(
  mempoolSizes: number[],
  feeTrend: number[],
  recentBlockTxCounts: number[],
): { direction: PredictionDirection; change: number; confidence: number; signals: PredictionSignal[] } {
  const signals: PredictionSignal[] = [];

  // 1. Mempool 大小趋势
  if (mempoolSizes.length >= 3) {
    const recent = mempoolSizes.slice(-3);
    const trend = recent[2] - recent[0];
    const dir: PredictionDirection = trend > 100 ? 'up' : trend < -100 ? 'down' : 'neutral';
    signals.push({ name: 'Mempool趋势', direction: dir, weight: 0.4, value: trend });
  }

  // 2. 手续费趋势
  if (feeTrend.length >= 3) {
    const recent = feeTrend.slice(-3);
    const trend = recent[2] - recent[0];
    const dir: PredictionDirection = trend > 2 ? 'up' : trend < -2 ? 'down' : 'neutral';
    signals.push({ name: '手续费趋势', direction: dir, weight: 0.3, value: trend });
  }

  // 3. 区块交易数
  if (recentBlockTxCounts.length >= 2) {
    const avg = recentBlockTxCounts.reduce((a, b) => a + b, 0) / recentBlockTxCounts.length;
    const last = recentBlockTxCounts[recentBlockTxCounts.length - 1];
    const dir: PredictionDirection = last > avg * 1.1 ? 'up' : last < avg * 0.9 ? 'down' : 'neutral';
    signals.push({ name: '区块交易数', direction: dir, weight: 0.3, value: last - avg });
  }

  const currentValue = mempoolSizes.length > 0 ? mempoolSizes[mempoolSizes.length - 1] : 0;
  return aggregateSignals(signals, currentValue);
}

/* ── 巨鲸动向预测 ── */

export function predictWhaleMovement(
  recentWhaleTxCount: number,
  avgWhaleTxCount: number,
  exchangeDepositRatio: number,
  dormantActivations: number,
): { direction: PredictionDirection; change: number; confidence: number; signals: PredictionSignal[] } {
  const signals: PredictionSignal[] = [];

  // 1. 大额交易频率
  const freqRatio = avgWhaleTxCount > 0 ? recentWhaleTxCount / avgWhaleTxCount : 1;
  const freqDir: PredictionDirection = freqRatio > 1.3 ? 'up' : freqRatio < 0.7 ? 'down' : 'neutral';
  signals.push({ name: '交易频率', direction: freqDir, weight: 0.35, value: freqRatio });

  // 2. 交易所充提比
  const depDir: PredictionDirection = exchangeDepositRatio > 0.6 ? 'up' : exchangeDepositRatio < 0.4 ? 'down' : 'neutral';
  signals.push({ name: '充提比', direction: depDir, weight: 0.35, value: exchangeDepositRatio });

  // 3. 休眠地址激活
  const dormDir: PredictionDirection = dormantActivations > 0 ? 'up' : 'neutral';
  signals.push({ name: '休眠激活', direction: dormDir, weight: 0.3, value: dormantActivations });

  return aggregateSignals(signals, recentWhaleTxCount);
}

/* ── 大额交易预测 ── */

export function predictLargeTx(
  mempoolSize: number,
  avgMempoolSize: number,
  recentLargeTxRate: number,
  avgLargeTxRate: number,
): { direction: PredictionDirection; change: number; confidence: number; signals: PredictionSignal[] } {
  const signals: PredictionSignal[] = [];

  // 1. Mempool 大小
  const mpRatio = avgMempoolSize > 0 ? mempoolSize / avgMempoolSize : 1;
  const mpDir: PredictionDirection = mpRatio > 1.2 ? 'up' : mpRatio < 0.8 ? 'down' : 'neutral';
  signals.push({ name: 'Mempool规模', direction: mpDir, weight: 0.4, value: mpRatio });

  // 2. 近期大额交易频率
  const txRatio = avgLargeTxRate > 0 ? recentLargeTxRate / avgLargeTxRate : 1;
  const txDir: PredictionDirection = txRatio > 1.2 ? 'up' : txRatio < 0.8 ? 'down' : 'neutral';
  signals.push({ name: '大额频率', direction: txDir, weight: 0.35, value: txRatio });

  // 3. Mempool 趋势（大 mempool 通常意味着更多大额交易）
  const trendDir: PredictionDirection = mempoolSize > 50000 ? 'up' : mempoolSize < 10000 ? 'down' : 'neutral';
  signals.push({ name: 'Mempool拥堵', direction: trendDir, weight: 0.25, value: mempoolSize });

  return aggregateSignals(signals, recentLargeTxRate);
}

/* ── 信号聚合 ── */

function aggregateSignals(
  signals: PredictionSignal[],
  currentValue: number,
): { direction: PredictionDirection; change: number; confidence: number; signals: PredictionSignal[] } {
  if (signals.length === 0) {
    return { direction: 'neutral', change: 0, confidence: 15, signals };
  }

  let upWeight = 0, downWeight = 0, totalWeight = 0;
  for (const s of signals) {
    totalWeight += s.weight;
    if (s.direction === 'up') upWeight += s.weight;
    else if (s.direction === 'down') downWeight += s.weight;
  }

  const direction: PredictionDirection =
    upWeight > downWeight * 1.2 ? 'up' :
    downWeight > upWeight * 1.2 ? 'down' : 'neutral';

  // 信号一致性
  const dominantWeight = Math.max(upWeight, downWeight);
  const agreement = totalWeight > 0 ? dominantWeight / totalWeight : 0;

  // 置信度：基于信号一致性，上限 85%
  const confidence = Math.min(85, Math.max(15, Math.round(agreement * 70 + 15)));

  // 预测变化幅度（保守估计）
  const changeBase = direction === 'neutral' ? 0 : (agreement - 0.5) * 2;
  const change = direction === 'up' ? changeBase * 0.5 : direction === 'down' ? -changeBase * 0.5 : 0;

  return { direction, change, confidence, signals };
}

/* ── 置信度调整（基于历史准确率） ── */

export function adjustConfidence(baseConfidence: number, historicalAccuracy: number): number {
  const adjusted = baseConfidence * (0.5 + 0.5 * (historicalAccuracy / 100));
  return Math.min(85, Math.max(15, Math.round(adjusted)));
}
