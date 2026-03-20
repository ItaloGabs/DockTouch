import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Cairo from 'gi://cairo';
import Gst from 'gi://Gst';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import { formatTime, getBatteryIcon } from './utils.js';

// Initialize GStreamer
try {
    Gst.init(null);
} catch (e) {
    console.error("Docktouch: Failed to initialize GStreamer: " + e);
}

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
    volHeader.add_child(new St.Icon({ icon_name: 'audio-volume-high-symbolic', icon_size: 16 }));
    volHeader.add_child(new St.Label({ text: 'Volume', style: 'font-weight: bold;' }));
    volHeader.add_child(new St.Widget({ x_expand: true }));
    
    const currentVol = ext._sink ? (ext._sink.volume / ext._volumeControl.get_vol_max_norm()) : 0;
    ext._volLabel = new St.Label({ 
        text: `${Math.round(currentVol * 100)}%`,
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
            ext._volLabel.text = `${Math.round(ext._volSlider.value * 100)}%`;
        }
    });
    
    volBox.add_child(ext._volSlider);
    sysCol.add_child(volBox);
    
    // Mirror Video Bin (Hidden by default, shown when mirror active)
    ext._mirrorVideoBin = new St.Bin({
        style_class: 'mirror-video-bin-compact',
        visible: false,
        x_expand: true,
        height: 120,
        style: 'margin-top: 10px; background-color: black; border-radius: 12px; overflow: hidden;'
    });
    ext._mirrorVideoBin.connect('destroy', () => {
        if (mirrorPipeline) {
            mirrorPipeline.set_state(Gst.State.NULL);
            mirrorPipeline = null;
        }
    });
    sysCol.add_child(ext._mirrorVideoBin);

    columns.add_child(sysCol);
}

let mirrorPipeline = null;
export function toggleMirror(ext, videoBin, placeholder, btnIcon) {
    if (mirrorPipeline) {
        mirrorPipeline.set_state(Gst.State.NULL);
        mirrorPipeline = null;
        if (videoBin) videoBin.visible = false;
        if (placeholder) placeholder.visible = true;
        if (btnIcon) btnIcon.icon_name = 'camera-web-symbolic';
        return false;
    }

    try {
        let sinkName = 'cluttersink';
        if (!Gst.ElementFactory.find(sinkName)) {
            sinkName = 'cluttergstsink';
            if (!Gst.ElementFactory.find(sinkName)) {
                throw new Error("No clutter-compatible video sink found.");
            }
        }
        
        const pipelineStr = `v4l2src ! videoconvert ! videoscale ! video/x-raw,width=640,height=480 ! ${sinkName} name=sink`;
        mirrorPipeline = Gst.parse_launch(pipelineStr);
        const sink = mirrorPipeline.get_by_name('sink');
        
        if (sink) {
            const videoActor = sink.texture || sink;
            if (videoActor instanceof Clutter.Actor) {
                if (videoBin) {
                    videoBin.set_child(videoActor);
                    videoBin.visible = true;
                }
                if (placeholder) placeholder.visible = false;
                if (btnIcon) btnIcon.icon_name = 'camera-off-symbolic';
                mirrorPipeline.set_state(Gst.State.PLAYING);
                return true;
            }
        }
    } catch (e) {
        console.log("Docktouch: Internal mirror failed: " + e.message);
        if (mirrorPipeline) {
            mirrorPipeline.set_state(Gst.State.NULL);
            mirrorPipeline = null;
        }
        GLib.spawn_command_line_async('sh -c "snapshot || cheese || gnome-camera || gst-launch-1.0 v4l2src ! videoconvert ! autovideosink"');
    }
    return false;
}

export function buildMirrorWidget(ext, container) {
    // This function is now deprecated as mirror is moved to the header icon
    // But we keep the logic inside toggleMirror
}


