import { useState, useCallback } from 'react';
import type { Prediction, PredictionTarget, PredictionAccuracy } from '../types';

const STORAGE_KEY = 'btc_monitor_predictions';
const MAX_PREDICTIONS = 500;

function loadPredictions(): Prediction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePredictions(predictions: Prediction[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(predictions.slice(0, MAX_PREDICTIONS)));
  } catch { /* quota exceeded */ }
}

export function usePredictions() {
  const [predictions, setPredictions] = useState<Prediction[]>(loadPredictions);

  const addPrediction = useCallback((prediction: Prediction) => {
    setPredictions((prev) => {
      const next = [prediction, ...prev].slice(0, MAX_PREDICTIONS);
      savePredictions(next);
      return next;
    });
  }, []);

  const resolvePrediction = useCallback((
    id: string,
    actualValue: number,
  ) => {
    setPredictions((prev) => {
      const next = prev.map((p) => {
        if (p.id !== id || p.resolved) return p;
        const actualChange = p.currentValue !== 0
          ? ((actualValue - p.currentValue) / p.currentValue) * 100
          : 0;
        const directionCorrect =
          (p.direction === 'up' && actualChange > 0) ||
          (p.direction === 'down' && actualChange < 0) ||
          (p.direction === 'neutral' && Math.abs(actualChange) < 0.1);
        return {
          ...p,
          resolved: true,
          actualValue,
          actualChange,
          accurate: directionCorrect,
          error: Math.abs(actualChange - p.predictedChange),
        };
      });
      savePredictions(next);
      return next;
    });
  }, []);

  const getAccuracy = useCallback((target?: PredictionTarget): PredictionAccuracy[] => {
    const targets: PredictionTarget[] = target
      ? [target]
      : ['price', 'tx_volume', 'whale_movement', 'large_tx'];

    return targets.map((t) => {
      const resolved = predictions.filter((p) => p.target === t && p.resolved);
      const correct = resolved.filter((p) => p.accurate);
      const now = Math.floor(Date.now() / 1000);
      const last24h = resolved.filter((p) => now - p.createdAt < 86400);
      const last24hCorrect = last24h.filter((p) => p.accurate);

      return {
        target: t,
        totalPredictions: resolved.length,
        correctPredictions: correct.length,
        accuracy: resolved.length > 0 ? (correct.length / resolved.length) * 100 : 0,
        avgError: resolved.length > 0
          ? resolved.reduce((s, p) => s + (p.error || 0), 0) / resolved.length
          : 0,
        last24hAccuracy: last24h.length > 0
          ? (last24hCorrect.length / last24h.length) * 100
          : 0,
      };
    });
  }, [predictions]);

  const clearHistory = useCallback(() => {
    setPredictions([]);
    savePredictions([]);
  }, []);

  const activePredictions = predictions.filter((p) => !p.resolved);
  const resolvedPredictions = predictions.filter((p) => p.resolved);

  return {
    predictions,
    activePredictions,
    resolvedPredictions,
    addPrediction,
    resolvePrediction,
    getAccuracy,
    clearHistory,
  };
}
