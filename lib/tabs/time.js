import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

export function buildTimeTab(ext, container) {
    const mainCol = new St.BoxLayout({ vertical: true, x_expand: true, style: 'spacing: 16px; padding: 10px;' });
    container.add_child(mainCol);

    // Timer Section
    const timerCol = new St.BoxLayout({ vertical: true, style_class: 'widget-panel', x_expand: true, style: 'padding: 15px; spacing: 10px;' });
    timerCol.add_child(new St.Label({ text: 'Temporizador', style: 'font-size: 14pt; font-weight: bold;' }));
    
    let timerStatus = ext._timerManager._timerActive ? ext._timerManager.timerText : (ext._timerManager._timerSeconds > 0 ? `${ext._timerManager.timerText} (Pausado)` : 'Inativo');
    let timerStyle = '';
    let timerClass = '';

    if (ext._timerManager._timerRinging) {
        timerStatus = '0:00 - ACABOU!';
        timerStyle = 'color: #FF453A; font-weight: bold;';
        timerClass = 'blink';
    }

    ext._timerLabel = new St.Label({ text: timerStatus, style: `font-size: 18pt; font-family: monospace; ${timerStyle}`, style_class: timerClass });
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
    ext._stopTimerBtn = stopTimer;

    timerCol.add_child(timerControls);
    mainCol.add_child(timerCol);

    // Alarm Section
    const alarmCol = new St.BoxLayout({ vertical: true, style_class: 'widget-panel', x_expand: true, style: 'padding: 15px; spacing: 10px;' });
    alarmCol.add_child(new St.Label({ text: 'Alarme', style: 'font-size: 14pt; font-weight: bold;' }));
    
    let alarmStatus = ext._timerManager._alarmActive ? `Ativo para ${ext._timerManager.alarmText}` : 'Inativo';
    let alarmStyle = '';
    let alarmClass = '';
    let stopAlarmLabel = 'Desativar';

    if (ext._timerManager._alarmRinging) {
        alarmStatus = `${ext._timerManager.alarmText} - HORÁRIO ATINGIDO!`;
        alarmStyle = 'color: #FF453A; font-weight: bold;';
        alarmClass = 'blink';
        stopAlarmLabel = 'Parar';
    }

    ext._alarmStatusLabel = new St.Label({ text: alarmStatus, style: `font-size: 12pt; ${alarmStyle}`, style_class: alarmClass });
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

    const stopAlarm = new St.Button({ label: stopAlarmLabel, style_class: 'tab-button action-btn', x_expand: true });
    stopAlarm.connect('clicked', () => {
        ext._timerManager.stopAlarm();
    });
    alarmInputRow.add_child(stopAlarm);
    ext._stopAlarmBtn = stopAlarm;

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
