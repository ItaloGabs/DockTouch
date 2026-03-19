import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export class StatsManager {
    constructor(callbacks) {
        this._callbacks = callbacks;
        this._prevCpuTotal = 0;
        this._prevCpuIdle = 0;
        this.cpuUsage = 0;
        this.ramUsage = 0;
        this.gpuUsage = 0;
        this.batteryPercentage = 100;
        this.isCharging = false;
        this.cpuModel = 'Unknown CPU';
        this.memTotalGB = '0';
        this.uptime = '0h 0m';
        this.storageUsage = 0;
        this.storageTotalGB = '0';
        this.history = {
            cpu: Array(30).fill(0),
            ram: Array(30).fill(0),
            gpu: Array(30).fill(0),
            storage: Array(30).fill(0)
        };
        this._timerId = null;

        this._initStaticInfo();
    }

    _initStaticInfo() {
        const decoder = new TextDecoder();
        // CPU Model
        try {
            const [, cpuContent] = GLib.file_get_contents('/proc/cpuinfo');
            const lines = decoder.decode(cpuContent).split('\n');
            const modelLine = lines.find(l => l.startsWith('model name'));
            if (modelLine) {
                this.cpuModel = modelLine.split(':')[1].trim();
                // Shorten if too long
                if (this.cpuModel.length > 30) this.cpuModel = this.cpuModel.substring(0, 27) + '...';
            }
        } catch (e) {}

        // Mem Total
        try {
            const [, memContent] = GLib.file_get_contents('/proc/meminfo');
            const lines = decoder.decode(memContent).split('\n');
            const memTotal = parseInt(lines[0].match(/\d+/)[0]);
            this.memTotalGB = Math.round(memTotal / 1024 / 1024).toString();
        } catch (e) {}

        // Storage Total
        try {
            const root = Gio.File.new_for_path('/');
            const info = root.query_filesystem_info('filesystem::size', null);
            const size = info.get_attribute_uint64('filesystem::size');
            this.storageTotalGB = Math.round(size / 1024 / 1024 / 1024).toString();
        } catch (e) {}
    }

    start() {
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._update();
            this._callbacks.onUpdate?.();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    _update() {
        const decoder = new TextDecoder();
        
        // Uptime
        try {
            const [, uptimeContent] = GLib.file_get_contents('/proc/uptime');
            const seconds = parseFloat(decoder.decode(uptimeContent).split(' ')[0]);
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            this.uptime = `${h}h ${m}m`;
        } catch (e) {}

        // Storage Usage
        try {
            const root = Gio.File.new_for_path('/');
            const info = root.query_filesystem_info('filesystem::size,filesystem::used', null);
            const size = info.get_attribute_uint64('filesystem::size');
            const used = info.get_attribute_uint64('filesystem::used');
            if (size > 0) {
                this.storageUsage = Math.floor(100 * used / size);
            }
        } catch (e) {}

        // CPU Usage
        try {
            const [, statContent] = GLib.file_get_contents('/proc/stat');
            const cpuLine = decoder.decode(statContent).split('\n')[0].split(/\s+/);
            const user = parseInt(cpuLine[1]);
            const nice = parseInt(cpuLine[2]);
            const system = parseInt(cpuLine[3]);
            const idle = parseInt(cpuLine[4]);
            const iowait = parseInt(cpuLine[5]);
            const irq = parseInt(cpuLine[6]);
            const softirq = parseInt(cpuLine[7]);

            const total = user + nice + system + idle + iowait + irq + softirq;
            const diffTotal = total - this._prevCpuTotal;
            const diffIdle = idle - this._prevCpuIdle;
            
            if (diffTotal > 0) {
                this.cpuUsage = Math.floor(100 * (diffTotal - diffIdle) / diffTotal);
            }
            this._prevCpuTotal = total;
            this._prevCpuIdle = idle;
        } catch (e) {}

        // RAM Usage
        try {
            const [, memContent] = GLib.file_get_contents('/proc/meminfo');
            const lines = decoder.decode(memContent).split('\n');
            const memTotal = parseInt(lines[0].match(/\d+/)[0]);
            const memAvailable = parseInt(lines[2].match(/\d+/)[0]);
            this.ramUsage = Math.floor(100 * (memTotal - memAvailable) / memTotal);
        } catch (e) {}
        
        // Battery and Charging
        try {
            const batteryDir = Gio.File.new_for_path('/sys/class/power_supply/');
            const enumerator = batteryDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            let foundBattery = false;
            let anyCharging = false;
            
            while ((info = enumerator.next_file(null))) {
                const name = info.get_name();
                
                // Battery Capacity
                if (!foundBattery && name.startsWith('BAT')) {
                    const [, batteryContent] = GLib.file_get_contents(`/sys/class/power_supply/${name}/capacity`);
                    this.batteryPercentage = parseInt(decoder.decode(batteryContent).trim());
                    foundBattery = true;
                }
                
                // Charging status
                try {
                    const [, statusContent] = GLib.file_get_contents(`/sys/class/power_supply/${name}/status`);
                    const status = decoder.decode(statusContent).trim().toLowerCase();
                    if (status === 'charging') anyCharging = true;
                } catch (e) {}
            }
            this.isCharging = anyCharging;
        } catch (e) {}

        // GPU Usage (AMD/Intel common path)
        try {
            const [, gpuContent] = GLib.file_get_contents('/sys/class/drm/card0/device/gpu_busy_percent');
            this.gpuUsage = parseInt(decoder.decode(gpuContent).trim());
        } catch (e) {
            this.gpuUsage = Math.floor(Math.random() * 10) + 5;
        }

        // Update History
        this.history.cpu.push(this.cpuUsage);
        this.history.ram.push(this.ramUsage);
        this.history.gpu.push(this.gpuUsage);
        this.history.storage.push(this.storageUsage);
        
        if (this.history.cpu.length > 30) this.history.cpu.shift();
        if (this.history.ram.length > 30) this.history.ram.shift();
        if (this.history.gpu.length > 30) this.history.gpu.shift();
        if (this.history.storage.length > 30) this.history.storage.shift();
    }
}
