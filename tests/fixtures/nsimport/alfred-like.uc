// Mirrors the user's real case
export const ALFRED_TYPES = {
    HOSTINFO: 64,
    BAT_NEIGHBORS: 65,
    BANDWIDTH: 66,
};
export const SOCKET_PATH = "/var/run/alfred.sock";
export function get_type_name(n) { return "alfred"; }
