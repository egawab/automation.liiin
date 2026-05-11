const fs = require('fs');
const bridgePath = 'extension/dashboard-bridge.js';

try {
  let bridge = fs.readFileSync(bridgePath, 'utf8');

  bridge = bridge.replace(
    `    } catch(e) {
      console.error("[Nexora Bridge] connect() failed:", e.message);
    }`,
    `    } catch(e) {
      console.error("[Nexora Bridge] connect() failed:", e.message);
      if (e.message.includes('Extension context invalidated')) {
        console.warn("[Nexora Bridge] Extension was updated. Reloading page to inject new script...");
        window.location.reload();
      } else {
        window.postMessage({ source: 'NEXORA_EXTENSION', action: 'ENGINE_ERROR', error: e.message }, '*');
      }
    }`
  );

  fs.writeFileSync(bridgePath, bridge, 'utf8');
  console.log('Successfully patched dashboard-bridge.js!');
} catch (e) {
  console.error('Error patching:', e);
}
