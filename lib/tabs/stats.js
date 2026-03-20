import St from 'gi://St';
import { createStatCard } from './utils.js';

export function buildStatsTab(ext, container) {
    const statsWrapper = new St.BoxLayout({ 
        style_class: 'stats-tab-content',
        vertical: true,
        x_expand: true,
        y_expand: true,
        style: 'spacing: 12px;'
    });
    
    const row1 = new St.BoxLayout({ style: 'spacing: 12px;', x_expand: true, y_expand: true });
    row1.add_child(createStatCard('CPU', 'processor-symbolic', ext._statsManager.cpuUsage, ext._statsManager.history.cpu, '#0A84FF'));
    row1.add_child(createStatCard('Memory', 'media-flash-symbolic', ext._statsManager.ramUsage, ext._statsManager.history.ram, '#30D158'));
    
    const row2 = new St.BoxLayout({ style: 'spacing: 12px;', x_expand: true, y_expand: true });
    row2.add_child(createStatCard('Disk', 'drive-harddisk-symbolic', ext._statsManager.storageUsage, ext._statsManager.history.storage, '#FF9500'));
    row2.add_child(createStatCard('GPU', 'video-display-symbolic', ext._statsManager.gpuUsage, ext._statsManager.history.gpu, '#BF5AF2'));
    
    statsWrapper.add_child(row1);
    statsWrapper.add_child(row2);
    
    container.add_child(statsWrapper);
}
