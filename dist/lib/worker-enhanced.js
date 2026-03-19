"use strict";
/**
 * Enhanced Worker with Live Broadcasting
 * This module wraps the existing worker with live streaming capabilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveWorkerWrapper = void 0;
const worker_broadcast_1 = require("./worker-broadcast");
class LiveWorkerWrapper {
    screenshotInterval = null;
    isActive = false;
    /**
     * Start live broadcasting with automatic screenshots
     */
    async start(page, intervalSeconds = 3) {
        this.isActive = true;
        // Broadcast initial status
        await (0, worker_broadcast_1.broadcastStatus)('Worker started - live streaming enabled');
        // Start periodic screenshot broadcasting
        this.screenshotInterval = setInterval(async () => {
            if (this.isActive && page) {
                try {
                    await (0, worker_broadcast_1.broadcastScreenshot)(page, 'Live browser view');
                }
                catch (error) {
                    // Page might be closed, ignore
                }
            }
        }, intervalSeconds * 1000);
    }
    /**
     * Stop live broadcasting
     */
    async stop() {
        this.isActive = false;
        if (this.screenshotInterval) {
            clearInterval(this.screenshotInterval);
            this.screenshotInterval = null;
        }
        await (0, worker_broadcast_1.broadcastStatus)('Worker stopped');
    }
    /**
     * Log an action with live broadcast
     */
    async logAction(action, details) {
        console.log(`   ✅ ${action}`);
        await (0, worker_broadcast_1.broadcastAction)(action, details);
    }
    /**
     * Log a message with live broadcast
     */
    async logMessage(message, level = 'info') {
        console.log(`   ${level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️'} ${message}`);
        await (0, worker_broadcast_1.broadcastLog)(message, level);
    }
    /**
     * Log an error with live broadcast
     */
    async logError(error, details) {
        console.error(`   ❌ ${error}`);
        await (0, worker_broadcast_1.broadcastError)(error, details);
    }
    /**
     * Capture and broadcast a specific screenshot with message
     */
    async captureScreenshot(page, message, metadata) {
        await (0, worker_broadcast_1.broadcastScreenshot)(page, message, metadata);
    }
    /**
     * Update worker status
     */
    async updateStatus(status, metadata) {
        console.log(`   📊 ${status}`);
        await (0, worker_broadcast_1.broadcastStatus)(status, metadata);
    }
}
exports.LiveWorkerWrapper = LiveWorkerWrapper;
