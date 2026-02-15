// prefs.js - GNOME 46 programmatic UI (fixed off-by-one)
'use strict';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

const SETTINGS_ID = 'org.gnome.shell.extensions.focus-window';
const SETTINGS_KEY = 'app-settings';
const SETTINGS_VARIANT = 'aa{sv}';

function createId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function convertToVariant(arr) {
    return arr.map((obj) =>
        Object.keys(obj).reduce((acc, key) => {
            if (typeof obj[key] === 'string')
                acc[key] = new GLib.Variant('s', obj[key]);
            if (typeof obj[key] === 'boolean')
                acc[key] = new GLib.Variant('b', obj[key]);
            if (typeof obj[key] === 'number')
                acc[key] = new GLib.Variant('u', obj[key]);
            return acc;
        }, {})
    );
}

function generateSettings(settings) {
    const getAllSettings = () =>
        settings.get_value(SETTINGS_KEY).recursiveUnpack();

    const setAllSettings = (data) => {
        settings.set_value(
            SETTINGS_KEY,
            new GLib.Variant(SETTINGS_VARIANT, data)
        );
        settings.apply();
    };

    const getSettings = (id) => () => getAllSettings().find((s) => s.id === id);

    const setSettings = (id) => (data) => {
        const oldSettings = getAllSettings();
        const curSettings = getSettings(id)();

        let newSettings;

        if (curSettings !== undefined && data) {
            newSettings = oldSettings.map((item) =>
                item.id === id ? data : item
            );
        }

        if (curSettings !== undefined && !data) {
            newSettings = oldSettings.filter((item) => item.id !== id);
        }

        if (!curSettings && data) {
            newSettings = [...oldSettings, data];
        }

        if (!curSettings && !data) {
            newSettings = oldSettings;
        }

        if (newSettings === undefined) newSettings = oldSettings;

        if (newSettings.length === 0) return settings.reset(SETTINGS_KEY);

        return setAllSettings(convertToVariant(newSettings));
    };

    return {
        getAllSettings,
        setAllSettings,
        getSettings,
        setSettings,
    };
}

