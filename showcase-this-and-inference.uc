//'use strict';

// ── 1. this.property inference ──────────────────────────────────────

const pkg = {
	name: 'myapp',
	version: '2.1.0',
	config_file: '/etc/config/myapp',
	chains_list: 'forward output prerouting',
	retry_count: 3,
	enabled: true,
	url: function(fragment) {
		// BEFORE: this.name → unknown, this.version → unknown
		//         split(this.version) warned "unknown arg"
		//         sprintf warned about unknown args
		// AFTER:  this.name → string, this.version → string
		//         no warnings on split() or sprintf()
		return sprintf("https://docs.example.com/%s/%s/%s",
			this.name,
			split(this.version, '-')[0],
			fragment || '');
	},
	describe: function() {
		// Multiple this.property accesses with different types
		// BEFORE: all unknown
		// AFTER:  this.name → string, this.retry_count → integer, this.enabled → boolean
		return sprintf("%s (retries=%d, enabled=%s)",
			this.name,
			this.retry_count,
			this.enabled ? 'yes' : 'no');
	},
};

// ── 2. Nested object this ───────────────────────────────────────────

const outer = {
	label: 'outer',
	inner: {
		label: 'inner',
		get_label: function() {
			// this refers to inner, not outer
			// BEFORE: this.label → unknown
			// AFTER:  this.label → string
			return this.label;
		},
	},
	get_label: function() {
		// this refers to outer
		return this.label;
	},
};
print(outer.inner.get_label()); // "inner"
print(outer.get_label());       // "outer"

// ── 3. this.method reference ────────────────────────────────────────

const calculator = {
	value: 0,
	add: function(n) {
		this.value = this.value + n;
		// this.value → integer, this.reset → function
		return this.value;
	},
	reset: function() {
		this.value = 0;
	},
	run: function() {
		let fn = this.reset; // highlighted like member variable, but is function
		// BEFORE: this.reset → unknown
		// AFTER:  this.reset → function
		fn();
		return this.add(42);
	},
};

// ── 4. this.property passed to builtins (no false warnings) ────────

const list_manager = {
	items: [1, 2, 3],
	separator: ',',
	get_size: function() {
		// BEFORE: length(this.items) warned "unknown arg"
		// AFTER:  this.items → array, no warning
		return length(this.items);
	},
	join_items: function() {
		// BEFORE: join(this.separator, this.items) warned twice
		// AFTER:  no warnings
		return join(this.separator, this.items);
	},
};

// ── 5. Arrow function: this is null (ucode behavior) ───────────────

const obj_arrow = {
	name: 'test',
	// Arrow functions do NOT bind this in ucode — this is null
	broken: () => {
		// this is null here, NOT obj_arrow
		// Hovering this should show unknown, not object
		return this;
	},
	// Regular function DOES bind this
	working: function() {
		return this.name; // → string
	},
};

// ── 6. unknown args to builtins now warned ─────────────────────────

function process_input(x) {
	// x is unknown — builtins should warn
	let parts = split(x, ',');     // WARNING: Argument 1 of split() is unknown // (variable) parts: array | null
	let len = length(x);           // WARNING: Argument 1 of length() is unknown
	let idx = index(x, 'needle');  // WARNING: Argument 1 of index() is unknown
	let trimmed = trim(x);         // WARNING: Argument 1 of trim() is unknown
	print(parts, len, idx, trimmed);
}

// ── 7. Known types suppress warnings ───────────────────────────────

function process_string(s) {
	if (type(s) != 'string')
		return;
	// After type guard: s is narrowed to string
	let parts = split(s, ',');     // No warning — s is string
	let len = length(s);           // No warning
	let idx = index(s, 'needle');  // No warning
	let trimmed = trim(s);         // No warning
	print(parts, len, idx, trimmed);
}

// ── 8. split() always returns array<string> ────────────────────────

let input = "a,b,c";
let parts = split(input, ',');
// BEFORE: parts → array | null
// AFTER:  parts → array<string>
// No nullable-argument warning when passed to length():
let count = length(parts);
print(count);
