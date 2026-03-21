import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import { getBatteryIcon } from './utils.js';
import * as Tabs from './tabs.js';

export class Dock {
    constructor(extension, monitor) {
        this.extension = extension;
        this._monitor = monitor;
        this._settings = extension._settings;

        this._activeTab = 'system';
        this._isExpanded = false;
        this._isRebuilding = false;
        this._expandTimeoutId = null;
        this._osdTimeoutId = null;
        this._waveformTimerId = null;
        this._miniVisibilityTimerId = null;
        this._timeTabTimerId = null;
        this._playerVisibilityExpired = false;
        this._lastTrack = '';
        this._calendarDate = GLib.DateTime.new_now_local();
        this._lastScrollTime = 0;
        this._lastClickTime = 0;

        // Properties needed by Tabs.js
        this._volLabel = null;
        this._volSlider = null;
        this._mirrorVideoBin = null;
        this._batteryIcon = null;
        this._batteryLabel = null;
        this._headerClockLabel = null;
        this._headerClockTimeoutId = null;
        this._headerIndicators = null;
        this._scrollView = null;
        this._columns = null;
        this._atollHeader = null;
        this._tabButtons = {};

        this._buildUI();
    }

    // Accessors for shared managers (used by Tabs.js via the dock instance)
    get _systemInfo() { return this.extension._systemInfo; }
    get _statsManager() { return this.extension._statsManager; }
    get _playerManager() { return this.extension._playerManager; }
    get _timerManager() { return this.extension._timerManager; }
    get _volumeControl() { return this.extension._volumeControl; }
    get _sink() { return this.extension._sink; }
    get _source() { return this.extension._volumeControl?.get_default_source(); }
    get _clipboardHistory() { return this.extension._clipboardHistory; }
    set _clipboardHistory(val) { this.extension._clipboardHistory = val; }
    get _lastClipboardText() { return this.extension._lastClipboardText; }
    set _lastClipboardText(val) { this.extension._lastClipboardText = val; }
    _saveClipboardHistory() { this.extension._saveClipboardHistory(); }

    _buildUI() {
        this._container = new St.Bin({
            name: 'docktouch-container',
            reactive: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            clip_to_allocation: false,
        });
        this._container._delegate = this;

        this._container.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            if (this._isExpanded) return Clutter.EVENT_PROPAGATE;

            const currentTime = event.get_time();
            const doubleClickTime = Clutter.Settings.get_default().double_click_time || 400;
            const diff = currentTime - this._lastClickTime;

            if (diff > 0 && diff < doubleClickTime) {
                // Double-click: Toggle show_desktop
                if (this._expandTimeoutId) {
                    GLib.source_remove(this._expandTimeoutId);
                    this._expandTimeoutId = null;
                }

                try {
                    const workspaceManager = global.workspace_manager || global.display.get_workspace_manager();
                    const activeWorkspace = workspaceManager.get_active_workspace();
                    const windows = global.get_window_actors()
                        .map(a => a.meta_window)
                        .filter(w => w && w.get_workspace() === activeWorkspace);

                    const ignorableTypes = [Meta.WindowType.DESKTOP, Meta.WindowType.DOCK];
                    const targetWindows = windows.filter(w => !ignorableTypes.includes(w.get_window_type()));

                    const hasUnminimized = targetWindows.some(w => !w.minimized);

                    if (hasUnminimized) {
                        targetWindows.forEach(w => w.minimize());
                    } else {
                        targetWindows.forEach(w => w.unminimize());
                    }
                } catch (e) {
                    console.error(`[DockTouch] Error toggling show_desktop: ${e}`);
                }

                this._lastClickTime = 0;
                return Clutter.EVENT_STOP;
            }

            this._lastClickTime = currentTime;

            // First click: Start timeout for single-click expansion
            if (this._expandTimeoutId) {
                GLib.source_remove(this._expandTimeoutId);
                this._expandTimeoutId = null;
            }

            this._expandTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, doubleClickTime, () => {
                this._expand();
                this._expandTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });

