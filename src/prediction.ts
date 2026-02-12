/*
 * 预测引擎 - 基于技术指标的统计估算
 * 注意：这是客户端启发式方法，非机器学习模型，预测仅供参考
 */

import type { PredictionSignal, PredictionDirection, PredictionReason, ResolutionExplanation, Prediction } from './types';

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

/* ── Pearson 相关系数 ── */

export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx, yi = y[i] - my;
    num += xi * yi; dx += xi * xi; dy += yi * yi;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

/* ── 交易所净流量预测 ── */

export function predictExchangeNetflow(
  inflows: number[],
  outflows: number[],
): { direction: PredictionDirection; change: number; confidence: number; signals: PredictionSignal[]; reasons: PredictionReason[] } {
  const signals: PredictionSignal[] = [];
  const reasons: PredictionReason[] = [];
  if (inflows.length < 3 || outflows.length < 3) {
    return { direction: 'neutral', change: 0, confidence: 15, signals, reasons: [{ signal: '数据不足', impact: 'neutral', detail: '历史数据不足3天，无法分析趋势' }] };
  }
  const netflows = inflows.map((v, i) => v - outflows[i]);
  const last3 = netflows.slice(-3);
  const trend = last3[2] - last3[0];
  const trendDir: PredictionDirection = trend > 0 ? 'up' : trend < 0 ? 'down' : 'neutral';
  signals.push({ name: '净流量趋势', direction: trendDir, weight: 0.3, value: trend });
  reasons.push({ signal: '3日净流量趋势', impact: trendDir === 'up' ? 'bearish' : trendDir === 'down' ? 'bullish' : 'neutral', detail: `近3日净流量变化 ${trend > 0 ? '+' : ''}${trend.toFixed(1)} BTC，${trend > 0 ? '流入增加表示卖压上升' : trend < 0 ? '流出增加表示囤币意愿增强' : '变化不大'}` });

  const avgIn = inflows.reduce((a, b) => a + b, 0) / inflows.length;
  const avgOut = outflows.reduce((a, b) => a + b, 0) / outflows.length;
  const ratio = avgOut > 0 ? avgIn / avgOut : 1;
  const ratioDir: PredictionDirection = ratio > 1.1 ? 'up' : ratio < 0.9 ? 'down' : 'neutral';
  signals.push({ name: '流入流出比', direction: ratioDir, weight: 0.3, value: ratio });
  reasons.push({ signal: '流入/流出比', impact: ratio > 1.1 ? 'bearish' : ratio < 0.9 ? 'bullish' : 'neutral', detail: `流入/流出比 ${ratio.toFixed(2)}，${ratio > 1.1 ? '流入大于流出，卖压偏高' : ratio < 0.9 ? '流出大于流入，市场偏向囤币' : '流入流出基本平衡'}` });

  const sma3 = netflows.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const sma7 = netflows.length >= 7 ? netflows.slice(-7).reduce((a, b) => a + b, 0) / 7 : sma3;
  const crossDir: PredictionDirection = sma3 > sma7 ? 'up' : sma3 < sma7 ? 'down' : 'neutral';
  signals.push({ name: 'SMA交叉', direction: crossDir, weight: 0.2, value: sma3 - sma7 });
  reasons.push({ signal: '短期/长期均线交叉', impact: crossDir === 'up' ? 'bearish' : crossDir === 'down' ? 'bullish' : 'neutral', detail: `3日均线 ${sma3 > sma7 ? '上穿' : sma3 < sma7 ? '下穿' : '持平于'} 7日均线，${sma3 > sma7 ? '短期流入加速' : sma3 < sma7 ? '短期流出加速' : '趋势不明'}` });

  const mom = netflows.length >= 5 ? netflows[netflows.length - 1] - netflows[netflows.length - 5] : 0;
  const momDir: PredictionDirection = mom > 50 ? 'up' : mom < -50 ? 'down' : 'neutral';
  signals.push({ name: '动量', direction: momDir, weight: 0.2, value: mom });
  reasons.push({ signal: '5日动量', impact: momDir === 'up' ? 'bearish' : momDir === 'down' ? 'bullish' : 'neutral', detail: `5日动量 ${mom > 0 ? '+' : ''}${mom.toFixed(0)} BTC` });

  const currentValue = netflows[netflows.length - 1];
  const result = aggregateSignals(signals, currentValue);
  return { ...result, reasons };
}

