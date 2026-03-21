import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';

import { getSystemInfo } from './lib/utils.js';
import { PlayerManager } from './lib/mpris.js';
import { StatsManager } from './lib/stats.js';
import { TimerManager } from './lib/timer.js';
import { Dock } from './lib/dock.js';
import { BrightnessProxy } from './lib/brightness.js';

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
        }, this.path);

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
            if (state === Gvc.MixerControlState.READY) {
                this._setupVolumeStream();
                this._updateMicState();
            }
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
        this._micSignalId = null;
        this._micMuteSignalId = null;
        this._isMicActive = false;
        this._isMicMuted = false;
        this._isScreenActive = false;
        this._isScreenRecording = false;
        this._isScreenSharing = false;
        this._screenRecordingSignalId = null;
        this._screenSharingSignalId = null;
        this._capsLockSignalId = null;
        this._isCapsLockActive = false;

        // Microphone monitoring
        this._volumeControl.connect('stream-added', () => this._updateMicState());
        this._volumeControl.connect('stream-removed', () => this._updateMicState());
        this._volumeControl.connect('default-source-changed', () => {
            this._setupMicStream();
            this._updateMicState();
        });
        this._setupMicStream();
        this._updateMicState();

        // Screen Sharing monitoring
        if (Main.panel.statusArea.screenRecording) {
            this._screenRecordingSignalId = Main.panel.statusArea.screenRecording.connect('notify::visible', () => this._updateScreenState());
        }
        if (Main.panel.statusArea.screenSharing) {
            this._screenSharingSignalId = Main.panel.statusArea.screenSharing.connect('notify::visible', () => this._updateScreenState());
        }
        if (Main.panel.statusArea.remoteAccess) {
            this._remoteAccessSignalId = Main.panel.statusArea.remoteAccess.connect('notify::visible', () => this._updateScreenState());
        }
        if (Main.panel.statusArea['remote-access']) {
            this._remoteAccessAltSignalId = Main.panel.statusArea['remote-access'].connect('notify::visible', () => this._updateScreenState());
        }
        this._updateScreenState();

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

    _setupMicStream() {
        if (this._micMuteSignalId) {
            this._volumeControl.get_default_source()?.disconnect(this._micMuteSignalId);
            this._micMuteSignalId = null;
        }
        const source = this._volumeControl.get_default_source();
        if (source) {
            this._micMuteSignalId = source.connect('notify::is-muted', () => this._updateMicState());
        }
    }

    _updateMicState() {
        if (!this._volumeControl || this._volumeControl.get_state() !== Gvc.MixerControlState.READY) return;
        const outputs = this._volumeControl.get_source_outputs() || [];
        const active = outputs.some(o => !o.is_event_stream);
        const source = this._volumeControl.get_default_source();
        const isMuted = source ? source.is_muted : false;
        
        if (this._isMicActive !== active || this._isMicMuted !== isMuted) {
            this._isMicActive = active;
            this._isMicMuted = isMuted;
            this._showOSDAll('mic', active ? 100 : 0);
        }
    }

    _updateScreenState() {
        const isRecording = Main.panel.statusArea.screenRecording?.visible || false;
        const isSharing = Main.panel.statusArea.screenSharing?.visible || false;
        const isRemote = (Main.panel.statusArea.remoteAccess?.visible || Main.panel.statusArea['remote-access']?.visible) || false;
        const active = isRecording || isSharing || isRemote;

        if (this._isScreenActive !== active || this._isScreenRecording !== isRecording || this._isScreenSharing !== (isSharing || isRemote)) {
            this._isScreenActive = active;
            this._isScreenRecording = isRecording;
            this._isScreenSharing = (isSharing || isRemote);
            this._showOSDAll('screen', active ? 100 : 0);
        }
    }

    _showOSDAll(type, value) {
        if (type === 'caps') this._isCapsLockActive = (value > 0);
        if (type === 'mic') this._isMicActive = (value > 0);
        if (type === 'screen') {
            this._isScreenActive = (value > 0);
            this._docks.forEach(dock => {
                if (dock._isExpanded) dock._updateExpandedContent(true);
            });
        }
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
        if (this._micMuteSignalId) {
            this._volumeControl.get_default_source()?.disconnect(this._micMuteSignalId);
            this._micMuteSignalId = null;
        }
        if (this._screenRecordingSignalId && Main.panel.statusArea.screenRecording) {
            Main.panel.statusArea.screenRecording.disconnect(this._screenRecordingSignalId);
            this._screenRecordingSignalId = null;
        }
        if (this._screenSharingSignalId && Main.panel.statusArea.screenSharing) {
            Main.panel.statusArea.screenSharing.disconnect(this._screenSharingSignalId);
            this._screenSharingSignalId = null;
        }
        if (this._remoteAccessSignalId && Main.panel.statusArea.remoteAccess) {
            Main.panel.statusArea.remoteAccess.disconnect(this._remoteAccessSignalId);
            this._remoteAccessSignalId = null;
        }
        if (this._remoteAccessAltSignalId && Main.panel.statusArea['remote-access']) {
            Main.panel.statusArea['remote-access'].disconnect(this._remoteAccessAltSignalId);
            this._remoteAccessAltSignalId = null;
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