            return Clutter.EVENT_STOP;
        });

        this._blurEffect = new Shell.BlurEffect({ brightness: 0.6, mode: Shell.BlurMode.BACKGROUND });
        this._container.add_effect(this._blurEffect);

        this._mainLayout = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true, reactive: true, clip_to_allocation: false });
        this._container.set_child(this._mainLayout);

        // COLLAPSED HEADER
        this._header = new St.BoxLayout({
            style_class: 'docktouch-header',
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
            height: 38,
            clip_to_allocation: false,
            reactive: true,
        });
        this._mainLayout.add_child(this._header);

        this._miniContent = new St.BoxLayout({ style_class: 'mini-content', x_expand: true, clip_to_allocation: false });
        this._header.add_child(this._miniContent);

        this._miniIconContainer = new St.Bin({
            style_class: 'mini-player-icon-container',
            y_align: Clutter.ActorAlign.CENTER,
            width: 22, height: 22,
            clip_to_allocation: false,
        });
        this._desaturateEffect = new Clutter.DesaturateEffect({ enabled: false });
        this._miniIconContainer.add_effect(this._desaturateEffect);
        this._miniIcon = new St.Icon({ icon_name: 'audio-x-generic-symbolic', style_class: 'app-icon-label', icon_size: 16 });
        this._miniIconContainer.set_child(this._miniIcon);
        this._miniContent.add_child(this._miniIconContainer);

        this._miniContent.add_child(new St.Widget({ x_expand: true }));

        this._waveform = new St.BoxLayout({ style_class: 'waveform-container', y_align: Clutter.ActorAlign.CENTER });
        this._waveformBars = [];
        [6, 14, 8, 12].forEach(h => {
            const bar = new St.Widget({ style_class: 'waveform-bar', height: h });
            this._waveformBars.push(bar);
            this._waveform.add_child(bar);
        });
        this._miniContent.add_child(this._waveform);

        // Right-side indicators
        this._miniMicIcon = new St.Icon({
            icon_name: 'microphone-sensitivity-medium-symbolic',
            style_class: 'mini-mic-icon',
            visible: false,
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._miniContent.add_child(this._miniMicIcon);

        this._miniCameraIcon = new St.Icon({
            icon_name: 'camera-web-symbolic',
            style_class: 'mini-camera-icon',
            visible: false,
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._miniContent.add_child(this._miniCameraIcon);

        this._miniScreenIcon = new St.Icon({
            icon_name: 'screen-shared-symbolic',
            style_class: 'mini-screen-icon',
            visible: false,
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._miniContent.add_child(this._miniScreenIcon);

        this._miniCapsLockIcon = new St.Icon({
            icon_name: 'keyboard-caps-lock-symbolic',
            style_class: 'mini-caps-icon',
            visible: false,
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._miniContent.add_child(this._miniCapsLockIcon);

        // Timer Elements in Mini Content
        this._miniTimerIcon = new St.Icon({
            icon_name: 'appointment-soon-symbolic',
            style_class: 'mini-timer-icon',
            visible: false,
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._miniContent.add_child(this._miniTimerIcon);

        this._miniTimerLabel = new St.Label({
            style_class: 'mini-timer-label',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._miniContent.add_child(this._miniTimerLabel);

        this._miniLockIcon = new St.Icon({
            icon_name: 'system-lock-screen-symbolic',
            style_class: 'mini-lock-icon',
            visible: false,
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._miniContent.add_child(this._miniLockIcon);

        this._miniTimeLabel = new St.Label({
            style_class: 'mini-time-label',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._miniContent.add_child(this._miniTimeLabel);

        // OSD CONTENT
        this._osdContent = new St.BoxLayout({ style_class: 'osd-content', visible: false, x_expand: true });
        this._header.add_child(this._osdContent);

        this._osdIcon = new St.Icon({ style_class: 'osd-icon', y_align: Clutter.ActorAlign.CENTER });
        this._osdContent.add_child(this._osdIcon);

        this._osdSpacer = new St.Widget({ x_expand: true });
        this._osdContent.add_child(this._osdSpacer);

        this._osdProgressContainer = new St.Bin({
            style_class: 'osd-progress-container',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.START
        });
        this._osdProgressBar = new St.Widget({ style_class: 'osd-progress-bar', width: 0 });
        this._osdProgressContainer.set_child(this._osdProgressBar);
        this._osdContent.add_child(this._osdProgressContainer);

        this._osdValueLabel = new St.Label({ style_class: 'osd-value-label', y_align: Clutter.ActorAlign.CENTER });
        this._osdContent.add_child(this._osdValueLabel);

        this._osdSecondaryIcon = new St.Icon({ style_class: 'osd-icon', y_align: Clutter.ActorAlign.CENTER, visible: false });
        this._osdContent.add_child(this._osdSecondaryIcon);

        // EXPANDED CONTENT
        this._content = new St.BoxLayout({ vertical: true, style_class: 'docktouch-content', opacity: 0, visible: false, x_expand: true, clip_to_allocation: false });
        this._mainLayout.add_child(this._content);

        this._container.connect('enter-event', () => {
            if (!this._isExpanded) {
                if (this._expandTimeoutId) GLib.source_remove(this._expandTimeoutId);

                const hoverExpand = this._settings.get_boolean('hover-expand');
                if (!hoverExpand) return;

                const delay = this._settings.get_double('hover-delay') * 1000;
                this._expandTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    this._expandTimeoutId = null;
                    if (this._container.hover) this._expand();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });

        this._container.connect('leave-event', () => {
            if (this._expandTimeoutId) {
                GLib.source_remove(this._expandTimeoutId);
                this._expandTimeoutId = null;
            }
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                if (!this._container.hover && this._isExpanded && !this._isRebuilding) this._collapse();
                return GLib.SOURCE_REMOVE;
            });
        });

        this._updateLayout();
        this._updateMiniPlayerVisibility();
        Main.layoutManager.addTopChrome(this._container);
        this._container.connect('notify::width', () => this._updatePosition());
    }

    _updatePosition() {
        const monitor = this._monitor;
        const islandMode = this._settings.get_string('island-mode');
        let y = monitor.y;

        if (islandMode === 'standard') {
            if (!this._isExpanded) y -= 1.5;
        } else {
            if (!this._isExpanded) y += 4;
        }

        const x = monitor.x + Math.floor((monitor.width - this._container.width) / 2);
        this._container.set_position(x, y);
    }

    _getAverageColor(url) {
        if (!url) return null;
        try {
            let filePath = url;
            if (url.startsWith('file://')) {
                const [path] = GLib.filename_from_uri(url);
                filePath = path;
            } else if (!url.startsWith('/')) {
                return null;
            }

            if (!GLib.file_test(filePath, GLib.FileTest.EXISTS)) return null;

            const pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(filePath, 1, 1, true);
            const pixels = pb.get_pixels();
            return `rgb(${pixels[0]}, ${pixels[1]}, ${pixels[2]})`;
        } catch (e) {
            return null;
        }
    }

    _updateMiniPlayerVisibility() {
        if (!this._miniContent || this._osdTimeoutId) return;
        if (this._osdContent?.visible && Main.sessionMode.isLocked) return;

        const player = this._playerManager.getActivePlayer();
        const playbackStatus = player?.proxy?.PlaybackStatus;
        const isPlaying = playbackStatus === 'Playing';
        const isPaused = playbackStatus === 'Paused';
        const isCaps = this.extension._isCapsLockActive;
        const isMic = this.extension._isMicActive;
        const isCamera = this.extension._isCameraActive;
        const isScreen = this.extension._isScreenActive;
        const timerActive = this._timerManager.isActive;
        const isLocked = Main.sessionMode.isLocked;

        const currentTrack = player ? `${player.title}-${player.artist}` : "";
        if (currentTrack !== this._lastTrack || isPlaying) {
            this._playerVisibilityExpired = false;
            this._lastTrack = currentTrack;
        }

        // Reset visibility of all special elements
        this._waveform.visible = false;
        this._miniCapsLockIcon.visible = false;
        this._miniMicIcon.visible = false;
        this._miniCameraIcon.visible = false;
        this._miniScreenIcon.visible = false;
        this._miniTimerIcon.visible = false;
        this._miniTimerLabel.visible = false;
        this._miniLockIcon.visible = false;
        this._miniTimeLabel.visible = false;
        this._miniIconContainer.visible = false;
        this._miniIcon.remove_style_class_name('blink');

        if (isPlaying || (isPaused && !this._playerVisibilityExpired) || isMic || isCamera || isScreen || isCaps || timerActive || isLocked) {
            this._miniContent.visible = true;

            if (isLocked) {
                this._miniIconContainer.visible = true;
                this._miniIconContainer.set_style('');
                this._miniIcon.visible = true;
                this._miniIcon.icon_name = 'system-lock-screen-symbolic';
                this._miniIcon.set_style('color: white;');

                this._miniTimeLabel.visible = true;
                this._miniTimeLabel.set_style('color: white;');
                const now = GLib.DateTime.new_now_local();
                const timeStr = now.format('%H:%M');
                if (timerActive) {
                    const timerText = this._timerManager.currentText;
                    this._miniTimeLabel.text = `${timerText} | ${timeStr}`;
                    if (this._timerManager._isRinging) {
                        this._miniTimeLabel.add_style_class_name('blink');
                        this._miniIcon.add_style_class_name('blink');
                    }
                } else {
                    this._miniTimeLabel.text = timeStr;
                }
                return;
            }

            // --- Dynamic Content Logic ---
            const isMediaActive = isPlaying || (isPaused && !this._playerVisibilityExpired);
            let color = isMediaActive && player && player.artUrl ? (this._getAverageColor(player.artUrl) || 'white') : 'white';
            let waveColor = isPaused ? 'rgba(150, 150, 150, 0.7)' : color;

            // 1. Left Side (Priority: Media > Mic > Camera > Screen > Caps > Timer)
            this._miniIconContainer.visible = true;
            let leftType = 'none';
            if (isMediaActive) {
                leftType = 'media';
                if (player && player.artUrl) {
                    const escapedUrl = player.artUrl.replace(/"/g, '\\"');
                    this._miniIconContainer.set_style(`background-image: url("${escapedUrl}"); background-size: cover; border-radius: 6px;`);
                    this._miniIcon.visible = false;

                    // Use DesaturateEffect for grayscale when paused
                    this._desaturateEffect.factor = isPaused ? 1.0 : 0.0;
                    this._desaturateEffect.enabled = isPaused;
                    if (isPaused) {
                        this._miniIconContainer.set_style(`background-image: url("${escapedUrl}"); background-size: cover; border-radius: 6px; opacity: 0.7;`);
                    }
                } else {
                    this._miniIconContainer.set_style('');
                    this._miniIcon.visible = true;
                    this._miniIcon.icon_name = 'audio-x-generic-symbolic';
                    this._miniIcon.set_style(`color: ${waveColor};`);
                    this._desaturateEffect.enabled = false;
                }
            } else {
                this._miniIconContainer.set_style('');
                this._miniIcon.visible = true;
                this._miniIcon.set_style(`color: ${color};`);
                this._desaturateEffect.enabled = false;

                if (isMic) {
                    leftType = 'mic';
                    this._miniIcon.icon_name = this.extension._isMicMuted ? 'microphone-sensitivity-muted-symbolic' : 'microphone-sensitivity-medium-symbolic';
                } else if (isCamera) {
                    leftType = 'camera';
                    this._miniIcon.icon_name = 'camera-web-symbolic';
                } else if (isScreen) {
                    leftType = 'screen';
                    this._miniIcon.icon_name = this.extension._isScreenRecording ? 'media-record-symbolic' : 'screen-shared-symbolic';
                } else if (isCaps) {
                    leftType = 'caps';
                    this._miniIcon.icon_name = 'keyboard-caps-lock-symbolic';
                } else if (timerActive) {
                    leftType = 'timer';
                    this._miniIcon.icon_name = 'appointment-soon-symbolic';
                    if (this._timerManager._isRinging) this._miniIcon.add_style_class_name('blink');
                } else {
                    this._miniIcon.icon_name = 'audio-x-generic-symbolic';
                    if (isPaused) this._miniIcon.set_style('color: rgba(255, 255, 255, 0.4);');
                }
            }

            // 2. Right Side Items (Max 4 total icons, so 3 if media is on left)
            let rightItems = [];

            // Add status icons first (they replace the waveform)
            if (isMic && leftType !== 'mic') rightItems.push('mic');
            if (isCamera && leftType !== 'camera') rightItems.push('camera');
            if (isCaps && leftType !== 'caps') rightItems.push('caps');
            if (timerActive) rightItems.push('timer');
            if (isScreen && leftType !== 'screen') rightItems.push('screen');

            // Only add waveform if media is active AND no status icons are showing on the right
            if (isMediaActive && rightItems.length === 0) {
                rightItems.push('waveform');
            }

            // Limit to max 4 icons total (1 left + 3 right if media, or up to 4 right if no left icon but left icon is usually always there)
            const maxRight = (leftType !== 'none') ? 3 : 4;
            rightItems = rightItems.slice(0, maxRight);

            rightItems.forEach(item => {
                if (item === 'waveform') {
                    this._waveform.visible = true;
                    this._waveformBars.forEach(bar => bar.set_style(`background-color: ${waveColor};`));

                    if (isPlaying) {
                        if (!this._waveformTimerId) {
                            this._waveformTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                                if (this._waveformBars?.length > 0) {
                                    this._waveformBars.forEach(bar => bar.set_height(4 + Math.random() * 12));
                                    return GLib.SOURCE_CONTINUE;
                                }
                                this._waveformTimerId = null;
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    } else if (isPaused) {
                        if (this._waveformTimerId) {
                            GLib.source_remove(this._waveformTimerId);
                            this._waveformTimerId = null;
                        }
                        this._waveformBars.forEach(bar => bar.set_height(4));
                    }
                } else if (item === 'mic') {
                    this._miniMicIcon.visible = true;
                    this._miniMicIcon.icon_name = this.extension._isMicMuted ? 'microphone-sensitivity-muted-symbolic' : 'microphone-sensitivity-medium-symbolic';
                    this._miniMicIcon.set_style(`color: ${waveColor};`);
                } else if (item === 'camera') {
                    this._miniCameraIcon.visible = true;
                    this._miniCameraIcon.icon_name = 'camera-web-symbolic';
                    this._miniCameraIcon.set_style(`color: ${waveColor};`);
                } else if (item === 'screen') {
                    this._miniScreenIcon.visible = true;
                    this._miniScreenIcon.icon_name = this.extension._isScreenRecording ? 'media-record-symbolic' : 'screen-shared-symbolic';
                    this._miniScreenIcon.set_style(`color: ${waveColor};`);
                } else if (item === 'caps') {
                    this._miniCapsLockIcon.visible = true;
                    this._miniCapsLockIcon.set_style(`color: ${waveColor};`);
                } else if (item === 'timer') {
                    this._miniTimerIcon.visible = (leftType !== 'timer');
                    this._miniTimerLabel.visible = true;
                    this._miniTimerLabel.text = this._timerManager.currentText;
                    this._miniTimerIcon.set_style(`color: ${waveColor};`);
                    this._miniTimerLabel.set_style(`color: ${waveColor};`);
                    if (this._timerManager._isRinging) {
                        this._miniTimerIcon.add_style_class_name('blink');
                        this._miniTimerLabel.add_style_class_name('blink');
                    }
                }
            });

            if (!rightItems.includes('waveform') && this._waveformTimerId) {
                GLib.source_remove(this._waveformTimerId);
                this._waveformTimerId = null;
            }

            // Maintenance timers
            if (isPaused && !this._miniVisibilityTimerId) {
                this._miniVisibilityTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20000, () => {
                    this._miniVisibilityTimerId = null;
                    this._playerVisibilityExpired = true;
                    this._updateMiniPlayerVisibility();
                    return GLib.SOURCE_REMOVE;
                });
            } else if (isPlaying && this._miniVisibilityTimerId) {
                GLib.source_remove(this._miniVisibilityTimerId);
                this._miniVisibilityTimerId = null;
            }

        } else {
            this._miniContent.visible = false;
            if (this._miniVisibilityTimerId) {
                GLib.source_remove(this._miniVisibilityTimerId);
                this._miniVisibilityTimerId = null;
            }
            if (this._waveformTimerId) {
                GLib.source_remove(this._waveformTimerId);
                this._waveformTimerId = null;
            }
            if ((this.extension._isCapsLockActive || this.extension._isMicActive || this.extension._isCameraActive) && !Main.sessionMode.isLocked) {
                let type = 'caps';
                if (this.extension._isMicActive) type = 'mic';
                else if (this.extension._isCameraActive) type = 'camera';
                this._showOSD(type, 100);
            }
        }
    }

    _updateTimerUI() {
        this._updateMiniPlayerVisibility();

        if (this._timeTabTimerId) {
            GLib.source_remove(this._timeTabTimerId);
            this._timeTabTimerId = null;
        }

        if (this._isExpanded && this._activeTab === 'time') {
            if (this._timerLabel) {
                if (this._timerManager._timerRinging) {
                    this._timerLabel.text = '0:00';
                    this._timerLabel.set_style('color: #FF453A; font-weight: bold;');
                    this._timerLabel.add_style_class_name('blink');
                } else {
                    this._timerLabel.text = this._timerManager._timerActive ? this._timerManager.timerText : (this._timerManager._timerSeconds > 0 ? `${this._timerManager.timerText} (Pausado)` : 'Inativo');
                    this._timerLabel.set_style('');
                    this._timerLabel.remove_style_class_name('blink');
                }
            }
            if (this._timerPauseBtn) {
                this._timerPauseBtn.visible = this._timerManager._timerActive;
            }
            if (this._timerResumeBtn) {
                this._timerResumeBtn.visible = !this._timerManager._timerActive && this._timerManager._timerSeconds > 0;
            }
            if (this._alarmStatusLabel) {
                if (this._timerManager._alarmRinging) {
                    this._alarmStatusLabel.text = `${this._timerManager.alarmText} - HORÁRIO ATINGIDO!`;
                    this._alarmStatusLabel.set_style('color: #FF453A; font-weight: bold;');
                    this._alarmStatusLabel.add_style_class_name('blink');
                    if (this._stopAlarmBtn) this._stopAlarmBtn.label = 'Parar';
                } else {
                    this._alarmStatusLabel.text = this._timerManager._alarmActive ? `Ativo para ${this._timerManager.alarmText}` : 'Inativo';
                    this._alarmStatusLabel.set_style('');
                    this._alarmStatusLabel.remove_style_class_name('blink');
                    if (this._stopAlarmBtn) this._stopAlarmBtn.label = 'Desativar';
                }
            }
            if (this._bigClockLabel) {
                const now = GLib.DateTime.new_now_local();
                this._bigClockLabel.text = now.format('%H:%M:%S');
            }

            // Schedule next update only if still expanded on time tab
            this._timeTabTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                this._updateTimerUI();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _showOSD(type, value) {
        if (this._isExpanded && type !== 'lock') return;

        if (this._isExpanded && type === 'lock') {
            this._isExpanded = false;
            this._content.visible = false;
            this._content.opacity = 0;
            this._header.visible = true;
            this._header.opacity = 255;
            this._updatePillStyle();
            this._updateLayout();
        }

        const numericValue = typeof value === 'number' ? value : parseFloat(value);
        if (isNaN(numericValue)) return;

        const isVolume = type === 'volume';
        const isBrightness = type === 'brightness';
        const isCaps = type === 'caps';
        const isMic = type === 'mic';
        const isCamera = type === 'camera';
        const isScreen = type === 'screen';
        const isBattery = type === 'battery';
        const isLock = type === 'lock';

        if (this._osdTimeoutId) {
            GLib.source_remove(this._osdTimeoutId);
            this._osdTimeoutId = null;
        }

        const normalWidth = this._settings.get_int('normal-width');

        // Se for Caps Lock, Mic, Camera, Screen ou Lock e estiver desativado, ocultar se estiver mostrando e não houver outro OSD ativo
        if ((isCaps || isMic || isCamera || isScreen || isLock) && numericValue === 0) {
            if (Main.sessionMode.isLocked && isCaps) {
                this._showOSD('lock', 100);
                return;
            }
            this._osdContent.visible = false;
            this._updateMiniPlayerVisibility();
            this._container.ease({
                width: normalWidth,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUART
            });
            return;
        }

        // Se for Caps Lock, Mic, Camera ou Screen, mostrar no mini player em vez do OSD completo
        if ((isCaps || isMic || isCamera || isScreen) && !Main.sessionMode.isLocked) {
            this._osdContent.visible = false;
            this._updateMiniPlayerVisibility();
            this._container.ease({
                width: normalWidth,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUART
            });
            return;
        }

        let micIcon = this.extension._isMicMuted ? 'microphone-sensitivity-muted-symbolic' : 'microphone-sensitivity-medium-symbolic';

        let iconName = isVolume ? 'audio-volume-high-symbolic' :
            (isBrightness ? 'display-brightness-high-symbolic' :
                (isBattery ? getBatteryIcon(this._statsManager.batteryPercentage, this._statsManager.isCharging) :
                    (isLock ? 'system-lock-screen-symbolic' :
                        (isMic ? micIcon :
                            (isCamera ? 'camera-web-symbolic' :
                                (isScreen ? (this.extension._isScreenRecording ? 'media-record-symbolic' : 'screen-shared-symbolic') : 'keyboard-caps-lock-symbolic'))))));
        let valueText = `${Math.round(numericValue)}${isBattery || isBrightness ? '%' : ''}`;

        if (isVolume) {
            const isMuted = this._sink?.is_muted;
            if (isMuted) {
                iconName = 'audio-volume-muted-symbolic';
                valueText = 'MUTE';
                value = 0;
            } else if (numericValue === 0) {
                iconName = 'audio-volume-muted-symbolic';
            } else if (numericValue < 33) {
                iconName = 'audio-volume-low-symbolic';
            } else if (numericValue < 66) {
                iconName = 'audio-volume-medium-symbolic';
            }
        } else if (isBrightness) {
            if (numericValue < 33) {
                iconName = 'display-brightness-low-symbolic';
            } else if (numericValue < 66) {
                iconName = 'display-brightness-medium-symbolic';
            } else {
                iconName = 'display-brightness-high-symbolic';
            }
        } else if (isCaps || isMic || isCamera || isScreen || isLock) {
            valueText = '';
            if (isCaps) iconName = 'keyboard-caps-lock-symbolic';
            else if (isMic) iconName = micIcon;
            else if (isCamera) iconName = 'camera-web-symbolic';
            else if (isScreen) iconName = this.extension._isScreenRecording ? 'media-record-symbolic' : 'screen-shared-symbolic';
            else iconName = 'system-lock-screen-symbolic';
        }

        // Visibilidade conforme o tipo (Caps Lock, Mic, Camera, Screen e Lock ocultam tudo exceto o ícone)
        const isPillOnly = isCaps || isMic || isCamera || isScreen || isLock;
        const isBothCapsAndMic = this.extension._isCapsLockActive && this.extension._isMicActive && !Main.sessionMode.isLocked;

        if (isBothCapsAndMic && isPillOnly && !isScreen && !isCamera) {
            this._osdIcon.icon_name = 'keyboard-caps-lock-symbolic';
            this._osdSecondaryIcon.icon_name = micIcon;
            this._osdSecondaryIcon.visible = true;
            this._osdSpacer.visible = true;
            this._osdProgressContainer.visible = false;
            this._osdValueLabel.visible = false;
        } else {
            this._osdIcon.icon_name = iconName;
            this._osdSecondaryIcon.visible = false;
            this._osdSpacer.visible = !isPillOnly;
            this._osdProgressContainer.visible = !isPillOnly;
            this._osdValueLabel.visible = !isPillOnly;
        }

        this._osdProgressBar.set_style_class_name(`osd-progress-bar ${isVolume ? '' : (isBrightness ? 'brightness' : (isBattery ? 'battery' : (isCaps ? 'caps' : (isMic ? 'mic' : (isScreen ? 'screen' : 'lock')))))}`);

        const percent = Math.min(100, Math.max(0, numericValue));
        this._osdProgressBar.set_width((percent / 100) * 100);
        this._osdValueLabel.text = valueText;

        // Alinhado à esquerda
        this._osdIcon.x_expand = false;
        this._osdIcon.x_align = Clutter.ActorAlign.START;

        this._miniContent.visible = false;
        this._osdContent.visible = true;

        // Expand pill for OSD
        const osdWidth = isPillOnly ? normalWidth : (isBattery ? normalWidth : 220);
        this._container.ease({
            width: osdWidth,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUART
        });

        // Só coloca timeout se NÃO for Caps Lock, Mic, Camera ou Lock
        if (!isPillOnly) {
            this._osdTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                this._osdTimeoutId = null;
                if (this.extension._isMicActive) {
                    this._showOSD('mic', 100);
                } else if (this.extension._isCameraActive) {
                    this._showOSD('camera', 100);
                } else if (this.extension._isCapsLockActive) {
                    // Se o Caps Lock ainda estiver ativo, volta para ele
                    this._showOSD('caps', 100);
                } else if (Main.sessionMode.isLocked) {
                    // Se estiver bloqueado, volta para o cadeado
                    this._showOSD('lock', 100);
                } else {
                    this._osdContent.visible = false;
                    this._updateMiniPlayerVisibility();
                    this._container.ease({
                        width: normalWidth,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_OUT_QUART
                    });
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _updatePillStyle() {
        const islandMode = this._settings.get_string('island-mode');
        const themeColor = this._settings.get_string('theme-color');
        const pillOpacity = this._settings.get_int('pill-opacity');
        const marginTop = islandMode === 'standard' ? 0 : 5;
        const borderRadius = islandMode === 'standard' ? '0 0 24px 24px' : '44px';

        let rgbaColor = themeColor;
        if (themeColor.startsWith('#')) {
            const r = parseInt(themeColor.slice(1, 3), 16), g = parseInt(themeColor.slice(3, 5), 16), b = parseInt(themeColor.slice(5, 7), 16);
            rgbaColor = `rgba(${r}, ${g}, ${b}, ${pillOpacity / 255})`;
        }

        this._container.remove_style_class_name('shadow-expanded');
        this._container.remove_style_class_name('shadow-collapsed');

        if (this._isExpanded) {
            this._container.add_style_class_name('shadow-expanded');
        } else if (islandMode !== 'standard') {
            this._container.add_style_class_name('shadow-collapsed');
        }

        this._container.set_style(`padding-top: ${marginTop}px; border-radius: ${borderRadius}; background-color: ${rgbaColor} !important; border: 1px solid rgba(255, 255, 255, 0.1);`);
        this._container.queue_relayout();
        if (global.stage) global.stage.queue_redraw();
    }

    _updateLayout() {
        const islandMode = this._settings.get_string('island-mode');
        const blurSigma = this._settings.get_int('blur-sigma');
        this._updatePillStyle();
        if (this._blurEffect) this._blurEffect.sigma = blurSigma;

        const marginTop = islandMode === 'standard' ? 0 : 5;
        const width = this._isExpanded ? this._settings.get_int('expanded-width') : this._settings.get_int('normal-width');
        const height = this._isExpanded ? this._settings.get_int('expanded-height') : 38;

        this._container.set_size(width, height + marginTop);
        this._updatePosition();
    }

    _expand() {
        if (Main.sessionMode.isLocked) return;

        if (this._osdTimeoutId) {
            GLib.source_remove(this._osdTimeoutId);
            this._osdTimeoutId = null;
        }
        this._osdContent.visible = false;

        this._isExpanded = true;
        this._content.visible = true;
        this._updateExpandedContent(true);
        this._updatePillStyle();

        const islandMode = this._settings.get_string('island-mode');
        const marginTop = islandMode === 'standard' ? 0 : 5;

        this._container.ease({
            width: this._settings.get_int('expanded-width'),
            height: this._settings.get_int('expanded-height') + marginTop,
            duration: 400, mode: Clutter.AnimationMode.EASE_OUT_QUART,
        });
        this._content.ease({ opacity: 255, duration: 250 });
        this._header.ease({ opacity: 0, duration: 150, onComplete: () => (this._header.visible = false) });
    }

    _collapse() {
        this._isExpanded = false;
        this._header.visible = true;
        this._updatePillStyle();

        const islandMode = this._settings.get_string('island-mode');
        const marginTop = islandMode === 'standard' ? 0 : 5;
        const targetWidth = this._settings.get_int('normal-width');

        this._container.ease({
            width: targetWidth,
            height: 38 + marginTop,
            duration: 400, mode: Clutter.AnimationMode.EASE_OUT_QUART,
            onComplete: () => {
                this._content.visible = false;
                if (this.extension._isCapsLockActive) {
                    this._showOSD('caps', 100);
                } else {
                    this._updateMiniPlayerVisibility();
                }
                this._updatePillStyle();
                this._updatePosition();
            }
        });
        this._content.ease({ opacity: 0, duration: 150 });
        this._header.ease({ opacity: 255, duration: 250 });
    }

    _updateHeaderIndicators() {
        if (!this._atollHeader) return;

        if (this._headerClockTimeoutId) {
            GLib.source_remove(this._headerClockTimeoutId);
            this._headerClockTimeoutId = null;
        }

        if (this._headerIndicators) {
            this._headerIndicators.destroy();
            this._headerIndicators = null;
        }

        this._headerIndicators = new St.BoxLayout({
            style_class: 'system-indicators',
            style: 'spacing: 12px;',
            y_align: Clutter.ActorAlign.CENTER
        });

        const mirrorBtn = new St.Button({
            child: new St.Icon({ icon_name: 'camera-web-symbolic', icon_size: 16 }),
            style_class: 'tab-button mirror-header-btn',
            y_align: Clutter.ActorAlign.CENTER
        });
        mirrorBtn.connect('clicked', () => {
            Tabs.toggleMirror(this, this._mirrorVideoBin, null, mirrorBtn.child);
        });
        this._headerIndicators.add_child(mirrorBtn);

        if (this.extension._isScreenActive) {
            const stopSharingBtn = new St.Button({
                child: new St.Icon({
                    icon_name: this.extension._isScreenRecording ? 'media-record-symbolic' : 'screen-shared-symbolic',
                    icon_size: 16
                }),
                style_class: 'tab-button',
                y_align: Clutter.ActorAlign.CENTER,
                reactive: true,
                can_focus: true,
                style: 'color: #ff3b30; margin-left: 4px;'
            });
            stopSharingBtn.connect('clicked', () => {
                // 1. Try to stop any RemoteAccess sessions (Google Meet, Discord, etc.)
                try {
                    // Try Main.remoteAccess (standard)
                    if (Main.remoteAccess) {
                        if (typeof Main.remoteAccess.get_sessions === 'function') {
                            const sessions = Main.remoteAccess.get_sessions();
                            if (sessions && sessions.length > 0) {
                                sessions.forEach(s => { if (s && s.stop) s.stop(); });
                            }
                        } else if (typeof Main.remoteAccess.stop === 'function') {
                            Main.remoteAccess.stop();
                        }
                    }

                    // Try Main.remoteAccessManager (newer GNOME)
                    if (Main.remoteAccessManager) {
                        if (typeof Main.remoteAccessManager.get_sessions === 'function') {
                            const sessions = Main.remoteAccessManager.get_sessions();
                            if (sessions && sessions.length > 0) {
                                sessions.forEach(s => { if (s && s.stop) s.stop(); });
                            }
                        } else if (typeof Main.remoteAccessManager.stop === 'function') {
                            Main.remoteAccessManager.stop();
                        }
                    }
                } catch (e) {
                    console.error("Docktouch: Error stopping remote access sessions: " + e);
                }

                // 2. Try the built-in GNOME screen recorder
                try {
                    if (Main.screenshotUI && typeof Main.screenshotUI.stopRecording === 'function') {
                        Main.screenshotUI.stopRecording();
                    } else if (Main.screenRecorder && typeof Main.screenRecorder.stop === 'function') {
                        Main.screenRecorder.stop();
                    }
                } catch (e) {
                    console.error("Docktouch: Error stopping screen recording: " + e);
                }

                // 3. Fallback: Try to find and activate 'Stop' menu items in indicators
                const indicators = Main.panel.statusArea;
                const toCheck = [
                    indicators.screenSharing,
                    indicators.screenRecording,
                    indicators.remoteAccess,
                    indicators['remote-access']
                ];

                toCheck.forEach(indicator => {
                    if (!indicator || !indicator.visible) return;

                    try {
                        // Try calling stop methods directly if they exist on the indicator
                        if (typeof indicator.stop === 'function') indicator.stop();
                        else if (typeof indicator.stopRecording === 'function') indicator.stopRecording();
                        else if (typeof indicator._onStopClick === 'function') indicator._onStopClick();

                        if (indicator.menu) {
                            const items = indicator.menu._getMenuItems();
                            const stopKeywords = ['stop', 'parar', 'encerrar', 'desligar', 'terminar', 'cancelar', 'end', 'disable'];
                            const stopItem = items.find(i => {
                                const text = (i.label?.text || i.text || '').toLowerCase();
                                return stopKeywords.some(kw => text.includes(kw));
                            });
                            if (stopItem) stopItem.activate();
                        }
                    } catch (e) {
                        console.error("Docktouch: Error in indicator fallback: " + e);
                    }
                });
            });
            this._headerIndicators.add_child(stopSharingBtn);
        }

        this._headerClockLabel = new St.Label({
            style_class: 'header-clock-label',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-right: 8px; font-weight: bold;'
        });
        this._headerIndicators.add_child(this._headerClockLabel);

        const updateClock = () => {
            if (this._headerClockLabel) {
                try {
                    const now = GLib.DateTime.new_now_local();
                    this._headerClockLabel.text = now.format('%H:%M');
                } catch (e) { }
            }
        };
        updateClock();
        this._headerClockTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            try {
                if (this._headerClockLabel && this._headerClockLabel.get_stage()) {
                    updateClock();
                    return GLib.SOURCE_CONTINUE;
                }
            } catch (e) { }
            this._headerClockTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });

        const percentage = this._statsManager.batteryPercentage;
        const isCharging = this._statsManager.isCharging;
        this._batteryIcon = new St.Icon({
            icon_name: getBatteryIcon(percentage, isCharging),
            icon_size: 14,
            style: isCharging ? 'color: #30D158;' : (percentage < 20 ? 'color: #FF453A;' : 'opacity: 0.9;'),
            y_align: Clutter.ActorAlign.CENTER
        });
        this._headerIndicators.add_child(this._batteryIcon);

        this._batteryLabel = new St.Label({
            text: `${percentage}%`,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._headerIndicators.add_child(this._batteryLabel);

        this._atollHeader.add_child(this._headerIndicators);
    }

    _updateExpandedContent(force = false) {
        if (!this._isExpanded) return;

        // Skip rebuild if user is scrolling or recently interacted (1s)
        if (!force) {
            const now = GLib.get_monotonic_time();
            if (this._lastScrollTime && (now - this._lastScrollTime) < 1000000) return;
        }

        this._isRebuilding = true;

        const tabs = [
            { id: 'system', icon: 'system-run-symbolic', setting: 'show-volume' },
            { id: 'media', icon: 'audio-x-generic-symbolic', setting: 'show-mpris' },
            { id: 'time', icon: 'appointment-soon-symbolic', setting: 'show-calendar' },
            { id: 'stats', icon: 'utilities-system-monitor-symbolic', setting: 'show-stats' },
            { id: 'clipboard', icon: 'edit-copy-symbolic', setting: 'show-clipboard' }
        ].filter(t => !t.setting || this._settings.get_boolean(t.setting));

        if (tabs.length > 0 && !tabs.find(t => t.id === this._activeTab)) {
            this._activeTab = tabs[0].id;
        }

        let vscroll = 0;
        if (this._scrollView) {
            vscroll = this._scrollView.get_vscroll_bar().get_adjustment().get_value();
        }

        // If we already have the basic structure, keep it to avoid "remounting" feel
        if (this._scrollView && this._columns && this._atollHeader) {
            this._columns.destroy_all_children();

            // Update header indicators (including battery and sharing)
            this._updateHeaderIndicators();

            // Update tab buttons active state
            if (this._tabButtons) {
                Object.keys(this._tabButtons).forEach(id => {
                    const btn = this._tabButtons[id];
                    if (this._activeTab === id) btn.add_style_class_name('active');
                    else btn.remove_style_class_name('active');
                });
            }
        } else {
            this._content.destroy_all_children();

            this._atollHeader = new St.BoxLayout({ style_class: 'atoll-header', x_expand: true });
            const tabBar = new St.BoxLayout({ style_class: 'tab-bar' });
            this._tabButtons = {};

            tabs.forEach(tab => {
                const btn = new St.Button({
                    child: new St.Icon({ icon_name: tab.icon, icon_size: 16 }),
                    style_class: `tab-button ${this._activeTab === tab.id ? 'active' : ''}`
                });
                btn.connect('clicked', () => {
                    if (this._activeTab === tab.id) return;
                    this._activeTab = tab.id;
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { this._updateExpandedContent(true); return GLib.SOURCE_REMOVE; });
                });
                tabBar.add_child(btn);
                this._tabButtons[tab.id] = btn;
            });
            this._atollHeader.add_child(tabBar);
            this._atollHeader.add_child(new St.Widget({ x_expand: true }));

            this._updateHeaderIndicators();
            this._content.add_child(this._atollHeader);

            this._scrollView = new St.ScrollView({
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
                y_expand: true
            });
            this._content.add_child(this._scrollView);

            this._scrollView.get_vscroll_bar().get_adjustment().connect('notify::value', () => {
                this._lastScrollTime = GLib.get_monotonic_time();
            });

            this._columns = new St.BoxLayout({
                style_class: 'two-column-layout',
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.START,
            });
            this._scrollView.add_child(this._columns);
        }

        // Build current tab content
        if (tabs.find(t => t.id === this._activeTab)) {
            if (this._activeTab === 'system') Tabs.buildSystemTab(this, this._columns);
            else if (this._activeTab === 'media') Tabs.buildMediaTab(this, this._columns);
            else if (this._activeTab === 'time') Tabs.buildTimeTab(this, this._columns);
            else if (this._activeTab === 'stats') Tabs.buildStatsTab(this, this._columns);
            else if (this._activeTab === 'clipboard') Tabs.buildClipboardTab(this, this._columns);
        }

        if (vscroll > 0) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 25, () => {
                if (this._scrollView && this._isExpanded) {
                    const adj = this._scrollView.get_vscroll_bar().get_adjustment();
                    adj.set_value(vscroll);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        this._isRebuilding = false;
        if (this._activeTab === 'time') this._updateTimerUI();
    }

    handleDragOver(source, actor, x, y, time) {
        if (!this._isExpanded) { this._activeTab = 'clipboard'; this._expand(); }
        else if (this._activeTab !== 'clipboard') { this._activeTab = 'clipboard'; this._updateExpandedContent(true); }
        return DND.DragMotionResult.COPY_DROP;
    }

    acceptDrop(source, actor, x, y, time) {
        let text = '';
        if (source.get_text) text = source.get_text();
        else if (source.uris) text = source.uris.join('\n');

        if (text && text.trim() !== '') {
            const index = this.extension._clipboardHistory.indexOf(text);
            if (index !== -1) this.extension._clipboardHistory.splice(index, 1);
            this.extension._clipboardHistory.unshift(text);
            if (this.extension._clipboardHistory.length > 50) this.extension._clipboardHistory.pop();
            this.extension._saveClipboardHistory();

            if (!this._isExpanded) this._expand();
            this._activeTab = 'clipboard';
            this._updateExpandedContent(true);
            return true;
        }
        return false;
    }

    destroy() {
        if (this._headerClockTimeoutId) { GLib.source_remove(this._headerClockTimeoutId); this._headerClockTimeoutId = null; }
        if (this._osdTimeoutId) { GLib.source_remove(this._osdTimeoutId); this._osdTimeoutId = null; }
        if (this._waveformTimerId) { GLib.source_remove(this._waveformTimerId); this._waveformTimerId = null; }
        if (this._miniVisibilityTimerId) { GLib.source_remove(this._miniVisibilityTimerId); this._miniVisibilityTimerId = null; }
        if (this._timeTabTimerId) { GLib.source_remove(this._timeTabTimerId); this._timeTabTimerId = null; }
        if (this._expandTimeoutId) { GLib.source_remove(this._expandTimeoutId); this._expandTimeoutId = null; }
        if (this._container) {
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
            this._container = null;
        }
    }
}
