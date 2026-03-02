/**
 * API endpoint to start the worker process ONLY when user clicks "Start" button
 * ✅ FIXED: Worker only starts on explicit user action, never automatically
 */

import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

// Global worker process reference
declare global {
    var _workerProcess: any;
    var _workerStartTime: number;
}

export async function POST() {
    try {
        console.log('\n🚀 [API] User clicked "Start" button - Starting worker...');
        
        // Check if worker is already running
        if (global._workerProcess && !global._workerProcess.killed) {
            console.log('⚠️ [API] Worker already running - PID:', global._workerProcess.pid);
            return NextResponse.json({
                success: true,
                message: 'Worker already running',
                pid: global._workerProcess.pid,
                uptime: Date.now() - (global._workerStartTime || Date.now())
            });
        }

        // ✅ USER ACTION: Start the worker process
        const workerPath = path.join(process.cwd(), 'worker.ts');
        
        console.log('📂 [API] Worker path:', workerPath);
        console.log('✅ [API] Spawning worker process...');
        
        const workerProcess = spawn('npx', ['tsx', workerPath], {
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: process.cwd()
        });

        // Store process globally
        global._workerProcess = workerProcess;
        global._workerStartTime = Date.now();

        console.log(`✅ [API] Worker started - PID: ${workerProcess.pid}`);

        // Log worker output
        workerProcess.stdout?.on('data', (data) => {
            console.log(`[WORKER] ${data.toString().trim()}`);
        });

        workerProcess.stderr?.on('data', (data) => {
            console.error(`[WORKER ERROR] ${data.toString().trim()}`);
        });

        workerProcess.on('exit', (code) => {
            console.log(`[WORKER] Process exited with code ${code}`);
            global._workerProcess = null;
        });

        // Allow worker to start
        await new Promise(resolve => setTimeout(resolve, 2000));

        return NextResponse.json({
            success: true,
            message: 'Worker started by USER ACTION',
            pid: workerProcess.pid,
            startedAt: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('❌ [API] Failed to start worker:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}

export async function GET() {
    const isRunning = global._workerProcess && !global._workerProcess.killed;
    
    return NextResponse.json({
        running: isRunning,
        pid: global._workerProcess?.pid,
        uptime: isRunning ? Date.now() - (global._workerStartTime || Date.now()) : 0
    });
}
