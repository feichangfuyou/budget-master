import { useState, useEffect, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ErrorBanner } from './components/ErrorBanner';
import { ChatResponse } from './components/ChatResponse';
import { StatsGrid } from './components/StatsGrid';
import { SpendingChart } from './components/SpendingChart';
import { AlertsSection } from './components/AlertsSection';
import { ForecastsSection } from './components/ForecastsSection';
import { TransactionsTable } from './components/TransactionsTable';
import { ChatBar } from './components/ChatBar';

const API = '/api';

interface Transaction {
  id: string;
  date: string;
  amount: number;
  description: string;
  category?: string | null;
  merchant?: string | null;
}

interface Anomaly {
  id: string;
  transactionId: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  explanation: string;
  recommendation?: string | null;
  acknowledged: boolean;
}

interface Forecast {
  id?: string;
  category: string;
  predictions?: Array<{
    date: string;
    predicted: number;
    confidence: { lower: number; upper: number };
  }>;
  trend: string;
  recommendations?: string[];
}

interface Metrics {
  uptime?: number;
  memory?: NodeJS.MemoryUsage;
  timestamp?: string;
}

export default function App() {
  const [activeView, setActiveView] = useState('overview');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [chatResponse, setChatResponse] = useState('');
  const [loading, setLoading] = useState({ tx: false, anomalies: false, forecasts: false });
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    setLoading((l) => ({ ...l, tx: true }));
    setError(null);
    try {
      const res = await fetch(`${API}/transactions`, {
        headers: { 'X-User-Id': 'demo-user' },
      });
      const data = await res.json();
      setTransactions(data.transactions ?? []);
    } catch (e) {
      setError('Failed to load transactions');
    } finally {
      setLoading((l) => ({ ...l, tx: false }));
    }
  }, []);

  const fetchAnomalies = useCallback(async () => {
    setLoading((l) => ({ ...l, anomalies: true }));
    try {
      const res = await fetch(`${API}/anomalies?acknowledged=false`, {
        headers: { 'X-User-Id': 'demo-user' },
      });
      const data = await res.json();
      setAnomalies(data.anomalies ?? []);
    } catch {
      setError('Failed to load alerts');
    } finally {
      setLoading((l) => ({ ...l, anomalies: false }));
    }
  }, []);

  const fetchForecasts = useCallback(async () => {
    setLoading((l) => ({ ...l, forecasts: true }));
    try {
      const res = await fetch(`${API}/forecasts`, {
        headers: { 'X-User-Id': 'demo-user' },
      });
      const data = await res.json();
      setForecasts(data.forecasts ?? []);
    } catch {
      setError('Failed to load forecasts');
    } finally {
      setLoading((l) => ({ ...l, forecasts: false }));
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${API}/metrics`);
      const data = await res.json();
      setMetrics(data);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    const ws = io(window.location.origin, { path: '/socket.io' });
    ws.on('connect', () => ws.emit('subscribe', 'demo-user'));
    ws.on('new_transactions', (data: Transaction[]) => {
      setTransactions((prev) => [...(data ?? []), ...prev]);
    });
    ws.on('new_alerts', (data: Anomaly[]) => {
      setAnomalies((prev) => [...(data ?? []), ...prev]);
    });
    return () => {
      ws.disconnect();
    };
  }, []);

  useEffect(() => {
    fetchTransactions();
    fetchAnomalies();
    fetchForecasts();
    fetchMetrics();
  }, [fetchTransactions, fetchAnomalies, fetchForecasts, fetchMetrics]);

  const handleChat = async (query: string) => {
    setChatResponse('');
    const res = await fetch(`${API}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'demo-user',
      },
      body: JSON.stringify({ query }),
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    if (!reader) return;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data) as { chunk?: string };
            setChatResponse((prev) => prev + (parsed.chunk ?? ''));
          } catch {
            /* ignore */
          }
        }
      }
    }
  };

  const uploadReceipt = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = (e.target?.result as string)?.split(',')[1];
      const res = await fetch(`${API}/receipts/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'demo-user',
        },
        body: JSON.stringify({ image: base64 }),
      });
      const data = await res.json();
      if (data.transaction) fetchTransactions();
    };
    reader.readAsDataURL(file);
  };

  const generateForecast = async () => {
    try {
      await fetch(`${API}/forecasts/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'demo-user',
        },
        body: JSON.stringify({ category: 'Food', daysAhead: 30 }),
      });
      fetchForecasts();
    } catch {
      setError('Failed to generate forecast');
    }
  };

  const acknowledgeAnomaly = async (id: string) => {
    try {
      await fetch(`${API}/anomalies/${id}/acknowledge`, {
        method: 'POST',
        headers: { 'X-User-Id': 'demo-user' },
      });
      fetchAnomalies();
    } catch {
      setError('Failed to acknowledge');
    }
  };

  const totalSpent = transactions.reduce((s, t) => s + t.amount, 0);
  const activeAlerts = anomalies.filter((a) => !a.acknowledged);
  const averageTransaction = transactions.length > 0 ? totalSpent / transactions.length : 0;
  
  // Get top category
  const categoryTotals = transactions.reduce((acc, tx) => {
    const category = tx.category || 'Uncategorized';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const topCategory = Object.entries(categoryTotals).sort(([, a], [, b]) => b - a)[0]?.[0];

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-gray-50">
      <Sidebar activeView={activeView} onViewChange={setActiveView} />

      <div className="flex min-w-0 flex-1 flex-col lg:ml-64">
        <Header uptime={metrics?.uptime} />

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {chatResponse && <ChatResponse response={chatResponse} onDismiss={() => setChatResponse('')} />}

        <main className="min-h-0 flex-1 overflow-y-auto pb-24">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {/* Overview */}
            {activeView === 'overview' && (
              <div className="space-y-8">
                <div>
                  <h1 className="text-balance text-2xl font-bold text-gray-900">
                    Welcome back
                  </h1>
                  <p className="mt-1 text-pretty text-sm text-gray-600">
                    Here's what's happening with your budget today.
                  </p>
                </div>

                <StatsGrid
                  totalSpent={totalSpent}
                  transactionCount={transactions.length}
                  averageTransaction={averageTransaction}
                  topCategory={topCategory}
                />

                <div className="grid gap-8 lg:grid-cols-2">
                  <SpendingChart transactions={transactions} />
                  
                  <div className="space-y-6">
                    {activeAlerts.length > 0 && (
                      <AlertsSection
                        anomalies={activeAlerts.slice(0, 3)}
                        onAcknowledge={acknowledgeAnomaly}
                        isLoading={loading.anomalies && anomalies.length === 0}
                      />
                    )}
                  </div>
                </div>

                <ForecastsSection
                  forecasts={forecasts}
                  onGenerate={generateForecast}
                  isLoading={loading.forecasts}
                />
              </div>
            )}

            {/* Transactions View */}
            {activeView === 'transactions' && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-balance text-2xl font-bold text-gray-900">
                    Transactions
                  </h1>
                  <p className="mt-1 text-pretty text-sm text-gray-600">
                    View and manage all your transactions.
                  </p>
                </div>

                <StatsGrid
                  totalSpent={totalSpent}
                  transactionCount={transactions.length}
                  averageTransaction={averageTransaction}
                  topCategory={topCategory}
                />

                <TransactionsTable
                  transactions={transactions}
                  onRefresh={fetchTransactions}
                  isLoading={loading.tx}
                />
              </div>
            )}

            {/* Forecasts View */}
            {activeView === 'forecasts' && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-balance text-2xl font-bold text-gray-900">
                    Budget Forecasts
                  </h1>
                  <p className="mt-1 text-pretty text-sm text-gray-600">
                    AI-powered predictions for your spending patterns.
                  </p>
                </div>

                <ForecastsSection
                  forecasts={forecasts}
                  onGenerate={generateForecast}
                  isLoading={loading.forecasts}
                />
              </div>
            )}

            {/* Alerts View */}
            {activeView === 'alerts' && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-balance text-2xl font-bold text-gray-900">
                    Alerts & Anomalies
                  </h1>
                  <p className="mt-1 text-pretty text-sm text-gray-600">
                    Review unusual spending patterns and alerts.
                  </p>
                </div>

                <AlertsSection
                  anomalies={activeAlerts}
                  onAcknowledge={acknowledgeAnomaly}
                  isLoading={loading.anomalies && anomalies.length === 0}
                />
              </div>
            )}
          </div>
        </main>

        <ChatBar onSubmit={handleChat} onFileUpload={uploadReceipt} />
      </div>
    </div>
  );
}
