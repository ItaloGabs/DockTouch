import Gio from 'gi://Gio';

const BrightnessIface = `
<node>
  <interface name="org.gnome.SettingsDaemon.Power.Screen">
    <property name="Brightness" type="i" access="readwrite"/>
    <property name="Percentage" type="u" access="readwrite"/>
  </interface>
</node>`;

export const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(BrightnessIface);
