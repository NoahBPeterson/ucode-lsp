// Type-encoding reference stub for the `luci.core` C module (LuCI low-level routines).
// The real module is native code — modules/luci-base/src/lib/luci.c in the LuCI tree —
// so there is no ucode source to analyze on a standalone package. Each stub body returns
// a representative value of the C function's actual result type (unions included), so
// cross-file inference reports the true contract. Never executed.

/**
 * Load a translation catalog for a language from a directory of .lmo files.
 * @param {string} [lang] Language code (defaults to "en").
 * @param {string} dir Catalog directory.
 * @returns {boolean} True when the catalog was loaded.
 */
export function load_catalog(lang, dir) {
	return dir != null;
};

/**
 * Close a previously loaded translation catalog.
 * @param {string} [lang] Language code (defaults to "en").
 * @returns {boolean}
 */
export function close_catalog(lang) {
	return true;
};

/**
 * Switch the active translation catalog.
 * @param {string} [lang] Language code (defaults to "en").
 * @returns {boolean} True when the catalog switch succeeded.
 */
export function change_catalog(lang) {
	return lang != null;
};

/**
 * Iterate all loaded translations, invoking `callback(key, value)` for each entry.
 * @param {function} callback Receives the numeric message key and translated string.
 * @returns {boolean}
 */
export function get_translations(callback) {
	return true;
};

/**
 * Translate a message key, optionally within a context.
 * @param {string} key
 * @param {string} [ctx]
 * @returns {string?} The translation, or null when the key has none.
 */
export function translate(key, ctx) {
	return key ? "" : null;
};

/**
 * Translate a singular/plural message pair for a count.
 * @param {integer} count
 * @param {string} singular
 * @param {string} plural
 * @param {string} [ctx]
 * @returns {string?} The translation, or null when the keys have none.
 */
export function ntranslate(count, singular, plural, ctx) {
	return singular ? "" : null;
};

/**
 * Hash a string with the superfast-hash function LuCI uses for message keys.
 * @param {string} key
 * @param {integer} [init] Initial hash value (defaults to the key length).
 * @returns {integer}
 */
export function hash(key, init) {
	return 0;
};

/**
 * Look up a shadow-password entry by user name.
 * @param {string} name
 * @returns {object?} The spwd fields, or null when the user does not exist.
 */
export function getspnam(name) {
	return name ? { namp: "", pwdp: "", lstchg: 0, min: 0, max: 0, warn: 0, inact: 0, expire: 0 } : null;
};

/**
 * Look up a passwd entry by user name.
 * @param {string} name
 * @returns {object?} The passwd fields, or null when the user does not exist.
 */
export function getpwnam(name) {
	return name ? { name: "", passwd: "", uid: 0, gid: 0, gecos: "", dir: "", shell: "" } : null;
};

/**
 * Hash a passphrase with crypt(3) using the given setting/salt string.
 * @param {string} phrase
 * @param {string} setting
 * @returns {string?} The crypt hash, or null on failure.
 */
export function crypt(phrase, setting) {
	return phrase ? "" : null;
};

/**
 * The real user id of the current process.
 * @returns {integer}
 */
export function getuid() {
	return 0;
};

/**
 * The real group id of the current process.
 * @returns {integer}
 */
export function getgid() {
	return 0;
};

/**
 * Set the user id of the current process.
 * @param {integer} uid
 * @returns {boolean} True when the id change succeeded.
 */
export function setuid(uid) {
	return uid >= 0;
};

/**
 * Set the group id of the current process.
 * @param {integer} gid
 * @returns {boolean} True when the id change succeeded.
 */
export function setgid(gid) {
	return gid >= 0;
};

/**
 * Send a signal to a process.
 * @param {integer} pid
 * @param {integer} sig
 * @returns {boolean} True when the signal was delivered.
 */
export function kill(pid, sig) {
	return pid > 0;
};

/**
 * System identification, as from uname(2).
 * @returns {object} sysname/nodename/release/version/machine strings.
 */
export function uname() {
	return { sysname: "", nodename: "", release: "", version: "", machine: "" };
};

/**
 * Overall system statistics, as from sysinfo(2).
 * @returns {object} Uptime, load averages, and memory/swap counters.
 */
export function sysinfo() {
	return {
		uptime: 0, loads: [ 0, 0, 0 ],
		totalram: 0, freeram: 0, sharedram: 0, bufferram: 0,
		totalswap: 0, freeswap: 0, procs: 0, totalhigh: 0, freehigh: 0, mem_unit: 0,
	};
};

/**
 * Filesystem statistics for a path, as from statvfs(3).
 * @param {string} path
 * @returns {object?} The statvfs fields, or null when the path is not statable.
 */
export function statvfs(path) {
	return path ? {
		bsize: 0, frsize: 0, blocks: 0, bfree: 0, bavail: 0,
		files: 0, ffree: 0, favail: 0, fsid: 0, flag: 0, namemax: 0,
	} : null;
};
