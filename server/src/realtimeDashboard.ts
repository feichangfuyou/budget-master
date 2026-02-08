// ═══════════════════════════════════════════════════════════
// REAL-TIME DASHBOARD (WEBSOCKET UPDATES)
// ═══════════════════════════════════════════════════════════

import { Server } from 'socket.io';
import { Redis } from '@upstash/redis';
import type { Transaction } from './types.js';

export class RealtimeDashboard {
  private io: Server;
  private redis: Redis;

  constructor(httpServer: ReturnType<typeof createServer>) {
    this.io = new Server(httpServer, { cors: { origin: '*' } });
    const url = process.env.UPSTASH_REDIS_URL;
    const token = process.env.UPSTASH_REDIS_TOKEN;
    if (!url || !token) throw new Error('UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN required');
    this.redis = new Redis({ url, token });
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log(`👤 User connected: ${socket.id}`);

      socket.on('subscribe', async (userId: string) => {
        socket.join(`user:${userId}`);
        await this.sendCurrentStats(userId, socket);
        this.listenForUpdates(userId);
      });

      socket.on('disconnect', () => {
        console.log(`👤 User disconnected: ${socket.id}`);
      });
    });
  }

  private async sendCurrentStats(userId: string, socket: { emit: (event: string, data: unknown) => void }): Promise<void> {
    const txKeys = (await this.redis.hkeys(`user:${userId}:transactions`)) as string[];
    const txData = await Promise.all(
      txKeys.map((k) => this.redis.hget(`user:${userId}:transactions`, k))
    );
    const transactions = (txData.filter(Boolean) as string[]).map((d) =>
      JSON.parse(d) as Transaction
    );

    const total = transactions.reduce(
      (sum: number, t: Transaction) => sum + t.amount,
      0
    );
    const categories: Record<string, number> = {};
    for (const t of transactions) {
      if (t.category) {
        categories[t.category] = (categories[t.category] ?? 0) + t.amount;
      }
    }

    const alertsData = (await this.redis.lrange(`user:${userId}:alerts`, 0, 9)) as string[];
    const alerts = (alertsData ?? []).map((a) => JSON.parse(a));

    socket.emit('stats', {
      totalSpent: total,
      transactionCount: transactions.length,
      categories,
      alerts,
    });
  }

  private listenForUpdates(userId: string): void {
    const interval = setInterval(async () => {
      const rooms = this.io.sockets.adapter.rooms.get(`user:${userId}`);
      if (!rooms || rooms.size === 0) {
        clearInterval(interval);
        return;
      }
      const newTxs = (await this.redis.lrange(`user:${userId}:new_transactions`, 0, -1)) as string[];
      if (newTxs.length > 0) {
        const transactions = newTxs.map((t) => JSON.parse(t));
        this.io.to(`user:${userId}`).emit('new_transactions', transactions);
        await this.redis.del(`user:${userId}:new_transactions`);
      }
      const newAlerts = (await this.redis.lrange(`user:${userId}:new_alerts`, 0, -1)) as string[];
      if (newAlerts.length > 0) {
        const alerts = newAlerts.map((a) => JSON.parse(a));
        this.io.to(`user:${userId}`).emit('new_alerts', alerts);
        await this.redis.del(`user:${userId}:new_alerts`);
      }
    }, 5000);
  }
}