export function buildClipboardTab(ext, columns) {
    const panel = new St.BoxLayout({ 
        style_class: 'widget-panel clipboard-tab-content', 
        vertical: true, 
        x_expand: true,
        y_expand: true 
    });
    columns.add_child(panel);

    if (ext._clipboardHistory.length === 0) {
        const emptyBox = new St.BoxLayout({ 
            vertical: true, 
            x_expand: true, 
            y_expand: true, 
            style_class: 'empty-drag-box', // Reusing style for consistency
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER
        });
        emptyBox.add_child(new St.Icon({ 
            icon_name: 'edit-copy-symbolic', 
            icon_size: 48,
            style_class: 'empty-drag-icon'
        }));
        emptyBox.add_child(new St.Label({
            text: 'Sua área de transferência está vazia',
            style_class: 'empty-drag-label'
        }));
        panel.add_child(emptyBox);
    } else {
        const scroll = new St.ScrollView({
            style_class: 'drag-scrollview', // Reusing style
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true
        });
        
        scroll.get_vscroll_bar().get_adjustment().connect('notify::value', () => {
            ext._lastScrollTime = GLib.get_monotonic_time();
        });

        const list = new St.BoxLayout({ vertical: true, style_class: 'drag-list', style: 'spacing: 8px;' });
        scroll.set_child(list);
        panel.add_child(scroll);

        ext._clipboardHistory.forEach((text, index) => {
            const item = new St.BoxLayout({ 
                style_class: 'drag-item clipboard-item', 
                reactive: true,
                track_hover: true,
                can_focus: true,
                style: 'padding: 8px; border-radius: 8px;'
            });
            
            const textLabel = new St.Label({ 
                text: text.replace(/\n/g, ' ').substring(0, 100) + (text.length > 100 ? '...' : ''), 
                y_align: Clutter.ActorAlign.CENTER, 
                style_class: 'drag-item-label',
                x_expand: true
            });
            item.add_child(textLabel);
            
            const actions = new St.BoxLayout({ style: 'spacing: 4px;' });
            
            const copyBtn = new St.Button({ 
                child: new St.Icon({ icon_name: 'edit-copy-symbolic', icon_size: 14 }),
                style_class: 'drag-remove-btn', // Reusing style for button look
            });
            copyBtn.connect('clicked', () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                ext._lastClipboardText = text; // Prevent re-adding to history
                // Move to top
                ext._clipboardHistory.splice(index, 1);
                ext._clipboardHistory.unshift(text);
                ext._saveClipboardHistory();
                ext._updateExpandedContent(true);
            });
            actions.add_child(copyBtn);

            const removeBtn = new St.Button({ 
                child: new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 14 }),
                style_class: 'drag-remove-btn',
            });
            removeBtn.connect('clicked', () => {
                ext._clipboardHistory.splice(index, 1);
                ext._saveClipboardHistory();
                ext._updateExpandedContent(true);
            });
            actions.add_child(removeBtn);
            
            item.add_child(actions);
            
            item.connect('button-press-event', () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                ext._lastClipboardText = text;
                ext._clipboardHistory.splice(index, 1);
                ext._clipboardHistory.unshift(text);
                ext._saveClipboardHistory();
                ext._updateExpandedContent(true);
            });
            
            list.add_child(item);
        });

        const clearBtn = new St.Button({
            label: 'Limpar Histórico',
            style_class: 'clear-all-btn',
            x_expand: true
        });
        clearBtn.connect('clicked', () => {
            ext._clipboardHistory = [];
            ext._saveClipboardHistory();
            ext._updateExpandedContent(true);
        });
        panel.add_child(clearBtn);
    }
}

