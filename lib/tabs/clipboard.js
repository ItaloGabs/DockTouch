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

    const hasItems = ext._clipboardHistory.length > 0 || (ext._pinnedClipboardItems && ext._pinnedClipboardItems.length > 0);

    if (!hasItems) {
        const emptyBox = new St.BoxLayout({ 
            vertical: true, 
            x_expand: true, 
            y_expand: true, 
            style_class: 'empty-drag-box',
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
            style_class: 'drag-scrollview',
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

        const buildItem = (text, index, isPinned) => {
            const item = new St.BoxLayout({ 
                style_class: `drag-item clipboard-item ${isPinned ? 'pinned-item' : ''}`, 
                reactive: true,
                track_hover: true,
                can_focus: true,
                style: `padding: 8px 12px; border-radius: 12px; ${isPinned ? 'border: 1px solid rgba(255, 215, 0, 0.2); background-color: rgba(255, 215, 0, 0.05);' : ''}`
            });
            
            if (isPinned) {
                item.add_child(new St.Icon({ 
                    icon_name: 'starred-symbolic', 
                    icon_size: 10, 
                    style: 'color: #ffd700; margin-right: 6px;',
                    y_align: Clutter.ActorAlign.CENTER
                }));
            }

            const textLabel = new St.Label({ 
                text: text.replace(/\n/g, ' ').substring(0, 100) + (text.length > 100 ? '...' : ''), 
                y_align: Clutter.ActorAlign.CENTER, 
                style_class: 'drag-item-label',
                x_expand: true
            });
            item.add_child(textLabel);
            
            const actions = new St.BoxLayout({ style: 'spacing: 8px;', y_align: Clutter.ActorAlign.CENTER });
            
            // Pin Toggle Button (Hidden by default, shown on hover)
            const pinBtn = new St.Button({ 
                child: new St.Icon({ 
                    icon_name: isPinned ? 'starred-symbolic' : 'semi-starred-symbolic', 
                    icon_size: 14 
                }),
                style_class: 'drag-remove-btn',
                style: isPinned ? 'color: #ffd700;' : 'opacity: 0;',
                visible: isPinned
            });
            
            // Try different icon name if semi-starred-symbolic doesn't exist
            if (!isPinned) {
                pinBtn.child.icon_name = 'non-starred-symbolic';
            }

            if (!isPinned) {
                item.connect('notify::hover', () => {
                    if (item.hover) pinBtn.visible = true;
                    pinBtn.ease({
                        opacity: item.hover ? 255 : 0,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_OUT_QUART,
                        onComplete: () => {
                            if (!item.hover) pinBtn.visible = false;
                        }
                    });
                });
            }

            pinBtn.connect('clicked', () => {
                if (isPinned) {
                    ext._pinnedClipboardItems.splice(index, 1);
                    if (!ext._clipboardHistory.includes(text)) {
                        ext._clipboardHistory.unshift(text);
                    }
                } else {
                    ext._clipboardHistory.splice(index, 1);
                    ext._pinnedClipboardItems.unshift(text);
                }
                ext._saveClipboardHistory();
                ext._updateExpandedContent(true);
            });
            actions.add_child(pinBtn);
            
            const copyBtn = new St.Button({ 
                child: new St.Icon({ icon_name: 'edit-copy-symbolic', icon_size: 14 }),
                style_class: 'drag-remove-btn',
            });
            copyBtn.connect('clicked', () => {
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                ext._lastClipboardText = text;
                if (!isPinned) {
                    ext._clipboardHistory.splice(index, 1);
                    ext._clipboardHistory.unshift(text);
                }
                ext._saveClipboardHistory();
                ext._updateExpandedContent(true);
            });
            actions.add_child(copyBtn);

            const removeBtn = new St.Button({ 
                child: new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 14 }),
                style_class: 'drag-remove-btn',
            });
            removeBtn.connect('clicked', () => {
                if (isPinned) ext._pinnedClipboardItems.splice(index, 1);
                else ext._clipboardHistory.splice(index, 1);
                ext._saveClipboardHistory();
                ext._updateExpandedContent(true);
            });
            actions.add_child(removeBtn);
            
            item.add_child(actions);
            
            item.connect('button-press-event', (actor, event) => {
                if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
                St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                ext._lastClipboardText = text;
                if (!isPinned) {
                    ext._clipboardHistory.splice(index, 1);
                    ext._clipboardHistory.unshift(text);
                }
                ext._saveClipboardHistory();
                ext._updateExpandedContent(true);
                return Clutter.EVENT_STOP;
            });
            
            return item;
        };

        // Render Pinned Items
        if (ext._pinnedClipboardItems && ext._pinnedClipboardItems.length > 0) {
            list.add_child(new St.Label({ 
                text: 'Fixos', 
                style: 'font-size: 9pt; font-weight: bold; color: #ffd700; opacity: 0.6; margin: 4px 0 6px 4px;' 
            }));
            
            ext._pinnedClipboardItems.forEach((text, i) => {
                list.add_child(buildItem(text, i, true));
            });
            
            if (ext._clipboardHistory.length > 0) {
                list.add_child(new St.Label({ 
                    text: 'Recentes', 
                    style: 'font-size: 9pt; font-weight: bold; color: rgba(255,255,255,0.3); margin: 12px 0 6px 4px;' 
                }));
            }
        }

        // Render History Items
        ext._clipboardHistory.forEach((text, i) => {
            list.add_child(buildItem(text, i, false));
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
