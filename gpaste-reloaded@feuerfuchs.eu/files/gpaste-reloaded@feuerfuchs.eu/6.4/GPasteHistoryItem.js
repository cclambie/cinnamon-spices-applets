const Lang      = imports.lang;
const St        = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const Pango     = imports.gi.Pango;
const Clutter   = imports.gi.Clutter;

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
        // Pin button (star)

        this._pinLabel = new St.Label({
            text: '☆',
            style_class: 'popup-menu-icon'
        });
        this.pinButton = new St.Button({ 
            child: this._pinLabel,
            style_class: 'popup-menu-item'
        });
        this.pinButton.connect('clicked', Lang.bind(this, this.togglePin));
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
     * Set specified uuid and get respective history item's content
     */
    setUuid: function(uuid) {
        this._uuid = uuid;
        if (uuid != null) {
            this._applet.client.get_element(uuid, (client, result) => {
                const value = client.get_element_finish(result);
                this.label.set_text(value.replace(/[\t\n\r]/g, ''));
                // Query pinned state for this item
                this._queryPinnedState();
            });
            this.actor.show();
        } else {
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
        if (!this._uuid) return;
        
        try {
            this._applet.client.is_pinned(this._uuid, Lang.bind(this, function(client, result) {
                try {
                    this._pinned = client.is_pinned_finish(result);
                    this._updatePinIcon();
                } catch (e) {
                    // IsPinned method may not be available in older GPaste versions
                    this._pinned = false;
                    this._updatePinIcon();
                }
            }));
        } catch (e) {
            // Fallback if is_pinned method doesn't exist
            this._pinned = false;
            this._updatePinIcon();
        }
    },

    /*
     * Update the pin button icon based on pinned state
     */
    _updatePinIcon: function() {
        if (this._pinned) {
            this._pinLabel.set_text('★');
        } else {
            this._pinLabel.set_text('☆');
        }
    },

    /*
     * Toggle the pinned state of this item
     */
    togglePin: function() {
        if (!this._uuid) return;

        const newPinnedState = !this._pinned;
        
        try {
            this._applet.client.set_pinned(this._uuid, newPinnedState, Lang.bind(this, function(client, result) {
                try {
                    client.set_pinned_finish(result);
                    this._pinned = newPinnedState;
                    this._updatePinIcon();
                } catch (e) {
                    global.logError("GPaste: Failed to set pinned state: " + e);
                }
            }));
        } catch (e) {
            global.logError("GPaste: set_pinned method not available: " + e);
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
