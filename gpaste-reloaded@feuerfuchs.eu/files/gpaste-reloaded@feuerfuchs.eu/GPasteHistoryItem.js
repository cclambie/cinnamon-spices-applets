const Lang      = imports.lang;
const St        = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const Pango     = imports.gi.Pango;
const Clutter   = imports.gi.Clutter;
const Gio       = imports.gi.Gio;
const GLib      = imports.gi.GLib;

// D-Bus constants for GPaste daemon
const GPASTE_DBUS_NAME = 'org.gnome.GPaste.Daemon';
const GPASTE_DBUS_PATH = '/org/gnome/GPaste';
const GPASTE_DBUS_INTERFACE = 'org.gnome.GPaste2';

// ------------------------------------------------------------------------------------------------------

function GPasteHistoryItem(text, index) {
    this._init(text, index);
}

GPasteHistoryItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(applet) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);

        this._applet = applet;
        this._pinned = false;

        //
        // Label

        this.label = new St.Label({ text: '' });
        this.label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        this.addActor(this.label);

        this.setTextLength();
        this._settingsChangedID = this._applet.clientSettings.connect('changed::element-size', Lang.bind(this, this.setTextLength));

        //
        // Pin button (star icon)

        this._pinIcon = new St.Icon({
            icon_name:   'non-starred-symbolic',
            icon_type:   St.IconType.SYMBOLIC,
            style_class: 'popup-menu-icon'
        });
        this.pinButton = new St.Button({ child: this._pinIcon });
        this.pinButton.connect('clicked', Lang.bind(this, this._onPinClicked));
        this.addActor(this.pinButton, { expand: false, span: -1, align: St.Align.END });

        //
        // Delete button

        const iconDelete = new St.Icon({
            icon_name:   'edit-delete',
            icon_type:   St.IconType.SYMBOLIC,
            style_class: 'popup-menu-icon'
        });
        this.deleteButton = new St.Button({ child: iconDelete });
        this.deleteButton.connect('clicked', Lang.bind(this, this.remove));
        this.addActor(this.deleteButton, { expand: false, span: -1, align: St.Align.END });

        //
        //

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
    },

    /*
     * Override key press event
     */
    _onKeyPressEvent: function(actor, event) {
        let symbol = event.get_key_symbol();

        if (symbol == Clutter.KEY_space || symbol == Clutter.KEY_Return) {
            this.activate(event);
            return true;
        } else if (symbol == Clutter.KEY_Delete || symbol == Clutter.KEY_BackSpace) {
            this.remove();
            return true;
        }

        return false;
    },

    /*
     * Set max text length using GPaste's setting
     */
    setTextLength: function() {
        this.label.clutter_text.set_max_length(this._applet.clientSettings.get_element_size());
    },

    /*
     * Set specified index and get respective history item's content
     */
    setIndex: function(index) {
        this._index = index;

        if (index != -1) {
            this._applet.client.get_element_at_index(index, Lang.bind(this, function (client, result) {
                let item = client.get_element_at_index_finish(result);
                this._uuid = item.get_uuid();
                this.label.set_text(item.get_value().replace(/[\t\n\r]/g, ''));
                // Query pinned state for this item
                this._queryPinnedState();
            }));

            this.actor.show();
        }
        else {
            this.actor.hide();
        }
    },

    /*
     * Refresh history item's content
     */
    refresh: function() {
            this._applet.client.get_element_at_index(this._index, Lang.bind(this, function(client, result) {
                let item = client.get_element_at_index_finish(result);
                this._uuid = item.get_uuid();
                this.label.set_text(item.get_value().replace(/[\t\n\r]/g, ''));
                // Query pinned state for this item
                this._queryPinnedState();
            }));
        },

    /*
     * Query the pinned state from GPaste daemon via D-Bus
     */
    _queryPinnedState: function() {
        if (!this._uuid) {
            return;
        }
        
        try {
            // Make direct D-Bus call to IsPinned method
            Gio.DBus.session.call(
                GPASTE_DBUS_NAME,
                GPASTE_DBUS_PATH,
                GPASTE_DBUS_INTERFACE,
                'IsPinned',
                new GLib.Variant('(s)', [this._uuid]),
                GLib.VariantType.new('(b)'),
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                Lang.bind(this, function(connection, result) {
                    try {
                        let reply = connection.call_finish(result);
                        this._pinned = reply.deep_unpack()[0];
                        this._updatePinIcon();
                    } catch (e) {
                        // IsPinned method may not be available in older GPaste versions
                        this._pinned = false;
                        this._updatePinIcon();
                    }
                })
            );
        } catch (e) {
            // Fallback if D-Bus call fails
            this._pinned = false;
            this._updatePinIcon();
        }
    },

    /*
     * Update the pin button icon based on pinned state
     */
    _updatePinIcon: function() {
        if (this._pinned) {
            this._pinIcon.set_icon_name('starred-symbolic');
        } else {
            this._pinIcon.set_icon_name('non-starred-symbolic');
        }
    },

    /*
     * Handle pin button click
     */
    _onPinClicked: function() {
        global.log("GPaste: Pin button clicked, uuid=" + this._uuid);
        this.togglePin();
    },

    /*
     * Toggle the pinned state of this item
     */
    togglePin: function() {
        if (!this._uuid) {
            return;
        }

        const newPinnedState = !this._pinned;
        
        try {
            // Make direct D-Bus call to SetPinned method
            Gio.DBus.session.call(
                GPASTE_DBUS_NAME,
                GPASTE_DBUS_PATH,
                GPASTE_DBUS_INTERFACE,
                'SetPinned',
                new GLib.Variant('(sb)', [this._uuid, newPinnedState]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                Lang.bind(this, function(connection, result) {
                    try {
                        connection.call_finish(result);
                        this._pinned = newPinnedState;
                        this._updatePinIcon();
                    } catch (e) {
                        global.logError("GPaste: Failed to set pinned state: " + e);
                    }
                })
            );
        } catch (e) {
            global.logError("GPaste: SetPinned D-Bus call failed: " + e);
        }
    },
    
    /*
     * Remove history item
     */
    remove: function() {
        this._applet.client.delete(this._uuid, null);
    },

    //
    // Events
    // ---------------------------------------------------------------------------------

    /*
     * History item has been removed, disconnect bindings
     */
    _onDestroy: function() {
        this._applet.clientSettings.disconnect(this._settingsChangedID);
    },

    //
    // Overrides
    // ---------------------------------------------------------------------------------

    /*
     * Select history item
     */
    activate: function(event) {
        this._applet.client.select(this._uuid, null);
        this._applet.menu.toggle();
    }
};
