import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MPRIS_PLAYER_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="PlaybackStatus" type="s" access="read" />
    <property name="Metadata" type="a{sv}" access="read" />
    <property name="Position" type="x" access="read" />
    <property name="Shuffle" type="b" access="readwrite" />
    <property name="LoopStatus" type="s" access="readwrite" />
    <method name="PlayPause" />
    <method name="Next" />
    <method name="Previous" />
  </interface>
</node>`;

export const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_PLAYER_IFACE);

export class PlayerManager {
    constructor(callbacks) {
        this._callbacks = callbacks; // { onUpdate, onMiniUpdate }
        this._players = new Map();
        this._activePlayer = null;
        this._ownerChangedId = 0;
    }

    setup() {
        this._ownerChangedId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, parameters) => {
                let [name, oldOwner, newOwner] = parameters.recursiveUnpack();
                if (name.startsWith('org.mpris.MediaPlayer2.')) {
                    if (newOwner && !oldOwner) this._addPlayer(name);
                    else if (oldOwner && !newOwner) this._removePlayer(name);
                }
            }
        );

        // Scan for existing players
        const proxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: 'org.freedesktop.DBus',
            g_object_path: '/org/freedesktop/DBus',
            g_interface_name: 'org.freedesktop.DBus'
        });
        
        proxy.call('ListNames', null, Gio.DBusCallFlags.NONE, -1, null, (p, result) => {
            try {
                const [names] = p.call_finish(result).recursiveUnpack();
                names.forEach(name => {
                    if (name.startsWith('org.mpris.MediaPlayer2.')) this._addPlayer(name);
                });
            } catch (e) {}
        });
    }

    _addPlayer(name) {
        if (this._players.has(name)) return;
        
        const proxy = new PlayerProxy(Gio.DBus.session, name, '/org/mpris/MediaPlayer2');
        const player = { name, proxy, title: '', artist: '', artUrl: '', length: 0 };
        this._players.set(name, player);

        const updateMetadata = () => {
            const metadata = proxy.Metadata;
            if (!metadata) return;

            let title = metadata['xesam:title'];
            if (title instanceof GLib.Variant) title = title.recursiveUnpack();
            player.title = Array.isArray(title) ? title[0] : (title || 'Music');
            
            let artist = metadata['xesam:artist'];
            if (artist instanceof GLib.Variant) artist = artist.recursiveUnpack();
            player.artist = Array.isArray(artist) ? artist[0] : (artist || 'Unknown Artist');
            
            let artUrl = metadata['mpris:artUrl'];
            if (artUrl instanceof GLib.Variant) artUrl = artUrl.recursiveUnpack();
            if (Array.isArray(artUrl)) artUrl = artUrl[0];
            
            let artUrlStr = artUrl ? String(artUrl) : '';
            if (artUrlStr && !artUrlStr.startsWith('file://') && !artUrlStr.startsWith('http')) {
                artUrlStr = `file://${artUrlStr}`;
            }
            player.artUrl = artUrlStr;

            let length = metadata['mpris:length'];
            if (length instanceof GLib.Variant) length = length.recursiveUnpack();
            player.length = length || 0;
            
            if (this._activePlayer === player) {
                this._callbacks.onUpdate?.();
                this._callbacks.onMiniUpdate?.();
            }
        };

        proxy.connect('g-properties-changed', (p, changed) => {
            if (changed['PlaybackStatus'] === 'Playing') {
                this._activePlayer = player;
            }
            updateMetadata();
            this._callbacks.onUpdate?.(); // Notify update for Shuffle/Loop changes too
            this._callbacks.onMiniUpdate?.();
        });

        updateMetadata();
        if (proxy.PlaybackStatus === 'Playing') this._activePlayer = player;
        if (!this._activePlayer) this._activePlayer = player;
        this._callbacks.onMiniUpdate?.();
    }

    _removePlayer(name) {
        this._players.delete(name);
        if (this._activePlayer?.name === name) {
            this._activePlayer = Array.from(this._players.values())[0] || null;
            this._callbacks.onMiniUpdate?.();
            this._callbacks.onUpdate?.();
        }
    }

    getActivePlayer() {
        // Double check if any player is playing
        for (let player of this._players.values()) {
            if (player.proxy && player.proxy.PlaybackStatus === 'Playing') {
                this._activePlayer = player;
                return player;
            }
        }
        return this._activePlayer;
    }

    destroy() {
        if (this._ownerChangedId) Gio.DBus.session.signal_unsubscribe(this._ownerChangedId);
        this._players.clear();
        this._activePlayer = null;
    }
}
