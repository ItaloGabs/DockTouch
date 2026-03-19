import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

export default class DocktouchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({ title: 'Configurações do Docktouch' });
        const group = new Adw.PreferencesGroup({ title: 'Personalização' });
        page.add(group);

        // Tipo de Tema (Dynamic vs Standard)
        const modeModel = Gtk.StringList.new([
            'Docktouch (Dinâmico)',
            'Standard Island (Padrão)'
        ]);

        const modeRow = new Adw.ComboRow({
            title: 'Modo de Visualização',
            model: modeModel,
            selected: (settings.get_string('island-mode') === 'standard') ? 1 : 0
        });

        modeRow.connect('notify::selected', () => {
            const value = modeRow.selected === 1 ? 'standard' : 'dynamic';
            settings.set_string('island-mode', value);
        });
        group.add(modeRow);

        // Cor de Fundo
        const colorRow = new Adw.ActionRow({ title: 'Cor de Fundo' });
        const colorBtn = new Gtk.ColorButton();
        const rgba = new Gdk.RGBA();
        rgba.parse(settings.get_string('theme-color'));
        colorBtn.set_rgba(rgba);
        colorBtn.connect('color-set', () => {
            const newRgba = colorBtn.get_rgba();
            settings.set_string('theme-color', newRgba.to_string());
        });
        colorRow.add_suffix(colorBtn);
        group.add(colorRow);

        // Opacidade
        const opacityRow = new Adw.ActionRow({ title: 'Opacidade' });
        const opacityScale = new Gtk.Scale({
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 255, step_increment: 1, page_increment: 10, value: settings.get_int('pill-opacity') }),
            value_pos: Gtk.PositionType.RIGHT,
            draw_value: true,
            hexpand: true,
            valign: Gtk.Align.CENTER
        });
        opacityScale.set_size_request(200, -1);
        settings.bind('pill-opacity', opacityScale.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        opacityRow.add_suffix(opacityScale);
        group.add(opacityRow);

        // Intensidade do Blur (Desfoque)
        const blurRow = new Adw.ActionRow({ title: 'Intensidade do Desfoque (Blur)' });
        const blurScale = new Gtk.Scale({
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 1, page_increment: 10, value: settings.get_int('blur-sigma') }),
            value_pos: Gtk.PositionType.RIGHT,
            draw_value: true,
            hexpand: true,
            valign: Gtk.Align.CENTER
        });
        blurScale.set_size_request(200, -1);
        settings.bind('blur-sigma', blurScale.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        blurRow.add_suffix(blurScale);
        group.add(blurRow);

        // Largura Normal
        const normalWidthRow = new Adw.ActionRow({ title: 'Largura Normal (px)' });
        const normalWidthSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({ lower: 50, upper: 400, step_increment: 5, page_increment: 10, value: settings.get_int('normal-width') }),
            valign: Gtk.Align.CENTER
        });
        settings.bind('normal-width', normalWidthSpin.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        normalWidthRow.add_suffix(normalWidthSpin);
        group.add(normalWidthRow);

        // Largura Expandida
        const expandedWidthRow = new Adw.ActionRow({ title: 'Largura Expandida (px)' });
        const expandedWidthSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({ lower: 300, upper: 1000, step_increment: 10, page_increment: 50, value: settings.get_int('expanded-width') }),
            valign: Gtk.Align.CENTER
        });
        settings.bind('expanded-width', expandedWidthSpin.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        expandedWidthRow.add_suffix(expandedWidthSpin);
        group.add(expandedWidthRow);

        // Altura Expandida
        const expandedHeightRow = new Adw.ActionRow({ title: 'Altura Expandida (px)' });
        const expandedHeightSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({ lower: 100, upper: 600, step_increment: 5, page_increment: 10, value: settings.get_int('expanded-height') }),
            valign: Gtk.Align.CENTER
        });
        settings.bind('expanded-height', expandedHeightSpin.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        expandedHeightRow.add_suffix(expandedHeightSpin);
        group.add(expandedHeightRow);

        // Funcionalidades
        const featuresGroup = new Adw.PreferencesGroup({ title: 'Funcionalidades' });
        page.add(featuresGroup);

        const mprisSwitch = new Adw.SwitchRow({ title: 'Mostrar Media Player' });
        settings.bind('show-mpris', mprisSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        featuresGroup.add(mprisSwitch);

        const volumeSwitch = new Adw.SwitchRow({ title: 'Mostrar Info do Sistema e Volume' });
        settings.bind('show-volume', volumeSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        featuresGroup.add(volumeSwitch);

        const statsSwitch = new Adw.SwitchRow({ title: 'Mostrar Estatísticas do Sistema (CPU/RAM/GPU)' });
        settings.bind('show-stats', statsSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        featuresGroup.add(statsSwitch);

        const calendarSwitch = new Adw.SwitchRow({ title: 'Mostrar Calendário' });
        settings.bind('show-calendar', calendarSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        featuresGroup.add(calendarSwitch);

        const clipboardSwitch = new Adw.SwitchRow({ title: 'Mostrar Área de Transferência' });
        settings.bind('show-clipboard', clipboardSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        featuresGroup.add(clipboardSwitch);
        // Hover Settings
        const hoverGroup = new Adw.PreferencesGroup({ title: 'Interação (Hover)' });
        page.add(hoverGroup);

        const hoverExpandSwitch = new Adw.SwitchRow({ 
            title: 'Expandir ao passar o mouse',
            subtitle: 'O docktouch abrirá automaticamente quando o mouse estiver sobre ele.'
        });
        settings.bind('hover-expand', hoverExpandSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        hoverGroup.add(hoverExpandSwitch);

        const hoverDelayRow = new Adw.ActionRow({ 
            title: 'Atraso para expandir (segundos)',
            subtitle: 'Quanto tempo o mouse deve ficar parado sobre o docktouch para abrir.'
        });
        const hoverDelaySpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({ 
                lower: 0.1, 
                upper: 5.0, 
                step_increment: 0.1, 
                page_increment: 0.5, 
                value: settings.get_double('hover-delay') 
            }),
            valign: Gtk.Align.CENTER,
            digits: 1
        });
        settings.bind('hover-delay', hoverDelaySpin.get_adjustment(), 'value', Gio.SettingsBindFlags.DEFAULT);
        hoverDelayRow.add_suffix(hoverDelaySpin);
        hoverGroup.add(hoverDelayRow);

        window.add(page);
    }
}
