/**
 * Real-time Dashboard — Socket.IO for live stats and alerts.
 * On subscribe(userId), optionally load and emit current stats.
 */

import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';

export type GetStatsForUser = (userId: string) => Promise<Record<string, unknown>>;

export interface RealtimeDashboardOptions {
  getStatsOnSubscribe?: GetStatsForUser;
}

export class RealtimeDashboard {
  private io: Server;
  private getStatsOnSubscribe?: GetStatsForUser;

  constructor(httpServer: HttpServer, options: RealtimeDashboardOptions = {}) {
    this.io = new Server(httpServer, {
      cors: { origin: '*' },
      path: '/socket.io',
    });
    this.getStatsOnSubscribe = options.getStatsOnSubscribe;

    this.io.on('connection', (socket: import('socket.io').Socket) => {
      socket.on('subscribe', async (userId: string) => {
        socket.join(`user:${userId}`);
        if (this.getStatsOnSubscribe) {
          try {
            const stats = await this.getStatsOnSubscribe(userId);
            socket.emit('stats', stats);
          } catch (e) {
            console.warn('Dashboard getStatsOnSubscribe failed:', (e as Error).message);
          }
        }
      });
    });
  }

  emitStats(userId: string, stats: Record<string, unknown>): void {
    this.io.to(`user:${userId}`).emit('stats', stats);
  }

  emitNewTransactions(userId: string, transactions: unknown[]): void {
    this.io.to(`user:${userId}`).emit('new_transactions', transactions);
  }

  emitNewAlerts(userId: string, alerts: unknown[]): void {
    this.io.to(`user:${userId}`).emit('new_alerts', alerts);
  }
}
