"use strict";
// ═══════════════════════════════════════════════════════════
// REAL-TIME DASHBOARD (WEBSOCKET UPDATES)
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeDashboard = void 0;
const socket_io_1 = require("socket.io");
const redis_1 = require("@upstash/redis");
class RealtimeDashboard {
    constructor(httpServer) {
        this.io = new socket_io_1.Server(httpServer, { cors: { origin: '*' } });
        const url = process.env.UPSTASH_REDIS_URL;
        const token = process.env.UPSTASH_REDIS_TOKEN;
        if (!url || !token)
            throw new Error('UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN required');
        this.redis = new redis_1.Redis({ url, token });
        this.setupHandlers();
    }
    setupHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`👤 User connected: ${socket.id}`);
            socket.on('subscribe', async (userId) => {
                socket.join(`user:${userId}`);
                await this.sendCurrentStats(userId, socket);
                this.listenForUpdates(userId);
            });
            socket.on('disconnect', () => {
                console.log(`👤 User disconnected: ${socket.id}`);
            });
        });
    }
    async sendCurrentStats(userId, socket) {
        const txKeys = (await this.redis.hkeys(`user:${userId}:transactions`));
        const txData = await Promise.all(txKeys.map((k) => this.redis.hget(`user:${userId}:transactions`, k)));
        const transactions = txData.filter(Boolean).map((d) => JSON.parse(d));
        const total = transactions.reduce((sum, t) => sum + t.amount, 0);
        const categories = {};
        for (const t of transactions) {
            if (t.category) {
                categories[t.category] = (categories[t.category] ?? 0) + t.amount;
            }
        }
        const alertsData = (await this.redis.lrange(`user:${userId}:alerts`, 0, 9));
        const alerts = (alertsData ?? []).map((a) => JSON.parse(a));
        socket.emit('stats', {
            totalSpent: total,
            transactionCount: transactions.length,
            categories,
            alerts,
        });
    }
    listenForUpdates(userId) {
        const interval = setInterval(async () => {
            const rooms = this.io.sockets.adapter.rooms.get(`user:${userId}`);
            if (!rooms || rooms.size === 0) {
                clearInterval(interval);
                return;
            }
            const newTxs = (await this.redis.lrange(`user:${userId}:new_transactions`, 0, -1));
            if (newTxs.length > 0) {
                const transactions = newTxs.map((t) => JSON.parse(t));
                this.io.to(`user:${userId}`).emit('new_transactions', transactions);
                await this.redis.del(`user:${userId}:new_transactions`);
            }
            const newAlerts = (await this.redis.lrange(`user:${userId}:new_alerts`, 0, -1));
            if (newAlerts.length > 0) {
                const alerts = newAlerts.map((a) => JSON.parse(a));
                this.io.to(`user:${userId}`).emit('new_alerts', alerts);
                await this.redis.del(`user:${userId}:new_alerts`);
            }
        }, 5000);
    }
}
exports.RealtimeDashboard = RealtimeDashboard;
//# sourceMappingURL=realtimeDashboard.js.map