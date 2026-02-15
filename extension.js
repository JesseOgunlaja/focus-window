// extension.js - GNOME 46 compatible version
'use strict';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

const SETTINGS_ID = 'org.gnome.shell.extensions.focus-window';
const SETTINGS_KEY = 'app-settings';
const SETTINGS_VARIANT = 'aa{sv}';

const appSys = Shell.AppSystem.get_default();
const appWin = Shell.WindowTracker.get_default();

const KeyboardShortcuts = GObject.registerClass(
    {},
    class KeyboardShortcuts extends GObject.Object {
        constructor(params = {}) {
            super(params);
            this.shortcuts = {};

            this.displayConnection = global.display.connect(
                'accelerator-activated',
                (__, action) => {
                    const grabber = this.shortcuts[action];
                    if (grabber) grabber.callback();
                }
            );
        }

        reset() {
            for (let action in this.shortcuts) {
                this.unbind(action);
            }
        }

        destroy() {
            if (this.displayConnection)
                global.display.disconnect(this.displayConnection);

            for (let action in this.shortcuts) {
                this.unbind(action);
            }

            this.shortcuts = {};
            this.displayConnection = null;
        }

        bind(accelerator, callback) {
            const action = global.display.grab_accelerator(
                accelerator,
                Meta.KeyBindingFlags.NONE
            );

            if (action === Meta.KeyBindingAction.NONE) return;

            const name = Meta.external_binding_name_for_action(action);
            Main.wm.allowKeybinding(name, Shell.ActionMode.ALL);

            this.shortcuts[action] = { name, accelerator, callback };
        }

        unbind(action) {
            const grabber = this.shortcuts[action];

            if (grabber) {
                global.display.ungrab_accelerator(action);
                Main.wm.allowKeybinding(grabber.name, Shell.ActionMode.NONE);
                delete this.shortcuts[action];
            }
        }
    }
);

export default class FocusWindowExtension extends Extension {
    enable() {
        this.shortcuts = new KeyboardShortcuts();

        this.settings = this.getSettings(SETTINGS_ID);

        this.settingsListener = this.settings.connect(
            `changed::${SETTINGS_KEY}`,
            () => {
                this.setupShortcuts(
                    this.settings.get_value(SETTINGS_KEY).recursiveUnpack()
                );
            }
        );

        this.setupShortcuts(
            this.settings.get_value(SETTINGS_KEY).recursiveUnpack()
        );
    }

    setupShortcuts(settings) {
        this.shortcuts.reset();

        settings.forEach((setting) => {
            if (setting.keyboardShortcut && setting.applicationToFocus) {
                this.shortcuts.bind(setting.keyboardShortcut, () => {
                    try {
                        const application = appSys.lookup_app(setting.applicationToFocus);
                        if (!application) return false;

                        const appWindows = application.get_windows().filter((window) => {
                            if (!setting.titleToMatch) return true;
                            if (setting.exactTitleMatch)
                                return window.get_title() === setting.titleToMatch;

                            if (typeof window.get_title() !== 'string') return false;

                            return window
                                .get_title()
                                .toLowerCase()
                                .includes(setting.titleToMatch.toLowerCase());
                        });

                        const focused = global.display.get_focus_window();
                        const focusedWindow = focused ? focused.get_id() : null;

                        if (!appWindows.length && setting.launchApplication) {
                            if (!setting.commandLineArguments) {
                                return application.open_new_window(-1);
                            }

                            const context = global.create_app_launch_context(0, -1);
                            const newApplication = Gio.AppInfo.create_from_commandline(
                                application.get_app_info().get_executable() +
                                    ' ' +
                                    setting.commandLineArguments,
                                null,
                                Gio.AppInfoCreateFlags.NONE
                            );

                            newApplication.launch([], context);
                            return true;
                        }

                        if (appWindows.length > 1) {
                            return Main.activateWindow(appWindows[appWindows.length - 1]);
                        }

                        if (
                            appWindows.length === 1 &&
                            focusedWindow !== null &&
                            focusedWindow === appWindows[0].get_id()
                        ) {
                            return appWindows[0].minimize();
                        }

                        if (appWindows.length === 1) {
                            return Main.activateWindow(appWindows[0]);
                        }

                        return false;
                    } catch (error) {
                        console.log('setting trigger failed: ');
                        console.log(error);
                    }
                });
            }
        });
    }

    disable() {
        if (this.shortcuts) {
            this.shortcuts.destroy();
        }

        if (this.settings && this.settingsListener) {
            try {
                this.settings.disconnect(this.settingsListener);
            } catch (e) {}
        }

        this.settingsListener = null;
        this.settings = null;
        this.shortcuts = null;
    }
}
