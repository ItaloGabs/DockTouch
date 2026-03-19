import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export function getSystemInfo() {
    let distro = 'Linux';
    let username = GLib.get_real_name() || GLib.get_user_name();
    let avatar = null;
    let kernel = 'Unknown';
    let shellVersion = 'Unknown';

    // Distro Info
    try {
        const [, osRelease] = GLib.file_get_contents('/etc/os-release');
        const lines = new TextDecoder().decode(osRelease).split('\n');
        const prettyNameLine = lines.find(l => l.startsWith('PRETTY_NAME='));
        if (prettyNameLine) {
            distro = prettyNameLine.split('=')[1].replace(/"/g, '');
        }
    } catch (e) {}

    // Kernel Info
    try {
        const [, version] = GLib.file_get_contents('/proc/version');
        kernel = new TextDecoder().decode(version).split(' ')[2];
    } catch (e) {}

    // Shell Version
    try {
        shellVersion = Gio.Application.get_default().get_version() || '45+';
    } catch (e) {}

    // Avatar check
    const home = GLib.get_home_dir();
    const facePaths = [
        `${home}/.face`,
        `${home}/.face.icon`,
        `/var/lib/AccountsService/icons/${GLib.get_user_name()}`
    ];

    for (const path of facePaths) {
        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            avatar = `file://${path}`;
            break;
        }
    }

    return { distro, username, avatar };
}

export function formatTime(microseconds) {
    if (!microseconds || microseconds < 0) return '0:00';
    let seconds = Math.floor(microseconds / 1000000);
    let mins = Math.floor(seconds / 60);
    let secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function getBatteryIcon(percentage, isCharging) {
    const p = percentage || 100;
    if (isCharging) return 'battery-charging-symbolic';
    if (p < 10) return 'battery-level-0-symbolic';
    if (p < 25) return 'battery-level-20-symbolic';
    if (p < 45) return 'battery-level-40-symbolic';
    if (p < 65) return 'battery-level-60-symbolic';
    if (p < 85) return 'battery-level-80-symbolic';
    return 'battery-level-100-symbolic';
}