/* ── 行情联动预测 ── */

export function predictCorrelationSignal(
  prices: number[],
  netflows: number[],
  currentCorr: number,
): { direction: PredictionDirection; change: number; confidence: number; signals: PredictionSignal[]; reasons: PredictionReason[]; predictedSignal: string } {
  const signals: PredictionSignal[] = [];
  const reasons: PredictionReason[] = [];
  const n = Math.min(prices.length, netflows.length);
  if (n < 10) {
    return { direction: 'neutral', change: 0, confidence: 15, signals, reasons: [{ signal: '数据不足', impact: 'neutral', detail: '数据点不足10个' }], predictedSignal: '中性' };
  }

  // 1. 相关性趋势
  const halfN = Math.floor(n / 2);
  const corrFirst = pearsonCorrelation(prices.slice(0, halfN), netflows.slice(0, halfN));
  const corrSecond = pearsonCorrelation(prices.slice(halfN), netflows.slice(halfN));
  const corrTrend = corrSecond - corrFirst;
  const corrDir: PredictionDirection = corrTrend > 0.1 ? 'up' : corrTrend < -0.1 ? 'down' : 'neutral';
  signals.push({ name: '相关性趋势', direction: corrDir, weight: 0.35, value: corrTrend });
  reasons.push({ signal: '相关性变化趋势', impact: corrDir === 'up' ? 'bearish' : corrDir === 'down' ? 'bullish' : 'neutral', detail: `前半段相关系数 ${corrFirst.toFixed(3)} → 后半段 ${corrSecond.toFixed(3)}，${corrTrend > 0.1 ? '正相关增强，价格与流入同步上升' : corrTrend < -0.1 ? '相关性减弱，市场分歧加大' : '相关性稳定'}` });

  // 2. 净流入方向
  const recentNet = netflows.slice(-5);
  const netAvg = recentNet.reduce((a, b) => a + b, 0) / recentNet.length;
  const netDir: PredictionDirection = netAvg > 0 ? 'down' : netAvg < 0 ? 'up' : 'neutral';
  signals.push({ name: '净流入方向', direction: netDir, weight: 0.3, value: netAvg });
  reasons.push({ signal: '近5日净流入均值', impact: netAvg > 0 ? 'bearish' : netAvg < 0 ? 'bullish' : 'neutral', detail: `近5日平均净流入 ${netAvg.toFixed(1)} BTC，${netAvg > 0 ? '持续流入交易所，卖压信号' : netAvg < 0 ? '持续流出交易所，囤币信号' : '基本平衡'}` });

  // 3. 价格动量
  const priceMom = prices.length >= 5 ? (prices[prices.length - 1] - prices[prices.length - 5]) / prices[prices.length - 5] * 100 : 0;
  const momDir: PredictionDirection = priceMom > 1 ? 'up' : priceMom < -1 ? 'down' : 'neutral';
  signals.push({ name: '价格动量', direction: momDir, weight: 0.35, value: priceMom });
  reasons.push({ signal: '5日价格动量', impact: momDir === 'up' ? 'bullish' : momDir === 'down' ? 'bearish' : 'neutral', detail: `5日价格变化 ${priceMom >= 0 ? '+' : ''}${priceMom.toFixed(2)}%` });

  const predictedSignal = currentCorr > 0.3 ? '卖压信号' : currentCorr < -0.3 ? '囤币信号' : '中性';
  const result = aggregateSignals(signals, Math.abs(currentCorr) * 100);
  return { ...result, reasons, predictedSignal };
}

/* ── 巨鲸持仓趋势预测 ── */

