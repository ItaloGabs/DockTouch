import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gst from 'gi://Gst';

export class TimerManager {
    constructor(callbacks, extensionPath) {
        this._callbacks = callbacks; // { onUpdate }
        this._extensionPath = extensionPath;
        this._timerSeconds = 0;
        this._timerActive = false;
        this._timerId = null;
        
        this._alarmTime = null; // GLib.DateTime
        this._lastAlarmText = '';
        this._alarmActive = false;
        this._alarmCheckId = null;

        this._timerRinging = false;
        this._alarmRinging = false;
        this._player = null;

        try {
            Gst.init(null);
        } catch (e) {
            console.error("Docktouch: Failed to initialize GStreamer in TimerManager: " + e);
        }
    }

    _playAlarmSound() {
        if (this._player) {
            this._player.set_state(Gst.State.NULL);
            this._player = null;
        }

        try {
            const audioPath = `${this._extensionPath}/audio/freesound_community-alarm-clock-90867.mp3`;
            this._player = Gst.ElementFactory.make('playbin', 'player');
            this._player.uri = GLib.filename_to_uri(audioPath, null);
            
            // Loop the sound
            const bus = this._player.get_bus();
            bus.add_signal_watch();
            bus.connect('message::eos', () => {
                this._player.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH, 0);
            });

            this._player.set_state(Gst.State.PLAYING);
        } catch (e) {
            console.error("Docktouch: Failed to play alarm sound: " + e);
        }
    }

    _stopAlarmSound() {
        if (this._player) {
            this._player.set_state(Gst.State.NULL);
            this._player = null;
        }
        this._timerRinging = false;
        this._alarmRinging = false;
    }

    startTimer(seconds) {
        this.stopTimer();
        this._timerSeconds = seconds;
        this._timerActive = true;
        
        this._startTimeout();
        this._callbacks.onUpdate?.();
    }

    addSeconds(seconds) {
        this._timerSeconds += seconds;
        if (!this._timerActive && this._timerSeconds > 0) {
            this._timerActive = true;
            this._startTimeout();
        }
        this._callbacks.onUpdate?.();
    }

    _startTimeout() {
        if (this._timerId) return;
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (this._timerSeconds > 0) {
                this._timerSeconds--;
                this._callbacks.onUpdate?.();
                return GLib.SOURCE_CONTINUE;
            } else {
                this._timerActive = false;
                this._timerId = null;
                this._timerRinging = true;
                this._notify('Timer Finished', 'Your timer has ended!');
                this._playAlarmSound();
                this._callbacks.onUpdate?.();
                return GLib.SOURCE_REMOVE;
            }
        });
    }

    stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        this._timerActive = false;
        this._timerRinging = false;
        if (!this._alarmRinging) this._stopAlarmSound();
        this._callbacks.onUpdate?.();
    }

    resetTimer() {
        this.stopTimer();
        this._timerSeconds = 0;
        this._callbacks.onUpdate?.();
    }

    setAlarm(hour, minute) {
        const now = GLib.DateTime.new_now_local();
        let alarm = GLib.DateTime.new_local(
            now.get_year(), now.get_month(), now.get_day_of_month(),
            hour, minute, 0
        );
        
        if (alarm.compare(now) <= 0) {
            alarm = alarm.add_days(1);
        }
        
        this._alarmTime = alarm;
        this._alarmActive = true;
        this._alarmRinging = false; // stop ringing if setting a new alarm
        if (!this._timerRinging) this._stopAlarmSound();
        
        if (this._alarmCheckId) GLib.source_remove(this._alarmCheckId);
        
        this._alarmCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
            const current = GLib.DateTime.new_now_local();
            if (this._alarmActive && current.compare(this._alarmTime) >= 0) {
                this._alarmActive = false;
                this._alarmRinging = true;
                this._lastAlarmText = this._alarmTime.format('%H:%M');
                this._notify('Alarm', `It's ${this._lastAlarmText}!`);
                this._alarmTime = null;
                this._playAlarmSound();
                this._callbacks.onUpdate?.();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        
        this._callbacks.onUpdate?.();
    }

    stopAlarm() {
        this._alarmActive = false;
        this._alarmTime = null;
        this._alarmRinging = false;
        if (this._alarmCheckId) {
            GLib.source_remove(this._alarmCheckId);
            this._alarmCheckId = null;
        }
        if (!this._timerRinging) this._stopAlarmSound();
        this._callbacks.onUpdate?.();
    }

    _notify(title, body) {
        const notification = new Gio.Notification();
        notification.set_title(title);
        notification.set_body(body);
        notification.set_icon(Gio.Icon.new_for_string('appointment-soon-symbolic'));
        
        const app = Gio.Application.get_default();
        if (app) {
            app.send_notification('docktouch-timer', notification);
        }
    }

    get timerText() {
        const h = Math.floor(this._timerSeconds / 3600);
        const m = Math.floor((this._timerSeconds % 3600) / 60);
        const s = this._timerSeconds % 60;
        
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    get alarmText() {
        if (this._alarmTime) return this._alarmTime.format('%H:%M');
        if (this._isRinging && this._lastAlarmText) return this._lastAlarmText;
        return '';
    }

    get currentText() {
        if (this._timerActive || this._timerRinging) return this.timerText;
        if (this._alarmActive || this._alarmRinging) return this.alarmText;
        return 'Inativo';
    }

    get _isRinging() {
        return this._timerRinging || this._alarmRinging;
    }

    get isActive() {
        return this._timerActive || this._alarmActive || this._isRinging;
    }
}
