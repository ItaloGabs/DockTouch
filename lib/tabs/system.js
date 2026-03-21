import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import Gst from 'gi://Gst';
import { getBatteryIcon } from '../utils.js';

export function buildSystemTab(ext, columns) {
    const sysCol = new St.BoxLayout({ 
        vertical: true, 
        style_class: 'widget-panel system-tab', 
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.START,
        style: 'spacing: 16px; padding: 25px;'
    });

    const topRow = new St.BoxLayout({ style: 'spacing: 20px;', x_align: Clutter.ActorAlign.CENTER });
    sysCol.add_child(topRow);

    // User Avatar
    const avatarBox = new St.Bin({ 
        style_class: 'user-avatar-container',
        y_align: Clutter.ActorAlign.CENTER
    });
    
    if (ext._systemInfo.avatar) {
        avatarBox.set_style(`
            background-image: url("${ext._systemInfo.avatar}");
            background-size: cover;
            width: 70px;
            height: 70px;
            border-radius: 35px;
            border: 2px solid rgba(255,255,255,0.2);
        `);
    } else {
        avatarBox.set_child(new St.Icon({
            icon_name: 'avatar-default-symbolic',
            icon_size: 48,
            style_class: 'default-avatar-icon'
        }));
        avatarBox.set_style(`
            width: 70px;
            height: 70px;
            border-radius: 35px;
            background-color: rgba(255,255,255,0.1);
        `);
    }
    topRow.add_child(avatarBox);

    // User and Distro info
    const infoBox = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 2px;' });
    
    infoBox.add_child(new St.Label({ 
        text: ext._systemInfo.username, 
        style_class: 'user-name-label',
        style: 'font-size: 14pt; font-weight: bold;'
    }));

    infoBox.add_child(new St.Label({ 
        text: ext._systemInfo.distro, 
        style_class: 'distro-name-label',
        style: 'opacity: 0.8;'
    }));

    // Battery Info (Charging status)
    const batteryBox = new St.BoxLayout({ 
        style_class: 'battery-info-box',
        style: 'margin-top: 4px; spacing: 6px;'
    });
    
    const isCharging = ext._statsManager.isCharging;
    const percentage = ext._statsManager.batteryPercentage;

    const batteryIcon = new St.Icon({
        icon_name: getBatteryIcon(percentage, isCharging),
        icon_size: 16,
        style: isCharging ? 'color: #30D158;' : (percentage < 20 ? 'color: #FF453A;' : 'opacity: 0.9;')
    });
    batteryBox.add_child(batteryIcon);
    
    const batteryLabel = new St.Label({
        text: `${percentage}% ${isCharging ? '(Carregando)' : ''}`,
        style: 'font-size: 9pt;',
        y_align: Clutter.ActorAlign.CENTER
    });
    batteryBox.add_child(batteryLabel);
    infoBox.add_child(batteryBox);
    topRow.add_child(infoBox);

    // Detailed Info Grid
    const detailsGrid = new St.BoxLayout({ 
        vertical: true, 
        style: 'margin-top: 10px; spacing: 8px; background-color: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px;' 
    });
    
    const addDetail = (label, value) => {
        const row = new St.BoxLayout({ style: 'spacing: 10px;' });
        row.add_child(new St.Label({ text: label, style: 'font-weight: bold; width: 80px; opacity: 0.6;' }));
        row.add_child(new St.Label({ text: value, x_expand: true }));
        detailsGrid.add_child(row);
    };

    addDetail('Kernel', ext._systemInfo.kernel || 'N/A');
    addDetail('Shell', `GNOME ${ext._systemInfo.shellVersion || ''}`);
    addDetail('CPU', ext._statsManager.cpuModel || 'Intel/AMD Processor');
    addDetail('Memória', `${ext._statsManager.memTotalGB || '8'} GB Total`);
    addDetail('Disco', `${ext._statsManager.storageUsage}% de ${ext._statsManager.storageTotalGB} GB`);
    addDetail('Uptime', ext._statsManager.uptime || '0h 0m');

    sysCol.add_child(detailsGrid);

    // Volume Control
    const volBox = new St.BoxLayout({ 
        style: 'margin-top: 10px; spacing: 10px; background-color: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px;',
        vertical: true
    });
    
    const volHeader = new St.BoxLayout({ style: 'spacing: 8px; margin-bottom: 4px;' });
    
    const volIcon = new St.Icon({ icon_name: 'audio-volume-high-symbolic', icon_size: 16 });
    const volMuteBtn = new St.Button({
        child: volIcon,
        style_class: 'tab-button',
        y_align: Clutter.ActorAlign.CENTER
    });

    const updateVolIcon = () => {
        if (!ext._sink) return;
        if (ext._sink.is_muted) {
            volIcon.icon_name = 'audio-volume-muted-symbolic';
        } else {
            const v = ext._sink.volume / ext._volumeControl.get_vol_max_norm();
            if (v <= 0) volIcon.icon_name = 'audio-volume-muted-symbolic';
            else if (v < 0.33) volIcon.icon_name = 'audio-volume-low-symbolic';
            else if (v < 0.66) volIcon.icon_name = 'audio-volume-medium-symbolic';
            else volIcon.icon_name = 'audio-volume-high-symbolic';
        }
    };

    volMuteBtn.connect('clicked', () => {
        if (ext._sink) {
            ext._sink.is_muted = !ext._sink.is_muted;
            updateVolIcon();
        }
    });

    volHeader.add_child(volMuteBtn);
    volHeader.add_child(new St.Label({ text: 'Volume', style: 'font-weight: bold;', y_align: Clutter.ActorAlign.CENTER }));
    volHeader.add_child(new St.Widget({ x_expand: true }));
    
    const currentVol = ext._sink ? (ext._sink.volume / ext._volumeControl.get_vol_max_norm()) : 0;
    ext._volLabel = new St.Label({ 
        text: ext._sink && ext._sink.is_muted ? 'MUTE' : `${Math.round(currentVol * 100)}%`,
        y_align: Clutter.ActorAlign.CENTER 
    });
    volHeader.add_child(ext._volLabel);
    volBox.add_child(volHeader);
    
    ext._volSlider = new Slider.Slider(currentVol);
    ext._volSlider.x_expand = true;
    ext._volSlider.reactive = true;
    
    ext._volSlider.connect('notify::value', () => {
        if (ext._sink) {
            const maxVol = ext._volumeControl.get_vol_max_norm();
            ext._sink.volume = ext._volSlider.value * maxVol;
            ext._sink.push_volume();
            ext._volLabel.text = ext._sink.is_muted ? 'MUTE' : `${Math.round(ext._volSlider.value * 100)}%`;
            updateVolIcon();
        }
    });
    
    updateVolIcon();
    volBox.add_child(ext._volSlider);
    sysCol.add_child(volBox);

    // Microphone Control
    const micBox = new St.BoxLayout({ 
        style: 'margin-top: 10px; spacing: 10px; background-color: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px;',
        vertical: true
    });
    
    const micHeader = new St.BoxLayout({ style: 'spacing: 8px; margin-bottom: 4px;' });
    const micIcon = new St.Icon({ 
        icon_name: ext._source && ext._source.is_muted ? 'microphone-sensitivity-muted-symbolic' : 'microphone-sensitivity-medium-symbolic', 
        icon_size: 16 
    });
    
    const micMuteBtn = new St.Button({
        child: micIcon,
        style_class: 'tab-button',
        y_align: Clutter.ActorAlign.CENTER
    });
    
    const currentMicVol = ext._source ? (ext._source.volume / ext._volumeControl.get_vol_max_norm()) : 0;
    const micVolLabel = new St.Label({ 
        text: ext._source && ext._source.is_muted ? 'MUTE' : `${Math.round(currentMicVol * 100)}%`,
        y_align: Clutter.ActorAlign.CENTER 
    });

    const updateMicIcon = () => {
        if (!ext._source) return;
        micIcon.icon_name = ext._source.is_muted ? 'microphone-sensitivity-muted-symbolic' : 'microphone-sensitivity-medium-symbolic';
    };

    micMuteBtn.connect('clicked', () => {
        if (ext._source) {
            ext._source.is_muted = !ext._source.is_muted;
            updateMicIcon();
            micVolLabel.text = ext._source.is_muted ? 'MUTE' : `${Math.round((ext._source.volume / ext._volumeControl.get_vol_max_norm()) * 100)}%`;
        }
    });

    micHeader.add_child(micMuteBtn);
    micHeader.add_child(new St.Label({ text: 'Microfone', style: 'font-weight: bold;', y_align: Clutter.ActorAlign.CENTER }));
    micHeader.add_child(new St.Widget({ x_expand: true }));
    
    micHeader.add_child(micVolLabel);
    micBox.add_child(micHeader);
    
    const micSlider = new Slider.Slider(currentMicVol);
    micSlider.x_expand = true;
    micSlider.reactive = true;
    
    micSlider.connect('notify::value', () => {
        if (ext._source) {
            const maxVol = ext._volumeControl.get_vol_max_norm();
            ext._source.volume = micSlider.value * maxVol;
            ext._source.push_volume();
            micVolLabel.text = ext._source.is_muted ? 'MUTE' : `${Math.round(micSlider.value * 100)}%`;
            updateMicIcon();
        }
    });
    
    updateMicIcon();
    micBox.add_child(micSlider);
    sysCol.add_child(micBox);
    
    // Mirror Video Bin (Hidden by default, shown when mirror active)
    ext._mirrorVideoBin = new St.Bin({
        style_class: 'mirror-video-bin-compact',
        visible: false,
        x_expand: true,
        height: 120,
        style: 'margin-top: 10px; background-color: black; border-radius: 12px; overflow: hidden;'
    });
    // This part depends on Gst which is initialized in the main tabs module usually
    // or we can just hope it's initialized globally or initialize it here.
    // The previous code had it at top level of tabs.js.
    columns.add_child(sysCol);
}