export function buildMediaTab(ext, container) {
    const activePlayer = ext._playerManager.getActivePlayer();
    
    const musicCol = new St.BoxLayout({ vertical: false, style_class: 'widget-panel mpris-panel', x_expand: true, style: 'spacing: 16px;' });
    
    const albumArt = new St.Bin({ 
        style_class: 'mpris-album-art-large',
        x_expand: false,
        y_expand: false
    });
    if (activePlayer && activePlayer.artUrl) {
        const artUrlStr = String(activePlayer.artUrl);
        const escapedUrl = artUrlStr.replace(/"/g, '\\"');
        albumArt.set_style(`background-image: url("${escapedUrl}"); background-size: cover;`);
    }
    musicCol.add_child(albumArt);

    const rightCol = new St.BoxLayout({ vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 8px;' });
    
    const details = new St.BoxLayout({ vertical: true, x_expand: true });
    details.add_child(new St.Label({ 
        text: String(activePlayer?.title || 'No Media Playing'), 
        style_class: 'mpris-title-large',
        style: 'text-overflow: ellipsis;'
    }));
    details.add_child(new St.Label({ 
        text: String(activePlayer?.artist || 'Idle'), 
        style_class: 'mpris-artist-large' 
    }));
    rightCol.add_child(details);

    const controls = new St.BoxLayout({ style_class: 'player-controls-modern', x_align: Clutter.ActorAlign.START });
    
    // Shuffle Button
    const isShuffle = activePlayer?.proxy?.Shuffle;
    const shuffleBtn = new St.Button({ style_class: `control-btn-small ${isShuffle ? 'active' : ''}` });
    shuffleBtn.set_child(new St.Icon({ icon_name: 'media-playlist-shuffle-symbolic', icon_size: 14 }));
    shuffleBtn.connect('clicked', () => {
        if (activePlayer?.proxy) {
            activePlayer.proxy.Shuffle = !activePlayer.proxy.Shuffle;
        }
    });
    controls.add_child(shuffleBtn);

    // Previous Button
    const prevBtn = new St.Button({ style_class: 'control-btn-small' });
    prevBtn.set_child(new St.Icon({ icon_name: 'media-skip-backward-symbolic', icon_size: 16 }));
    prevBtn.connect('clicked', () => activePlayer?.proxy?.PreviousRemote());
    controls.add_child(prevBtn);
    
    // Play/Pause Button
    const isPlaying = activePlayer?.proxy?.PlaybackStatus === 'Playing';
    const playBtn = new St.Button({ style_class: 'control-btn-main' });
    playBtn.set_child(new St.Icon({ 
        icon_name: isPlaying ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic', 
        icon_size: 22 
    }));
    playBtn.connect('clicked', () => activePlayer?.proxy?.PlayPauseRemote());
    controls.add_child(playBtn);
    
    // Next Button
    const nextBtn = new St.Button({ style_class: 'control-btn-small' });
    nextBtn.set_child(new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: 16 }));
    nextBtn.connect('clicked', () => activePlayer?.proxy?.NextRemote());
    controls.add_child(nextBtn);

    // Repeat Button
    const loopStatus = activePlayer?.proxy?.LoopStatus || 'None';
    const repeatBtn = new St.Button({ style_class: `control-btn-small ${loopStatus !== 'None' ? 'active' : ''}` });
    repeatBtn.set_child(new St.Icon({ 
        icon_name: loopStatus === 'Track' ? 'media-playlist-repeat-song-symbolic' : 'media-playlist-repeat-symbolic', 
        icon_size: 14 
    }));
    repeatBtn.connect('clicked', () => {
        if (activePlayer?.proxy) {
            const statuses = ['None', 'Playlist', 'Track'];
            let nextIndex = (statuses.indexOf(loopStatus) + 1) % statuses.length;
            activePlayer.proxy.LoopStatus = statuses[nextIndex];
        }
    });
    controls.add_child(repeatBtn);

    rightCol.add_child(controls);
    musicCol.add_child(rightCol);
    container.add_child(musicCol);
    
    // Calendar Column
    const calCol = new St.BoxLayout({ vertical: true, style_class: 'widget-panel', width: 220, style: 'spacing: 4px;' });
    const calHeader = new St.BoxLayout({ style: 'margin-bottom: 4px;', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    
    const prevMonth = new St.Button({ style_class: 'calendar-nav-btn' });
    prevMonth.set_child(new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 12 }));
    prevMonth.connect('clicked', () => {
        ext._calendarDate = ext._calendarDate.add_months(-1);
        ext._updateExpandedContent(true);
    });
    calHeader.add_child(prevMonth);

    const monthBox = new St.BoxLayout({ vertical: true, x_expand: true });
    monthBox.add_child(new St.Label({ 
        text: ext._calendarDate.format('%B'), 
        style_class: 'cal-month-title',
        x_align: Clutter.ActorAlign.CENTER
    }));
    monthBox.add_child(new St.Label({ 
        text: ext._calendarDate.format('%Y'), 
        opacity: 150, 
        style: 'font-size: 8pt;',
        x_align: Clutter.ActorAlign.CENTER
    }));
    calHeader.add_child(monthBox);

    const nextMonth = new St.Button({ style_class: 'calendar-nav-btn' });
    nextMonth.set_child(new St.Icon({ icon_name: 'go-next-symbolic', icon_size: 12 }));
    nextMonth.connect('clicked', () => {
        ext._calendarDate = ext._calendarDate.add_months(1);
        ext._updateExpandedContent(true);
    });
    calHeader.add_child(nextMonth);
    calCol.add_child(calHeader);

    calCol.add_child(buildCalendarGrid(ext._calendarDate.get_year(), ext._calendarDate.get_month(), 200));
    container.add_child(calCol);
}

export function buildCalendarGrid(year, month, width = 240) {
    const now = GLib.DateTime.new_now_local();
    const currentYear = now.get_year();
    const currentMonth = now.get_month();
    const currentDay = now.get_day_of_month();

    const grid = new St.BoxLayout({ vertical: true, style: 'spacing: 2px;', width: width });
    const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const weekRow = new St.BoxLayout({ x_expand: true });
    weekDays.forEach(day => {
        weekRow.add_child(new St.Label({ 
            text: day, 
            style: `width: ${Math.floor(width/7)}px; text-align: center; font-size: 8pt; opacity: 0.5; color: #ffffff;`
        }));
    });
    grid.add_child(weekRow);

    const dummyDate = GLib.DateTime.new_local(year, month, 1, 0, 0, 0);
    let startDay = dummyDate.get_day_of_week(); 
    if (startDay === 7) startDay = 0; 
    
    const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

    let dayCounter = 1;
    for (let i = 0; i < 6; i++) {
        const row = new St.BoxLayout({ x_expand: true });
        for (let j = 0; j < 7; j++) {
            const dayBox = new St.Bin({ width: Math.floor(width/7), height: 26 });
            if ((i === 0 && j >= startDay) || (i > 0 && dayCounter <= daysInMonth)) {
                if (dayCounter <= daysInMonth) {
                    const isToday = (year === currentYear && month === currentMonth && dayCounter === currentDay);
                    dayBox.set_child(new St.Label({ 
                        text: dayCounter.toString(), 
                        style_class: `cal-day-label ${isToday ? 'active' : ''}`,
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER
                    }));
                    dayCounter++;
                }
            }
            row.add_child(dayBox);
        }
        grid.add_child(row);
        if (dayCounter > daysInMonth) break;
    }
    return grid;
}

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

export function createStatCard(title, iconName, value, history, colorHex) {
    const card = new St.BoxLayout({ 
        vertical: true, 
        style_class: 'stats-card', 
        x_expand: true,
        y_expand: true
    });

    const header = new St.BoxLayout({ style_class: 'stats-card-header' });
    header.add_child(new St.Icon({ 
        icon_name: iconName, 
        icon_size: 14, 
        style: `color: ${colorHex};`
    }));
    header.add_child(new St.Label({ text: title, style_class: 'stats-card-title' }));
    header.add_child(new St.Widget({ x_expand: true }));
    header.add_child(new St.Label({ text: `${value.toFixed(1)}%`, style_class: 'stats-card-value' }));
    card.add_child(header);

    const chart = new St.DrawingArea({ 
        style_class: 'stats-chart',
        x_expand: true,
        y_expand: true
    });

    chart.connect('repaint', (area) => {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        cr.setSourceRGBA(1, 1, 1, 0.05);
        cr.setLineWidth(0.5);
        cr.moveTo(0, h - 5);
        cr.lineTo(w, h - 5);
        cr.stroke();

        if (history.length < 2) return;
        const step = w / (history.length - 1);
        const r = parseInt(colorHex.slice(1, 3), 16) / 255;
        const g = parseInt(colorHex.slice(3, 5), 16) / 255;
        const b = parseInt(colorHex.slice(5, 7), 16) / 255;
        
        cr.setSourceRGBA(r, g, b, 1.0);
        cr.setLineWidth(2.5);
        cr.setLineJoin(Cairo.LineJoin.ROUND);

        for (let i = 0; i < history.length; i++) {
            const val = history[i];
            const x = i * step;
            const y = h - 5 - ((val / 100) * (h - 10));
            if (i === 0) cr.moveTo(x, y);
            else cr.lineTo(x, y);
        }
        cr.stroke();

        cr.setSourceRGBA(r, g, b, 0.1);
        for (let i = 0; i < history.length; i++) {
            const val = history[i];
            const x = i * step;
            const y = h - 5 - ((val / 100) * (h - 10));
            if (i === 0) cr.moveTo(x, y);
            else cr.lineTo(x, y);
        }
        cr.lineTo(w, h - 5);
        cr.lineTo(0, h - 5);
        cr.fill();
    });

    card.add_child(chart);
    return card;
}

export function buildTimeTab(ext, container) {
    const mainCol = new St.BoxLayout({ vertical: true, x_expand: true, style: 'spacing: 16px; padding: 10px;' });
    container.add_child(mainCol);

    // Timer Section
    const timerCol = new St.BoxLayout({ vertical: true, style_class: 'widget-panel', x_expand: true, style: 'padding: 15px; spacing: 10px;' });
    timerCol.add_child(new St.Label({ text: 'Temporizador', style: 'font-size: 14pt; font-weight: bold;' }));
    
    const timerStatus = ext._timerManager._timerActive ? ext._timerManager.timerText : 'Inativo';
    ext._timerLabel = new St.Label({ text: timerStatus, style: 'font-size: 18pt; font-family: monospace;' });
    timerCol.add_child(ext._timerLabel);

    const quickButtons = new St.BoxLayout({ style: 'spacing: 8px;', x_expand: true });
    const addButton = (label, secs) => {
        const btn = new St.Button({ label: label, style_class: 'tab-button action-btn', x_expand: true });
        btn.connect('clicked', () => ext._timerManager.addSeconds(secs));
        quickButtons.add_child(btn);
    };
    addButton('+1h', 3600);
    addButton('+1m', 60);
    addButton('+5s', 5);
    addButton('+1s', 1);
    timerCol.add_child(quickButtons);

    const timerControls = new St.BoxLayout({ style: 'spacing: 8px;', y_align: Clutter.ActorAlign.CENTER });
    
    ext._timerPauseBtn = new St.Button({ 
        label: 'Pausar', 
        style_class: 'tab-button action-btn', 
        x_expand: true,
        visible: ext._timerManager._timerActive
    });
    ext._timerPauseBtn.connect('clicked', () => ext._timerManager.stopTimer());
    timerControls.add_child(ext._timerPauseBtn);

    ext._timerResumeBtn = new St.Button({ 
        label: 'Retomar', 
        style_class: 'tab-button action-btn', 
        x_expand: true,
        visible: !ext._timerManager._timerActive && ext._timerManager._timerSeconds > 0
    });
    ext._timerResumeBtn.connect('clicked', () => ext._timerManager.addSeconds(0));
    timerControls.add_child(ext._timerResumeBtn);

    const stopTimer = new St.Button({ label: 'Parar', style_class: 'tab-button action-btn', x_expand: true });
    stopTimer.connect('clicked', () => ext._timerManager.resetTimer());
    timerControls.add_child(stopTimer);

    timerCol.add_child(timerControls);
    mainCol.add_child(timerCol);

    // Alarm Section
    const alarmCol = new St.BoxLayout({ vertical: true, style_class: 'widget-panel', x_expand: true, style: 'padding: 15px; spacing: 10px;' });
    alarmCol.add_child(new St.Label({ text: 'Alarme', style: 'font-size: 14pt; font-weight: bold;' }));
    
    const alarmStatus = ext._timerManager._alarmActive ? `Ativo para ${ext._timerManager.alarmText}` : 'Inativo';
    ext._alarmStatusLabel = new St.Label({ text: alarmStatus, style: 'font-size: 12pt;' });
    alarmCol.add_child(ext._alarmStatusLabel);

    const alarmInputRow = new St.BoxLayout({ style: 'spacing: 8px;', y_align: Clutter.ActorAlign.CENTER });
    
    const hourEntry = new St.Entry({ hint_text: 'HH', style_class: 'tab-input', can_focus: true });
    const minuteEntry = new St.Entry({ hint_text: 'MM', style_class: 'tab-input', can_focus: true });
    
    alarmInputRow.add_child(hourEntry);
    alarmInputRow.add_child(new St.Label({ text: ':', y_align: Clutter.ActorAlign.CENTER }));
    alarmInputRow.add_child(minuteEntry);

    const setAlarmBtn = new St.Button({ label: 'Definir', style_class: 'tab-button action-btn', x_expand: true });
    setAlarmBtn.connect('clicked', () => {
        const h = parseInt(hourEntry.text);
        const m = parseInt(minuteEntry.text);
        if (!isNaN(h) && !isNaN(m) && h >= 0 && h < 24 && m >= 0 && m < 60) {
            ext._timerManager.setAlarm(h, m);
            hourEntry.text = '';
            minuteEntry.text = '';
        }
    });
    alarmInputRow.add_child(setAlarmBtn);

    const stopAlarm = new St.Button({ label: 'Desativar', style_class: 'tab-button action-btn', x_expand: true });
    stopAlarm.connect('clicked', () => ext._timerManager.stopAlarm());
    alarmInputRow.add_child(stopAlarm);

    alarmCol.add_child(alarmInputRow);
    mainCol.add_child(alarmCol);

    // Current Time (Large)
    const clockCol = new St.BoxLayout({ vertical: true, style_class: 'widget-panel', x_expand: true, style: 'padding: 15px; spacing: 5px;', x_align: Clutter.ActorAlign.CENTER });
    const now = GLib.DateTime.new_now_local();
    ext._bigClockLabel = new St.Label({ text: now.format('%H:%M:%S'), style: 'font-size: 24pt; font-weight: bold; font-family: monospace;' });
    clockCol.add_child(ext._bigClockLabel);
    clockCol.add_child(new St.Label({ text: now.format('%A, %d de %B'), style: 'opacity: 0.7; font-size: 10pt;' }));
    mainCol.add_child(clockCol);
}
