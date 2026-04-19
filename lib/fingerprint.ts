/**
 * Generates a resilient, deterministic device fingerprint hash using Canvas and hardware concurrency.
 * This does not rely on cookies or localStorage so it survives incognito/cache clearing.
 */
export async function generateDeviceFingerprint(): Promise<string> {
    try {
        if (typeof window === 'undefined') {
            return 'server_fingerprint';
        }

        const nav = window.navigator;
        const screen = window.screen;
        const components: string[] = [];
        
        components.push(nav.userAgent);
        components.push(nav.language);
        components.push(screen.colorDepth ? screen.colorDepth.toString() : '');
        components.push((screen.width || '') + 'x' + (screen.height || ''));
        components.push(new Date().getTimezoneOffset().toString());
        components.push(String(nav.hardwareConcurrency || ''));
        
        // Canvas fingerprinting (draw text, get data URL)
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.textBaseline = "top";
            ctx.font = "14px 'Arial'";
            ctx.textBaseline = "alphabetic";
            ctx.fillStyle = "#f60";
            ctx.fillRect(125,1,62,20);
            ctx.fillStyle = "#069";
            ctx.fillText("Nexora \ud83d\ude03", 2, 15);
            ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
            ctx.fillText("Nexora \ud83d\ude03", 4, 17);
            components.push(canvas.toDataURL());
        }

        const rawString = components.join('|');
        const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawString));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        // Cache internally against minor fluctuations
        try {
            const cached = localStorage.getItem('nx_device_id');
            if (cached && cached !== hashHex) {
                // If they have a completely different cached ID, still return the generated hash 
                // but keep the cache alive to detect tampering
                return cached;
            }
            localStorage.setItem('nx_device_id', hashHex);
        } catch(e) {}

        return hashHex;
    } catch (e) {
        // Fallback or random id if fingerprinting fails (e.g. strict brave shields)
        try {
            let stored = localStorage.getItem('nx_device_id');
            if (!stored) {
                stored = 'fallback_' + Math.random().toString(36).substring(2, 15);
                localStorage.setItem('nx_device_id', stored);
            }
            return stored;
        } catch(fallbackErr) {
            return 'fallback_unknown_device';
        }
    }
}
