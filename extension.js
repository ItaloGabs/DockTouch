import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';
import GdkPixbuf from 'gi://GdkPixbuf';

const BrightnessIface = `
<node>
  <interface name="org.gnome.SettingsDaemon.Power.Screen">
    <property name="Brightness" type="i" access="readwrite"/>
    <property name="Percentage" type="u" access="readwrite"/>
  </interface>
</node>`;
const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(BrightnessIface);

import { getSystemInfo, formatTime, getBatteryIcon } from './lib/utils.js';
import { PlayerManager } from './lib/mpris.js';
import { StatsManager } from './lib/stats.js';
import { TimerManager } from './lib/timer.js';
import * as Tabs from './lib/tabs.js';

class Dock {
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
        this._playerVisibilityExpired = false;
        this._lastTrack = '';
        this._calendarDate = GLib.DateTime.new_now_local();
        this._lastScrollTime = 0;

        // Properties needed by Tabs.js
        this._volLabel = null;
        this._volSlider = null;
        this._mirrorVideoBin = null;
        this._batteryIcon = null;
        this._batteryLabel = null;
        this._headerClockLabel = null;
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
            clip_to_allocation: true,
        });
        this._container._delegate = this;

        this._blurEffect = new Shell.BlurEffect({ brightness: 0.6, mode: Shell.BlurMode.BACKGROUND });
        this._container.add_effect(this._blurEffect);

        this._mainLayout = new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true, reactive: true });
        this._container.set_child(this._mainLayout);

        // COLLAPSED HEADER
        this._header = new St.BoxLayout({
            style_class: 'docktouch-header',
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
            height: 38,
        });
        this._mainLayout.add_child(this._header);

        this._miniContent = new St.BoxLayout({ style_class: 'mini-content', x_expand: true });
        this._header.add_child(this._miniContent);

        this._miniIconContainer = new St.Bin({ 
            style_class: 'mini-player-icon-container',
            y_align: Clutter.ActorAlign.CENTER,
            width: 22, height: 22
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

        this._miniCapsLockIcon = new St.Icon({ 
            icon_name: 'keyboard-caps-lock-symbolic', 
            style_class: 'mini-caps-icon',
            visible: false,
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER
        });
        this._miniContent.add_child(this._miniCapsLockIcon);

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

        // EXPANDED CONTENT
        this._content = new St.BoxLayout({ vertical: true, style_class: 'docktouch-content', opacity: 0, visible: false, x_expand: true });
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
        if (!url || !url.startsWith('file://')) return null;
        try {
            const filePath = url.replace('file://', '').replace(/%20/g, ' ');
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
        this._miniTimerIcon.visible = false;
        this._miniTimerLabel.visible = false;
        this._miniLockIcon.visible = false;
        this._miniTimeLabel.visible = false;

        if (isPlaying || (isPaused && !this._playerVisibilityExpired && !isCaps) || timerActive || isLocked) {
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
                    const timerText = this._timerManager._timerActive ? this._timerManager.timerText : this._timerManager.alarmText;
                    this._miniTimeLabel.text = `${timerText} | ${timeStr}`;
                } else {
                    this._miniTimeLabel.text = timeStr;
                }
            } else if (isPlaying || (isPaused && !this._playerVisibilityExpired)) {
                this._miniIconContainer.visible = true;
                this._miniIcon.visible = true;
                this._miniIcon.icon_name = 'audio-x-generic-symbolic';
                
                if (isPaused) {
                    this._desaturateEffect.enabled = true;
                    if (this._waveformTimerId) {
                        GLib.source_remove(this._waveformTimerId);
                        this._waveformTimerId = null;
                    }
                    if (!this._miniVisibilityTimerId) {
                        this._miniVisibilityTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20000, () => {
                            this._miniVisibilityTimerId = null;
                            this._playerVisibilityExpired = true;
                            if (!this._timerManager.isActive) {
                                this._miniContent.visible = false;
                            } else {
                                // Keep visible but art will be hidden by next update call
                                this._updateMiniPlayerVisibility();
                            }
                            if (this.extension._isCapsLockActive && !this._timerManager.isActive) {
                                this._showOSD('caps', 100);
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                } else {
                    if (this._miniVisibilityTimerId) {
                        GLib.source_remove(this._miniVisibilityTimerId);
                        this._miniVisibilityTimerId = null;
                    }
                    this._desaturateEffect.enabled = false;

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
                }

                let color = player && player.artUrl ? (this._getAverageColor(player.artUrl) || 'white') : 'white';
                if (isPaused) color = 'rgba(255, 255, 255, 0.4)';
                
                // Show indicators on the right
                if (isCaps) {
                    this._miniCapsLockIcon.visible = true;
                    this._miniCapsLockIcon.set_style(`color: ${color};`);
                }

                if (timerActive) {
                    this._miniTimerIcon.visible = true;
                    this._miniTimerLabel.visible = true;
                    this._miniTimerLabel.text = this._timerManager._timerActive ? this._timerManager.timerText : this._timerManager.alarmText;
                    this._miniTimerIcon.set_style(`color: ${color};`);
                    this._miniTimerLabel.set_style(`color: ${color};`);
                } else if (!isCaps) {
                    // Restore: Show waves even when paused (frozen), if no timer and no caps
                    this._waveform.visible = true;
                    this._waveformBars.forEach(bar => bar.set_style(`background-color: ${color};`));
                }

                if (player && player.artUrl) {
                    const escapedUrl = player.artUrl.replace(/"/g, '\\"');
                    this._miniIconContainer.set_style(`background-image: url("${escapedUrl}"); background-size: cover; border-radius: 6px;`);
                    this._miniIcon.visible = false;
                } else {
                    this._miniIconContainer.set_style('');
                    this._miniIcon.visible = true;
                    this._miniIcon.set_style(`color: ${color};`);
                    if (!player?.artUrl) this._waveformBars.forEach(bar => bar.set_style(''));
                }
            } else if (timerActive) {
                // No music, but timer active
                // Icon on LEFT, Time on RIGHT
                this._miniIconContainer.visible = true;
                this._miniIconContainer.set_style('');
                this._miniIcon.visible = true;
                this._miniIcon.icon_name = 'appointment-soon-symbolic';
                this._miniIcon.set_style('color: white;');
                
                this._miniTimerLabel.visible = true;
                this._miniTimerLabel.text = this._timerManager._timerActive ? this._timerManager.timerText : this._timerManager.alarmText;
                this._miniTimerLabel.set_style('color: white;');
                
                if (isCaps) {
                    this._miniCapsLockIcon.visible = true;
                    this._miniCapsLockIcon.set_style('color: white;');
                }
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
            if (this.extension._isCapsLockActive && !Main.sessionMode.isLocked) {
                this._showOSD('caps', 100);
            }
        }
    }

    _updateTimerUI() {
        this._updateMiniPlayerVisibility();
        if (this._isExpanded && this._activeTab === 'time') {
            if (this._timerLabel) {
                this._timerLabel.text = this._timerManager._timerActive ? this._timerManager.timerText : (this._timerManager._timerSeconds > 0 ? `${this._timerManager.timerText} (Pausado)` : 'Inativo');
            }
            if (this._timerPauseBtn) {
                this._timerPauseBtn.visible = this._timerManager._timerActive;
            }
            if (this._timerResumeBtn) {
                this._timerResumeBtn.visible = !this._timerManager._timerActive && this._timerManager._timerSeconds > 0;
            }
            if (this._alarmStatusLabel) {
                this._alarmStatusLabel.text = this._timerManager._alarmActive ? `Ativo para ${this._timerManager.alarmText}` : 'Inativo';
            }
            if (this._bigClockLabel) {
                const now = GLib.DateTime.new_now_local();
                this._bigClockLabel.text = now.format('%H:%M:%S');
            }
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
        const isBattery = type === 'battery';
        const isLock = type === 'lock';

        if (this._osdTimeoutId) {
            GLib.source_remove(this._osdTimeoutId);
            this._osdTimeoutId = null;
        }

        const normalWidth = this._settings.get_int('normal-width');

        // Se for Caps Lock ou Lock e estiver desativado, ocultar se estiver mostrando e não houver outro OSD ativo
        if ((isCaps || isLock) && numericValue === 0) {
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

        // Se estiver tocando música ou o temporizador estiver ativo e for Caps Lock, mostrar no mini player em vez do OSD completo
        if (isCaps && !Main.sessionMode.isLocked) {
            const player = this._playerManager.getActivePlayer();
            const playbackStatus = player?.proxy?.PlaybackStatus;
            const timerActive = this._timerManager.isActive;
            if (playbackStatus === 'Playing' || timerActive) {
                this._osdContent.visible = false;
                this._updateMiniPlayerVisibility();
                this._container.ease({
                    width: normalWidth,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUART
                });
                return;
            }
        }

        let iconName = isVolume ? 'audio-volume-high-symbolic' : 
                      (isBrightness ? 'display-brightness-high-symbolic' : 
                      (isBattery ? getBatteryIcon(this._statsManager.batteryPercentage, this._statsManager.isCharging) : 
                      (isLock ? 'system-lock-screen-symbolic' : 'keyboard-caps-lock-symbolic')));
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
        } else if (isCaps || isLock) {
            valueText = '';
            iconName = isCaps ? 'keyboard-caps-lock-symbolic' : 'system-lock-screen-symbolic';
        }

        this._osdIcon.icon_name = iconName;
        this._osdProgressBar.set_style_class_name(`osd-progress-bar ${isVolume ? '' : (isBrightness ? 'brightness' : (isBattery ? 'battery' : (isCaps ? 'caps' : 'lock')))}`);

        const percent = Math.min(100, Math.max(0, numericValue));
        this._osdProgressBar.set_width((percent / 100) * 100);
        this._osdValueLabel.text = valueText;

        // Visibilidade conforme o tipo (Caps Lock e Lock ocultam tudo exceto o ícone)
        const isPillOnly = isCaps || isLock;
        this._osdSpacer.visible = !isPillOnly;
        this._osdProgressContainer.visible = !isPillOnly;
        this._osdValueLabel.visible = !isPillOnly;
        
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

        // Só coloca timeout se NÃO for Caps Lock ou Lock
        if (!isPillOnly) {
            this._osdTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                this._osdTimeoutId = null;
                if (this.extension._isCapsLockActive) {
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

        let shadow = this._isExpanded ? 'box-shadow: 0 10px 35px rgba(0,0,0,0.5);' : (islandMode !== 'standard' ? 'box-shadow: 0 2px 8px rgba(0,0,0,0.3);' : 'box-shadow: none;');

        this._container.set_style(`padding-top: ${marginTop}px; border-radius: ${borderRadius}; background-color: ${rgbaColor} !important; ${shadow} border: 1px solid rgba(255, 255, 255, 0.1);`);
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
            
            // Update header info without destroying everything
            if (this._batteryLabel) {
                const percentage = this._statsManager.batteryPercentage;
                this._batteryLabel.text = `${percentage}%`;
                if (this._batteryIcon) {
                    const isCharging = this._statsManager.isCharging;
                    this._batteryIcon.icon_name = getBatteryIcon(percentage, isCharging);
                    this._batteryIcon.style = isCharging ? 'color: #30D158;' : (percentage < 20 ? 'color: #FF453A;' : 'opacity: 0.9;');
                }
            }
            
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

            const indicators = new St.BoxLayout({ 
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
            indicators.add_child(mirrorBtn);

            this._headerClockLabel = new St.Label({
                style_class: 'header-clock-label',
                y_align: Clutter.ActorAlign.CENTER,
                style: 'margin-right: 8px; font-weight: bold;'
            });
            indicators.add_child(this._headerClockLabel);

            // Update clock every minute
            const updateClock = () => {
                if (this._headerClockLabel) {
                    const now = GLib.DateTime.new_now_local();
                    this._headerClockLabel.text = now.format('%H:%M');
                }
            };
            updateClock();
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
                if (this._headerClockLabel && this._headerClockLabel.get_stage()) {
                    updateClock();
                    return GLib.SOURCE_CONTINUE;
                }
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
            indicators.add_child(this._batteryIcon);
            
            this._batteryLabel = new St.Label({ 
                text: `${percentage}%`,
                y_align: Clutter.ActorAlign.CENTER
            });
            indicators.add_child(this._batteryLabel);
            this._atollHeader.add_child(indicators);
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
        if (this._osdTimeoutId) { GLib.source_remove(this._osdTimeoutId); this._osdTimeoutId = null; }
        if (this._waveformTimerId) { GLib.source_remove(this._waveformTimerId); this._waveformTimerId = null; }
        if (this._miniVisibilityTimerId) { GLib.source_remove(this._miniVisibilityTimerId); this._miniVisibilityTimerId = null; }
        if (this._expandTimeoutId) { GLib.source_remove(this._expandTimeoutId); this._expandTimeoutId = null; }
        if (this._container) { 
            Main.layoutManager.removeChrome(this._container); 
            this._container.destroy(); 
            this._container = null; 
        }
    }
}

export default class DocktouchExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._signals = new Map();
        this._docks = [];
        
        this._clipboardHistory = this._settings.get_strv('clipboard-history') || [];
        this._lastClipboardText = this._clipboardHistory.length > 0 ? this._clipboardHistory[0] : '';

        // Managers
        this._systemInfo = getSystemInfo();
        
        this._timerManager = new TimerManager({
            onUpdate: () => {
                this._docks.forEach(dock => {
                    if (dock._updateTimerUI) dock._updateTimerUI();
                });
            }
        });

        this._playerManager = new PlayerManager({
            onUpdate: () => {
                this._docks.forEach(dock => {
                    if (dock._isExpanded && dock._activeTab === 'media') {
                        const now = GLib.get_monotonic_time();
                        if (dock._lastScrollTime && (now - dock._lastScrollTime) < 1000000) return;
                        dock._updateExpandedContent();
                    }
                });
            },
            onMiniUpdate: () => this._docks.forEach(dock => dock._updateMiniPlayerVisibility())
        });
        this._playerManager.setup();

        this._lastIsCharging = false;
        this._statsManager = new StatsManager({
            onUpdate: () => {
                if (this._statsManager.isCharging !== this._lastIsCharging) {
                    if (this._statsManager.isCharging) {
                        this._showOSDAll('battery', this._statsManager.batteryPercentage);
                    }
                    this._lastIsCharging = this._statsManager.isCharging;
                }
                this._docks.forEach(dock => {
                    if (dock._isExpanded && (dock._activeTab === 'stats' || dock._activeTab === 'media' || dock._activeTab === 'system')) {
                        const now = GLib.get_monotonic_time();
                        if (dock._lastScrollTime && (now - dock._lastScrollTime) < 1000000) return;
                        
                        if (dock._activeTab === 'stats' || dock._activeTab === 'system') {
                            dock._updateExpandedContent();
                        }
                    }
                });
            }
        });
        this._statsManager.start();

        // Volume Control
        this._volumeControl = new Gvc.MixerControl({ name: 'Docktouch Volume' });
        this._volumeControl.connect('state-changed', (c, state) => {
            if (state === Gvc.MixerControlState.READY) this._setupVolumeStream();
        });
        this._volumeControl.connect('default-sink-changed', () => this._setupVolumeStream());
        this._volumeControl.open();

        // Brightness Proxy
        this._brightnessProxy = new BrightnessProxy(
            Gio.DBus.session,
            'org.gnome.SettingsDaemon.Power',
            '/org/gnome/SettingsDaemon/Power',
            (p, error) => {
                if (error) console.error("Docktouch: BrightnessProxy error: " + error);
                else {
                    const updateBrightness = () => {
                        let val = this._brightnessProxy.Percentage;
                        if (val === undefined || val === null) val = this._brightnessProxy.Brightness;
                        if (val !== undefined && val !== null) {
                            this._showOSDAll('brightness', val);
                        }
                    };
                    this._brightnessProxy.connect('notify::Brightness', updateBrightness);
                    this._brightnessProxy.connect('notify::Percentage', updateBrightness);
                    this._brightnessProxy.connect('g-properties-changed', updateBrightness);
                    updateBrightness();
                }
            }
        );

        this._sinkSignalId = null;
        this._muteSignalId = null;
        this._capsLockSignalId = null;
        this._isCapsLockActive = false;

        // Caps Lock monitoring
        try {
            const seat = Clutter.get_default_backend().get_default_seat();
            if (seat) {
                this._keymap = seat.get_keymap();
                if (this._keymap) {
                    this._capsLockSignalId = this._keymap.connect('notify::caps-lock-state', () => {
                        const state = this._keymap.get_caps_lock_state();
                        this._showOSDAll('caps', state ? 100 : 0);
                    });
                    
                    const state = this._keymap.get_caps_lock_state();
                    if (state) this._showOSDAll('caps', 100);
                }
            }
        } catch (e) {
            console.error("Docktouch: Caps Lock monitoring error: " + e);
        }

        this._setupSettingsListeners();
        this._setupClipboardObserver();

        // Session Mode monitoring
        this._sessionModeSignalId = Main.sessionMode.connect('updated', () => {
            this._updateSessionMode();
        });
        
        this._buildDocks();
        this._updateSessionMode();
        
        // Monitor changes
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => this._buildDocks());
        
        console.log('Docktouch (Multi-Monitor) Enabled!');
    }

    _buildDocks() {
        this._docks.forEach(dock => dock.destroy());
        this._docks = [];

        const displayMode = this._settings.get_string('display-mode');
        if (displayMode === 'all') {
            Main.layoutManager.monitors.forEach(monitor => {
                this._docks.push(new Dock(this, monitor));
            });
        } else {
            this._docks.push(new Dock(this, Main.layoutManager.primaryMonitor));
        }
    }

    _showOSDAll(type, value) {
        if (type === 'caps') this._isCapsLockActive = (value > 0);
        this._docks.forEach(dock => dock._showOSD(type, value));
    }

    _saveClipboardHistory() {
        this._settings.set_strv('clipboard-history', this._clipboardHistory);
    }

    _setupClipboardObserver() {
        this._clipboard = St.Clipboard.get_default();
        this._clipboardTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (clipboard, text) => {
                if (text && text.trim() !== '' && text !== this._lastClipboardText) {
                    this._lastClipboardText = text;
                    const index = this._clipboardHistory.indexOf(text);
                    if (index !== -1) this._clipboardHistory.splice(index, 1);
                    
                    this._clipboardHistory.unshift(text);
                    if (this._clipboardHistory.length > 50) this._clipboardHistory.pop();
                    this._saveClipboardHistory();
                    
                    this._docks.forEach(dock => {
                        if (dock._isExpanded && dock._activeTab === 'clipboard') {
                            dock._updateExpandedContent();
                        }
                    });
                }
            });
            return GLib.SOURCE_CONTINUE;
        });
    }

    _setupSettingsListeners() {
        ['normal-width', 'expanded-width', 'expanded-height', 'theme-color', 'pill-opacity', 'blur-sigma', 'island-mode',
         'show-mpris', 'show-volume', 'show-stats', 'show-calendar', 'show-clipboard', 'hover-expand', 'hover-delay', 'display-mode']
        .forEach(setting => {
            const id = this._settings.connect(`changed::${setting}`, () => {
                if (setting === 'display-mode') {
                    this._buildDocks();
                    return;
                }
                if (setting.startsWith('show-')) {
                    this._docks.forEach(dock => {
                        dock._atollHeader = null;
                        dock._scrollView = null;
                        dock._columns = null;
                        if (dock._isExpanded) dock._updateExpandedContent(true);
                    });
                }
                this._docks.forEach(dock => dock._updateLayout());
            });
            this._signals.set(setting, id);
        });
    }

    _updateSessionMode() {
        const isLocked = Main.sessionMode.isLocked;
        this._docks.forEach(dock => {
            if (isLocked) {
                if (dock._expandTimeoutId) {
                    GLib.source_remove(dock._expandTimeoutId);
                    dock._expandTimeoutId = null;
                }
                if (dock._isExpanded) {
                    dock._isExpanded = false;
                    dock._content.visible = false;
                    dock._content.opacity = 0;
                    dock._header.visible = true;
                    dock._header.opacity = 255;
                    dock._updateLayout();
                }
            }
            dock._container.reactive = !isLocked;
            
            // Re-trigger mini player visibility update to handle lock screen state
            dock._updateMiniPlayerVisibility();
            
            if (!isLocked) {
                if (this._isCapsLockActive) {
                    dock._showOSD('caps', 100);
                } else {
                    dock._showOSD('lock', 0);
                }
            }
            dock._updatePosition();
        });
    }

    _setupVolumeStream() {
        if (this._sinkSignalId) {
            this._sink?.disconnect(this._sinkSignalId);
            this._sinkSignalId = null;
        }
        if (this._muteSignalId) {
            this._sink?.disconnect(this._muteSignalId);
            this._muteSignalId = null;
        }

        this._sink = this._volumeControl.get_default_sink();
        if (this._sink) {
            this._sinkSignalId = this._sink.connect('notify::volume', () => {
                const maxVol = this._volumeControl.get_vol_max_norm();
                const vol = (this._sink.volume / maxVol) * 100;
                this._showOSDAll('volume', vol);

                this._docks.forEach(dock => {
                    if (dock._isExpanded && dock._activeTab === 'system' && dock._volSlider) {
                        dock._volSlider.value = vol / 100;
                        if (dock._volLabel) dock._volLabel.text = `${Math.round(vol)}%`;
                    }
                });
            });
            this._muteSignalId = this._sink.connect('notify::is-muted', () => {
                const maxVol = this._volumeControl.get_vol_max_norm();
                const vol = (this._sink.volume / maxVol) * 100;
                this._showOSDAll('volume', vol);
                
                this._docks.forEach(dock => {
                    if (dock._isExpanded && dock._activeTab === 'system' && dock._volSlider) {
                        if (dock._volLabel) dock._volLabel.text = this._sink.is_muted ? 'MUTE' : `${Math.round(vol)}%`;
                    }
                });
            });
        }
    }

    disable() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        if (this._clipboardTimerId) { GLib.source_remove(this._clipboardTimerId); this._clipboardTimerId = null; }
        if (this._sinkSignalId) { this._sink?.disconnect(this._sinkSignalId); this._sinkSignalId = null; }
        if (this._muteSignalId) { this._sink?.disconnect(this._muteSignalId); this._muteSignalId = null; }
        if (this._capsLockSignalId && this._keymap) {
            this._keymap.disconnect(this._capsLockSignalId);
            this._capsLockSignalId = null;
            this._keymap = null;
        }
        this._brightnessProxy = null;

        if (this._sessionModeSignalId) {
            Main.sessionMode.disconnect(this._sessionModeSignalId);
            this._sessionModeSignalId = null;
        }
        if (this._playerManager) this._playerManager.destroy();
        if (this._statsManager) this._statsManager.stop();
        this._signals.forEach(id => this._settings.disconnect(id));
        this._docks.forEach(dock => dock.destroy());
        this._docks = [];
        if (this._volumeControl) { this._volumeControl.close(); this._volumeControl = null; }
    }
}
