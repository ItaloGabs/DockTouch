import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

export function buildClipboardTab(ext, columns) {
    const panel = new St.BoxLayout({ 
        style_class: 'widget-panel clipboard-tab-content', 
        vertical: true, 
        x_expand: true,
        y_expand: true 
    });
    columns.add_child(panel);

    if (ext._clipboardHistory.length === 0) {
        const emptyBox = new St.BoxLayout({ 
            vertical: true, 
            x_expand: true, 
            y_expand: true, 
            style_class: 'empty-drag-box', // Reusing style for consistency
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER
        });
        emptyBox.add_child(new St.Icon({ 
            icon_name: 'edit-copy-symbolic', 
            icon_size: 48,
            style_class: 'empty-drag-icon'
        }));
        emptyBox.add_child(new St.Label({
            text: 'Sua área de transferência está vazia',
            style_class: 'empty-drag-label'
        }));
        panel.add_child(emptyBox);
    } else {
        const scroll = new St.ScrollView({
            style_class: 'drag-scrollview', // Reusing style
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true
        });
        
        scroll.get_vscroll_bar().get_adjustment().connect('notify::value', () => {
            ext._lastScrollTime = GLib.get_monotonic_time();
        });

        const list = new St.BoxLayout({ vertical: true, style_class: 'drag-list', style: 'spacing: 8px;' });
        scroll.set_child(list);
        panel.add_child(scroll);

        ext._clipboardHistory.forEach((text, index) => {
            const item = new St.BoxLayout({ 
                style_class: 'drag-item clipboard-item', 
                reactive: true,
                track_hover: true,
                can_focus: true,
                style: 'padding: 8px; border-radius: 8px;'
            });
            
            const textLabel = new St.Label({ 
                text: text.replace(/\n/g, ' ').substring(0, 100) + (text.length > 100 ? '...' : ''), 
                y_align: Clutter.ActorAlign.CENTER, 
                style_class: 'drag-item-label',
                x_expand: true
            });
            item.add_child(textLabel);
            
            const actions = new St.BoxLayout({ style: 'spacing: 4px;' });
            
            const copyBtn = new St.Button({ 
                child: new St.Icon({ icon_name: 'edit-copy-symbolic', icon_size: 14 }),
                style_class: 'drag-remove-btn', // Reusing style for button look
            });
            copyBtn.connect('clicked', () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                ext._lastClipboardText = text; // Prevent re-adding to history
                // Move to top
                ext._clipboardHistory.splice(index, 1);
                ext._clipboardHistory.unshift(text);
                ext._saveClipboardHistory();
                ext._updateExpandedContent(true);
            });
            actions.add_child(copyBtn);

            const removeBtn = new St.Button({ 
                child: new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 14 }),
                style_class: 'drag-remove-btn',
            });
            removeBtn.connect('clicked', () => {
                ext._clipboardHistory.splice(index, 1);
                ext._saveClipboardHistory();
                ext._updateExpandedContent(true);
            });
            actions.add_child(removeBtn);
            
            item.add_child(actions);
            
            item.connect('button-press-event', () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                ext._lastClipboardText = text;
                ext._clipboardHistory.splice(index, 1);
                ext._clipboardHistory.unshift(text);
                ext._saveClipboardHistory();
                ext._updateExpandedContent(true);
            });
            
            list.add_child(item);
        });

        const clearBtn = new St.Button({
            label: 'Limpar Histórico',
            style_class: 'clear-all-btn',
            x_expand: true
        });
        clearBtn.connect('clicked', () => {
            ext._clipboardHistory = [];
            ext._saveClipboardHistory();
            ext._updateExpandedContent(true);
        });
        panel.add_child(clearBtn);
    }
}