function createFocusRow(setSettings, onDelete, id, initialSettings, setOnNew) {
    const settings = { ...initialSettings, id };
    if (setOnNew) setSettings(settings);

    const row = new Adw.ExpanderRow({ title: 'Application Not Selected', subtitle: 'Not Bound' });

    // Get all applications
    const allApps = Gio.AppInfo.get_all()
        .filter(a => a.should_show())
        .sort((a, b) => a.get_name().localeCompare(b.get_name()));

    // Create app list with a placeholder at index 0
    const appList = new Gtk.StringList();
    appList.append('No App Selected');
    allApps.forEach(a => appList.append(a.get_name()));

    // Map real apps to indices (1-based)
    const appMap = new Map();
    allApps.forEach((a, i) => appMap.set(i + 1, { id: a.get_id(), name: a.get_name() }));

    const appCombo = new Adw.ComboRow({
        title: 'Application to Focus',
        subtitle: 'The application that should be focused',
        model: appList,
    });

    // Title Entry
    const titleEntry = new Gtk.Entry({
        placeholder_text: 'Window Title',
        valign: Gtk.Align.CENTER,
    });
    const titleRow = new Adw.ActionRow({
        title: 'Title to Match',
        subtitle: 'An optional title to filter application windows',
        activatable_widget: titleEntry,
    });
    titleRow.add_suffix(titleEntry);
    titleEntry.set_hexpand(true);

    // Exact Title Switch
    const exactSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, active: false });
    const exactRow = new Adw.ActionRow({
        title: 'Exact Title Match',
        subtitle: 'Toggle this on if an exact title match is desired',
        activatable_widget: exactSwitch,
    });
    exactRow.add_suffix(exactSwitch);

    // Launch Application Switch
    const launchSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER, active: true });
    const launchRow = new Adw.ActionRow({
        title: 'Launch Application',
        subtitle: 'Toggle this on if the application should be launched when no windows are found',
        activatable_widget: launchSwitch,
    });
    launchRow.add_suffix(launchSwitch);

    // Keyboard Shortcut
    const shortcutLabel = new Gtk.ShortcutLabel({
        valign: Gtk.Align.CENTER,
        disabled_text: 'Not Bound',
        accelerator: '',
    });
    const shortcutRow = new Adw.ActionRow({
        title: 'Keyboard Shortcut',
        subtitle: 'The keyboard shortcut that focuses the application.\nPress Esc to cancel or Backspace to unbind the shortcut.',
        activatable_widget: shortcutLabel,
    });
    shortcutRow.add_suffix(shortcutLabel);

    // Add all children to the expander row
    row.add_row(appCombo);
    row.add_row(titleRow);
    row.add_row(exactRow);
    row.add_row(launchRow);
    row.add_row(shortcutRow);

    // Delete button
    const deleteButton = new Gtk.Button({
        has_frame: false,
        valign: Gtk.Align.CENTER,
        child: new Adw.ButtonContent({
            'icon-name': 'app-remove-symbolic',
            label: '',
        }),
    });
    deleteButton.get_child().add_css_class('error');
    row.add_action(deleteButton);

    // State
    let keyboardIsGrabbed = false;
    let lastAccelerator = '';

    // Set initial values
    const savedAppId = settings.applicationToFocus;
    const savedAppIndex = savedAppId ? allApps.findIndex(a => a.get_id() === savedAppId) : -1;
    // savedAppIndex is 0-based among real apps; add 1 to skip placeholder
    appCombo.set_selected(savedAppIndex !== -1 ? savedAppIndex + 1 : 0);

    titleEntry.set_text(settings.titleToMatch || '');
    exactSwitch.set_active(!!settings.exactTitleMatch);
    launchSwitch.set_active(settings.launchApplication !== false);
    shortcutLabel.set_accelerator(settings.keyboardShortcut || '');

    // Update row title/subtitle based on current settings
    function updateRowDisplay() {
        const appId = settings.applicationToFocus;
        const app = allApps.find(a => a.get_id() === appId);
        row.set_title(app ? app.get_name() : 'Application Not Selected');
        row.set_subtitle(settings.keyboardShortcut || 'Not Bound');
        if (app && settings.keyboardShortcut) {
            row.remove_css_class('warning');
        } else {
            row.add_css_class('warning');
        }
    }

    function saveSettings() {
        setSettings(settings);
        updateRowDisplay();
    }

    // Keyboard shortcut handling
    const keyController = new Gtk.EventControllerKey();
    keyController.connect('key-pressed', (c, key, keycode, state) => {
        if (keyboardIsGrabbed) {
            const mods = state & Gtk.accelerator_get_default_mod_mask();

            if (key === Gdk.KEY_Escape) {
                cancelKeyboardGrab();
            } else if (key === Gdk.KEY_BackSpace) {
                lastAccelerator = '';
                settings.keyboardShortcut = '';
                shortcutLabel.set_accelerator('');
                saveSettings();
                cancelKeyboardGrab();
            } else if (
                Gtk.accelerator_valid(key, mods) ||
                key === Gdk.KEY_Tab ||
                key === Gdk.KEY_ISO_Left_Tab ||
                key === Gdk.KEY_KP_Tab
            ) {
                const accelerator = Gtk.accelerator_name(key, mods);
                lastAccelerator = accelerator;
                settings.keyboardShortcut = accelerator;
                shortcutLabel.set_accelerator(accelerator);
                saveSettings();
                cancelKeyboardGrab();
            }
            return true;
        }
        return false;
    });
    shortcutRow.add_controller(keyController);

    const focusController = new Gtk.EventControllerFocus();
    focusController.connect('leave', () => {
        cancelKeyboardGrab();
    });
    shortcutRow.add_controller(focusController);

    function grabKeyboard() {
        shortcutLabel.get_root().get_surface().inhibit_system_shortcuts(null);
        keyboardIsGrabbed = true;
        lastAccelerator = shortcutLabel.get_accelerator();
        shortcutLabel.set_accelerator('');
        shortcutLabel.set_disabled_text('Listening For Shortcut...');
    }

    function cancelKeyboardGrab() {
        shortcutLabel.get_root().get_surface().restore_system_shortcuts();
        keyboardIsGrabbed = false;
        shortcutLabel.set_accelerator(lastAccelerator);
        shortcutLabel.set_disabled_text('Not Bound');
        shortcutRow.get_parent()?.unselect_all();
    }

    // Signal connections
    appCombo.connect('notify::selected', () => {
        const pos = appCombo.get_selected();
        if (pos === 0) {
            settings.applicationToFocus = '';
        } else {
            const app = appMap.get(pos);
            settings.applicationToFocus = app ? app.id : '';
        }
        saveSettings();
    });

    titleEntry.connect('notify::text', () => {
        settings.titleToMatch = titleEntry.get_text() || '';
        saveSettings();
    });

    exactSwitch.connect('notify::active', () => {
        settings.exactTitleMatch = exactSwitch.get_active();
        saveSettings();
    });

    launchSwitch.connect('notify::active', () => {
        settings.launchApplication = launchSwitch.get_active();
        saveSettings();
    });

    shortcutRow.connect('activated', () => {
        if (keyboardIsGrabbed) {
            cancelKeyboardGrab();
        } else {
            grabKeyboard();
        }
    });

    deleteButton.connect('clicked', () => {
        setSettings(); // remove from settings
        onDelete();
    });

    updateRowDisplay();
    return row;
}

