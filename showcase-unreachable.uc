// Showcase: Never-Returns Inference & Callback-Aware CFG (0.5.11)
// Open this file in VS Code with ucode-lsp to see faded unreachable code.

// ─────────────────────────────────────────────────────────
// 1. NEVER-RETURNS INFERENCE
// ─────────────────────────────────────────────────────────
// If every path through a function ends in die()/exit(),
// the LSP infers it as "never returns". Callers that invoke
// it get the same unreachable-code treatment as die()/exit().

// This helper always terminates — inferred as never-returning.
function fatal(msg) {
	die("FATAL: " + msg);
}

// Code after fatal() is unreachable, just like after die().
function validate_config(cfg) {
	if (type(cfg) != "object")
		fatal("config must be an object");

	// Still reachable — the fatal() was inside a conditional.
	printf("Config OK: %J\n", cfg);
}

function strict_require(path) {
	let mod = require(path);
	if (!mod)
		fatal("could not load module: " + path);
	return mod;
}

// ── Chained never-returns ──
// outerDie() calls fatal() which calls die().
// The LSP propagates through the chain automatically.
function outerDie(reason) {
	fatal("outer: " + reason);
}

function chained_demo() {
	outerDie("something broke");
	printf("this is dead code\n"); // unreachable (greyed out)
}

// ── Conditional vs. unconditional ──
function maybe_fail(x) {
	if (x < 0)
		fatal("negative value");
	// Returns normally when x >= 0, so NOT inferred as never-returns.
}

function caller_of_maybe_fail() {
	maybe_fail(42);
	printf("still alive\n"); // reachable — maybe_fail can return
}

// ── Multiple exit paths ──
function abort_or_exit(code) {
	if (code == 0)
		exit(0);
	else
		die("non-zero exit: " + code);
}

function after_abort_or_exit() {
	abort_or_exit(1);
	printf("never reached\n"); // unreachable (both branches terminate)
}

// ─────────────────────────────────────────────────────────
// 2. CALLBACK-AWARE CFG
// ─────────────────────────────────────────────────────────
// A return inside a map/filter/sort callback exits the
// callback, NOT the enclosing function. The LSP correctly
// keeps the outer code reachable (no false positives).

function double_all(items) {
	let doubled = map(items, function(x) {
		return x * 2; // exits the callback only
	});
	printf("Doubled: %J\n", doubled); // reachable
	return doubled;
}

function keep_positive(items) {
	let pos = filter(items, function(x) {
		if (x > 0)
			return true;
		return false;
	});
	printf("Positive: %J\n", pos); // reachable
	return pos;
}

function sort_desc(items) {
	sort(items, function(a, b) {
		return b - a;
	});
	printf("Sorted: %J\n", items); // reachable
}

// Arrow-style callbacks work too.
function arrow_map(items) {
	let result = map(items, (x) => x + 1);
	printf("Result: %J\n", result); // reachable
	return result;
}

// ─────────────────────────────────────────────────────────
// 3. COMBINED — both features at once
// ─────────────────────────────────────────────────────────

function process_records(records) {
	if (!records)
		fatal("no records");

	let names = map(records, function(r) {
		if (type(r) != "object")
			fatal("bad record"); // never-returns inside a callback
		return r.name; // (parameter) r: unknown
	});

	printf("Names: %J\n", names); // reachable
	return names;
}