export function predictHolderTrend(
  totalHoldings: number,
  exchangeHoldings: number,
  nonExchangeHoldings: number,
  exchangeRatio: number,
  recentNetflow: number,
): { direction: PredictionDirection; change: number; confidence: number; signals: PredictionSignal[]; reasons: PredictionReason[] } {
  const signals: PredictionSignal[] = [];
  const reasons: PredictionReason[] = [];

  // 1. 交易所占比
  const ratioDir: PredictionDirection = exchangeRatio > 0.25 ? 'down' : exchangeRatio < 0.15 ? 'up' : 'neutral';
  signals.push({ name: '交易所占比', direction: ratioDir, weight: 0.3, value: exchangeRatio });
  reasons.push({ signal: '交易所持仓占比', impact: exchangeRatio > 0.25 ? 'bearish' : exchangeRatio < 0.15 ? 'bullish' : 'neutral', detail: `交易所持仓占比 ${(exchangeRatio * 100).toFixed(1)}%，${exchangeRatio > 0.25 ? '占比偏高，潜在卖压' : exchangeRatio < 0.15 ? '占比偏低，巨鲸倾向持有' : '处于正常范围'}` });

  // 2. 非交易所占优度
  const nonExRatio = totalHoldings > 0 ? nonExchangeHoldings / totalHoldings : 0.5;
  const nonExDir: PredictionDirection = nonExRatio > 0.8 ? 'up' : nonExRatio < 0.7 ? 'down' : 'neutral';
  signals.push({ name: '非交易所占优', direction: nonExDir, weight: 0.3, value: nonExRatio });
  reasons.push({ signal: '非交易所持仓占优度', impact: nonExRatio > 0.8 ? 'bullish' : nonExRatio < 0.7 ? 'bearish' : 'neutral', detail: `非交易所持仓占比 ${(nonExRatio * 100).toFixed(1)}%，${nonExRatio > 0.8 ? '巨鲸强烈囤币倾向' : nonExRatio < 0.7 ? '交易所持仓偏多' : '分布均衡'}` });

  // 3. 资金流向
  const flowDir: PredictionDirection = recentNetflow > 100 ? 'down' : recentNetflow < -100 ? 'up' : 'neutral';
  signals.push({ name: '资金流向', direction: flowDir, weight: 0.4, value: recentNetflow });
  reasons.push({ signal: '近期资金流向', impact: recentNetflow > 100 ? 'bearish' : recentNetflow < -100 ? 'bullish' : 'neutral', detail: `近期净流入交易所 ${recentNetflow > 0 ? '+' : ''}${recentNetflow.toFixed(0)} BTC，${recentNetflow > 100 ? '资金流入交易所，可能准备出售' : recentNetflow < -100 ? '资金流出交易所，囤币增加' : '流动平稳'}` });

  const result = aggregateSignals(signals, totalHoldings);
  return { ...result, reasons };
}

/* ── 大额交易频率预测 ── */

export function predictWhaleAlertFreq(
  txCount: number,
  deposits: number,
  withdrawals: number,
  transfers: number,
  totalBTC: number,
  mempoolSize: number,
): { direction: PredictionDirection; change: number; confidence: number; signals: PredictionSignal[]; reasons: PredictionReason[] } {
  const signals: PredictionSignal[] = [];
  const reasons: PredictionReason[] = [];

  // 1. 充值占比
  const total = deposits + withdrawals + transfers || 1;
  const depRatio = deposits / total;
  const depDir: PredictionDirection = depRatio > 0.5 ? 'up' : depRatio < 0.3 ? 'down' : 'neutral';
  signals.push({ name: '充值占比', direction: depDir, weight: 0.3, value: depRatio });
  reasons.push({ signal: '交易所充值占比', impact: depRatio > 0.5 ? 'bearish' : depRatio < 0.3 ? 'bullish' : 'neutral', detail: `充值占大额交易 ${(depRatio * 100).toFixed(0)}%，${depRatio > 0.5 ? '大量BTC流入交易所，卖压信号' : depRatio < 0.3 ? '充值占比低，市场偏向持有' : '充值比例正常'}` });

  // 2. Mempool 拥堵
  const mpDir: PredictionDirection = mempoolSize > 50000 ? 'up' : mempoolSize < 10000 ? 'down' : 'neutral';
  signals.push({ name: 'Mempool拥堵', direction: mpDir, weight: 0.25, value: mempoolSize });
  reasons.push({ signal: 'Mempool拥堵度', impact: mpDir === 'up' ? 'bearish' : mpDir === 'down' ? 'bullish' : 'neutral', detail: `Mempool ${mempoolSize.toLocaleString()} 笔待确认，${mempoolSize > 50000 ? '网络拥堵，大额交易可能增加' : mempoolSize < 10000 ? '网络畅通' : '正常水平'}` });

  // 3. 平均交易金额
  const avgBTC = txCount > 0 ? totalBTC / txCount : 0;
  const avgDir: PredictionDirection = avgBTC > 500 ? 'up' : avgBTC < 100 ? 'down' : 'neutral';
  signals.push({ name: '平均金额', direction: avgDir, weight: 0.25, value: avgBTC });
  reasons.push({ signal: '平均交易金额', impact: avgDir === 'up' ? 'bearish' : avgDir === 'down' ? 'bullish' : 'neutral', detail: `平均 ${avgBTC.toFixed(0)} BTC/笔，${avgBTC > 500 ? '大额交易活跃，巨鲸动作频繁' : avgBTC < 100 ? '交易金额偏小' : '金额正常'}` });

  // 4. 交易频率
  const freqDir: PredictionDirection = txCount > 15 ? 'up' : txCount < 5 ? 'down' : 'neutral';
  signals.push({ name: '交易频率', direction: freqDir, weight: 0.2, value: txCount });
  reasons.push({ signal: '大额交易频率', impact: freqDir === 'up' ? 'bearish' : freqDir === 'down' ? 'bullish' : 'neutral', detail: `当前 ${txCount} 笔大额交易，${txCount > 15 ? '频率偏高，市场活跃' : txCount < 5 ? '频率偏低，市场平静' : '频率正常'}` });

  const result = aggregateSignals(signals, txCount);
  return { ...result, reasons };
}

