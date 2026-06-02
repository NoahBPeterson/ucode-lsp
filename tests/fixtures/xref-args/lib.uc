// Library of exported functions with declared @param contracts, used by
// tests/test-cross-file-args.mocha.js to verify cross-file argument checking.

/**
 * @param {string} name
 * @param {int} count
 */
export function greet(name, count) {
	return name;
}

/** @param {string} a */
function helper(a) {
	return a;
}
export { helper };

/** @param {object} cfg */
export default function (cfg) {
	return cfg;
}