export default class FocusWindowPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const focusWidgets = [];

        const settings = this.getSettings(SETTINGS_ID);
        const { getAllSettings, setSettings } = generateSettings(settings);

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup();
        page.add(group);
        window.add(page);
        window.set_margin_bottom(10);
        window.set_margin_top(10);
        window.set_margin_start(5);
        window.set_margin_end(5);

        const addButton = new Gtk.Button({ valign: Gtk.Align.CENTER });
        const addContent = new Adw.ButtonContent({
            'icon-name': 'list-add-symbolic',
            label: 'Add Application',
        });
        addButton.add_css_class('suggested-action');
        group.set_header_suffix(addButton);
        addButton.set_child(addContent);

        const setTitleAndDescription = () => {
            group.set_title(
                `${focusWidgets.length} Shortcut${
                    focusWidgets.length === 1 ? '' : 's Created'
                }`
            );

            const configured = focusWidgets.filter(
                (item) =>
                    item.settings?.applicationToFocus &&
                    item.settings?.keyboardShortcut
            ).length;

            group.set_description(
                `${
                    configured === focusWidgets.length ? 'All' : configured
                } of which are fully configured`
            );
        };

        const onDelete = (id) => () => {
            const index = focusWidgets.findIndex((i) => i.id === id);
            if (index < 0) return;

            group.remove(focusWidgets[index].row);
            focusWidgets.splice(index, 1);
            setTitleAndDescription();
        };

        getAllSettings().forEach((savedSettings) => {
            // Only create row if it has an ID (should always be true, but safety)
            if (!savedSettings.id) return;
            const row = createFocusRow(
                setSettings(savedSettings.id),
                onDelete(savedSettings.id),
                savedSettings.id,
                savedSettings,
                false
            );
            focusWidgets.push({ id: savedSettings.id, row, settings: savedSettings });
            group.add(row);
        });

        setTitleAndDescription();

        addButton.connect('clicked', () => {
            const id = createId();
            const row = createFocusRow(
                setSettings(id),
                onDelete(id),
                id,
                {
                    id,
                    applicationToFocus: '',
                    titleToMatch: '',
                    exactTitleMatch: false,
                    launchApplication: true,
                    keyboardShortcut: '',
                },
                true
            );
            focusWidgets.push({ id, row, settings: { id } });
            group.add(row);
            setTitleAndDescription();
        });
    }
}
