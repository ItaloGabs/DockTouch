import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { buildCalendarGrid } from './utils.js';

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
