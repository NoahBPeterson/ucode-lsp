// Showcase: Unreachable Code Detection (UC4001)
// Unreachable code should appear faded (greyed out) in VS Code

// === After return ===
function after_return() {
	let x = 1;
	return x;
	let y = 2;       // unreachable
	printf("%d\n", y); // unreachable
}

// === After break ===
function after_break() {
	while (true) {
		printf("loop\n");
		break;
		printf("never\n"); // unreachable
	}
}

// === After continue ===
function after_continue() {
	for (let i = 0; i < 10; i++) {
		if (i == 5)  {
			continue;
			printf("skipped\n"); // unreachable
		}
		printf("%d\n", i);
	}
}

// === After die() ===
function after_die() {
	die("fatal error");
	printf("never printed\n"); // unreachable
}

// === After exit() ===
function after_exit() {
	exit(1);
	printf("goodbye\n"); // unreachable
}

// === Return type narrowing ===
// Hover over the function name to see the return type.
// The unreachable "return" is excluded from type inference.

// Hover: returns int (not int | string)
function narrowed_return() {
	return 42;
	return "unreachable string"; // unreachable — excluded from return type
}

// Hover: returns string (not string | array)
function narrowed_after_die() {
	return "ok";
	die("fatal");
	return [1, 2, 3]; // unreachable — excluded from return type
}

// Compare: both returns are reachable, so hover shows string | int
function both_reachable(x) {
	if (x)
		return "hello";
	return 99;
}

// === NO false positives - these should all be clean ===

function conditional_return(x) {
	if (x > 0)
		return "positive";

	return "non-positive"; // reachable via else path
}

function normal_flow() {
	let a = 1;
	let b = 2;
	let c = a + b;
	printf("sum = %d\n", c);
	return c;
}

function if_else_branches(x) {
	if (x) {
		printf("truthy\n");
	} else {
		printf("falsy\n");
	}
	printf("after if/else\n"); // reachable from both branches
}