/* ── 预测结果解释生成器 ── */

export function generateResolutionExplanation(
  prediction: Prediction,
  actualValue: number,
): ResolutionExplanation {
  const actualChange = prediction.currentValue !== 0
    ? ((actualValue - prediction.currentValue) / prediction.currentValue) * 100
    : 0;
  const dirCorrect =
    (prediction.direction === 'up' && actualChange > 0) ||
    (prediction.direction === 'down' && actualChange < 0) ||
    (prediction.direction === 'neutral' && Math.abs(actualChange) < 0.1);
  const error = Math.abs(actualChange - prediction.predictedChange);

  const reasons: string[] = [];
  const dirLabel = prediction.direction === 'up' ? '上升' : prediction.direction === 'down' ? '下降' : '持平';
  const actualDirLabel = actualChange > 0 ? '上升' : actualChange < 0 ? '下降' : '持平';

  if (dirCorrect) {
    reasons.push(`方向预测正确：预测${dirLabel}，实际${actualDirLabel}`);
    if (error < 0.5) reasons.push('幅度预测精准，误差小于0.5%');
    else if (error < 2) reasons.push(`幅度偏差 ${error.toFixed(2)}%，在合理范围内`);
    else reasons.push(`幅度偏差 ${error.toFixed(2)}%，方向正确但幅度估计不够准确`);
  } else {
    reasons.push(`方向预测错误：预测${dirLabel}，实际${actualDirLabel}`);
    reasons.push(`实际变化 ${actualChange >= 0 ? '+' : ''}${actualChange.toFixed(2)}%，与预测方向相反`);
  }

  if (prediction.reasons && prediction.reasons.length > 0) {
    const correctSignals = prediction.reasons.filter((r) => {
      if (actualChange > 0) return r.impact === 'bullish';
      if (actualChange < 0) return r.impact === 'bearish';
      return r.impact === 'neutral';
    });
    const wrongSignals = prediction.reasons.filter((r) => {
      if (actualChange > 0) return r.impact === 'bearish';
      if (actualChange < 0) return r.impact === 'bullish';
      return false;
    });
    if (correctSignals.length > 0) reasons.push(`有效信号：${correctSignals.map((s) => s.signal).join('、')}`);
    if (wrongSignals.length > 0) reasons.push(`误导信号：${wrongSignals.map((s) => s.signal).join('、')}`);
  }

  const keyFactor = dirCorrect
    ? (error < 1 ? '多数技术指标方向一致且幅度估计准确' : '方向判断正确，但幅度受短期波动影响')
    : '市场出现与技术指标相反的走势，可能受突发事件或大额交易影响';

  const summary = dirCorrect
    ? `预测正确 ✓ — 预测${dirLabel} ${prediction.predictedChange >= 0 ? '+' : ''}${prediction.predictedChange.toFixed(2)}%，实际${actualDirLabel} ${actualChange >= 0 ? '+' : ''}${actualChange.toFixed(2)}%，偏差 ${error.toFixed(2)}%`
    : `预测错误 ✗ — 预测${dirLabel} ${prediction.predictedChange >= 0 ? '+' : ''}${prediction.predictedChange.toFixed(2)}%，实际${actualDirLabel} ${actualChange >= 0 ? '+' : ''}${actualChange.toFixed(2)}%`;

  return { summary, reasons, keyFactor };
}
