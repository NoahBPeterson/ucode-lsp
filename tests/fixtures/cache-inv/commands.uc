'use strict';

export function run_command(cmd) {
    try {
        return "ok-" + cmd;
    } catch (e) {
        return null;
    }
}
