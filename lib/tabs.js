import Gst from 'gi://Gst';

// Initialize GStreamer
try {
    Gst.init(null);
} catch (e) {
    console.error("Docktouch: Failed to initialize GStreamer: " + e);
}

export * from './tabs/system.js';
export * from './tabs/media.js';
export * from './tabs/time.js';
export * from './tabs/stats.js';
export * from './tabs/clipboard.js';
export * from './tabs/utils.js';
