"use strict";
/**
 * Real-time Dashboard — Socket.IO for live stats and alerts.
 * On subscribe(userId), optionally load and emit current stats.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealtimeDashboard = void 0;
const socket_io_1 = require("socket.io");
class RealtimeDashboard {
    constructor(httpServer, options = {}) {
        this.io = new socket_io_1.Server(httpServer, {
            cors: { origin: '*' },
            path: '/socket.io',
        });
        this.getStatsOnSubscribe = options.getStatsOnSubscribe;
        this.io.on('connection', (socket) => {
            socket.on('subscribe', async (userId) => {
                socket.join(`user:${userId}`);
                if (this.getStatsOnSubscribe) {
                    try {
                        const stats = await this.getStatsOnSubscribe(userId);
                        socket.emit('stats', stats);
                    }
                    catch (e) {
                        console.warn('Dashboard getStatsOnSubscribe failed:', e.message);
                    }
                }
            });
        });
    }
    emitStats(userId, stats) {
        this.io.to(`user:${userId}`).emit('stats', stats);
    }
    emitNewTransactions(userId, transactions) {
        this.io.to(`user:${userId}`).emit('new_transactions', transactions);
    }
    emitNewAlerts(userId, alerts) {
        this.io.to(`user:${userId}`).emit('new_alerts', alerts);
    }
}
exports.RealtimeDashboard = RealtimeDashboard;
//# sourceMappingURL=realtimeDashboard.js.map