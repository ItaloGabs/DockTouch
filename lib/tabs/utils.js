import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Cairo from 'gi://cairo';
import Gst from 'gi://Gst';

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
