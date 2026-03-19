"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
const port = process.env.PORT || 7860;
let workerProcess = null;
let watchdogTimer = null;
const WATCHDOG_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes - generous for search + conservative delays
/**
 * Stealth Traffic Logger
 */
app.use((req, res, next) => {
    const now = new Date().toLocaleTimeString();
    const ua = req.headers['user-agent'] || 'No-UA';
    const source = ua.includes('Better Stack') ? '🛡️ Pinger' : (ua.includes('HuggingFace') ? '🤗 HF' : '👤 User');
    console.log(`[ACCESS] ${now} | ${req.url} | ${source}`);
    next();
});
/**
 * 🕵️ Stealth Mode Helper: Random Latency
 * Simulates human-like server response time to avoid bot detection.
 */
const stealthDelay = () => new Promise(res => setTimeout(res, 500 + Math.random() * 2000));
/**
 * 🏠 Stealth Decoy Page (Root)
 * Replaces the technical status page with a natural-looking portfolio.
 */
app.get('/', async (req, res) => {
    await stealthDelay();
    res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Creative Portfolio | Sam Dev</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #fafafa; color: #333; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); text-align: center; max-width: 400px; }
        h1 { color: #2c3e50; font-size: 1.5rem; }
        p { color: #7f8c8d; }
        .status { font-size: 0.8rem; color: #bdc3c7; margin-top: 2rem; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Sam's Micro-Apps</h1>
        <p>A collection of lightweight automation tools and experiments.</p>
        <div class="status">System operational &bull; Built with Node.js</div>
      </div>
    </body>
    </html>
  `);
});
/**
 * 📡 Private Diagnostic Endpoint
 */
app.get('/diag', async (req, res) => {
    await stealthDelay();
    res.json({
        active: true,
        ts: Date.now(),
        worker: !!workerProcess
    });
});
function resetWatchdog() {
    if (watchdogTimer)
        clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
        console.warn(`[SUPERVISOR] 🚨 WATCHDOG: Worker looks hung (>60m). Force Restarting...`);
        launchWorker();
    }, WATCHDOG_TIMEOUT_MS);
}
function launchWorker() {
    if (workerProcess) {
        console.log('[SUPERVISOR] 🧹 Cleaning up existing worker process...');
        workerProcess.kill('SIGKILL');
    }
    console.log('\n[SUPERVISOR] 🚀 Launching LinkedIn worker from compiled JS...');
    const workerPath = path_1.default.join(__dirname, 'worker.js');
    workerProcess = (0, child_process_1.spawn)('node', [workerPath], {
        stdio: ['inherit', 'pipe', 'inherit'], // Pipe stdout to listen for heartbeat
        env: { ...process.env, IS_CHILD_PROCESS: 'true' }
    });
    // Reset watchdog on start
    resetWatchdog();
    // Listen for heartbeat logs to reset watchdog
    workerProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        process.stdout.write(output); // Still print to console
        if (output.includes('[WORKER_HEARTBEAT]')) {
            resetWatchdog();
        }
    });
    workerProcess.on('exit', (code, signal) => {
        console.log(`\n[SUPERVISOR] ⚠️ Worker process exited (Code: ${code}, Signal: ${signal})`);
        if (watchdogTimer) {
            clearTimeout(watchdogTimer);
            watchdogTimer = null;
        }
        // Reset state
        workerProcess = null;
        // Auto-restart after a brief cooling period
        const restartDelay = 15000;
        console.log(`[SUPERVISOR] 🔄 Scheduled restart in ${restartDelay / 1000} seconds...`);
        setTimeout(launchWorker, restartDelay);
    });
    workerProcess.on('error', (err) => {
        console.error('[SUPERVISOR] 💥 Supervisor failed to spawn worker:', err);
    });
}
/**
 * 🕵️ Self-Audit Interval (Every 10 minutes)
 * Ensures the worker is ALWAYS running even if some weird OS state kills it silently.
 */
setInterval(() => {
    if (!workerProcess) {
        console.log('[SUPERVISOR] 🕵️ Audit: Worker process missing. Re-launching...');
        launchWorker();
    }
    else {
        console.log('[SUPERVISOR] 🕵️ Audit: Worker process is healthy.');
    }
}, 10 * 60 * 1000);
// Start the Supervisor Service
app.listen(port, () => {
    console.log(`\n✅ Supervisor Server live on port ${port}`);
    console.log(`📡 Health Check URL: http://0.0.0.0:${port}/`);
    // Initial launch
    launchWorker();
});
/**
 * Clean shutdown handler
 */
const shutdown = () => {
    console.log('\n[SUPERVISOR] SIGTERM/SIGINT received. Shutting down worker and supervisor...');
    if (workerProcess)
        workerProcess.kill('SIGTERM');
    process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
