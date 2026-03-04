// Regex syntax highlighting stress test
// Each line should have the regex highlighted as a regex, NOT as a comment/string/etc.

let str = "lol";
let file = "lol.log";
let path = "/usr/bin/share/lol";
let cond = false;
let line = "sleepy.\n";
let x = cond;

// --- Escaped slashes (the original bug) ---
let r1 = match(str, /^.+\//);                    // 1: escaped slash at end
let r2 = replace(file, /^.+\//, '');              // 2: escaped slash before comma
let r3 = match(path, /\/usr\/local\/bin/);        // 3: multiple escaped slashes
let r4 = match(str, /^\//);                       // 4: escaped slash only
let r5 = match(str, /\/\//);                      // 5: two escaped slashes (looks like //)

// --- Patterns that look like comments ---
let r6 = match(str, /\/\/.*/);                    // 6: regex matching // comments
let r7 = match(str, /\/\*.*\*\//);               // 7: regex matching /* block comments */
let r8 = match(str, /\*\//);                      // 8: looks like end of block comment
let r9 = match(str, /\/\*/);                      // 9: looks like start of block comment
let r10 = match(str, /http:\/\/example\.com/);    // 10: URL with //

// --- Character classes with slashes ---
let r11 = match(str, /[/]/);                      // 11: slash in character class
let r12 = match(str, /[^/]+/);                    // 12: negated class with slash
let r13 = match(str, /[a-z/0-9]/);               // 13: slash in range class
let r14 = match(str, /[\/\\]/);                   // 14: escaped slash and backslash in class
let r15 = match(str, /[\/*]/);                    // 15: looks like /* in class

// --- Escaped special characters ---
let r16 = match(str, /\.\*\+\?\[\]\(\)/);        // 16: all escaped metacharacters
let r17 = match(str, /\\\//);                     // 17: escaped backslash then escaped slash
let r18 = match(str, /\\/);                       // 18: escaped backslash at end
let r19 = match(str, /\t\n\r/);                   // 19: escaped whitespace chars
let r20 = match(str, /\x41\x42/);                // 20: hex escapes

// --- Flags ---
let r21 = match(str, /pattern/i);                 // 21: case-insensitive flag
let r22 = match(str, /pattern/g);                 // 22: global flag
let r23 = match(str, /pattern/s);                 // 23: dotall flag
let r24 = match(str, /pattern/gis);              // 24: all flags combined
let r25 = match(str, /^hello$/gi);               // 25: anchors with flags

// --- Various expression contexts ---
let r26 = /simple/;                               // 26: after assignment =
let r27 = (/grouped/);                            // 27: after open paren
let arr = [/in_array/, /second/];                 // 28-29: after [ and after ,
let r30 = !(/negated/);                           // 30: after !
let r31 = x ? /ternary_true/ : /ternary_false/;  // 31-32: after ? and :
let r33 = cond || /fallback/;                     // 33: after ||  (binary op context)

// --- Complex patterns ---
let r34 = match(str, /^@([A-Za-z0-9_-]+)\[(-?[0-9]+)\]$/); // 34: the real-world umap pattern
let r35 = match(str, /(\d{1,3}\.){3}\d{1,3}/);   // 35: IP address pattern
let r36 = match(str, /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/); // 36: MAC address
let r37 = match(str, /(?:https?|ftp):\/\/[^\s]+/); // 37: URL pattern with ://
let r38 = match(line, /^\s*#/);                   // 38: comment line detection
let r39 = match(str, /\b\w+\b/);                 // 39: word boundary pattern
let r40 = match(str, /^$/);                       // 40: empty line pattern

// --- Edge cases for the grammar ---
let r41 = split(str, /\//);                       // 41: split by slash
let r42 = replace(str, /\/+/g, '/');              // 42: collapse multiple slashes
let r43 = match(str, /\/{2,}/);                   // 43: quantifier after escaped slash
let r44 = match(str, /[^\/]+$/);                  // 44: escaped slash in negated class
let r45 = match(str, /^(.*?)\/([^\/]*)$/);        // 45: path splitting regex

// --- Template/brace-like content in regex ---
let r46 = match(str, /\{[0-9]+\}/);              // 46: literal braces (not template)
let r47 = match(str, /\{\{.+\}\}/);              // 47: double braces (looks like {{ }})
let r48 = match(str, /\{%.+%\}/);                // 48: looks like {% %} template tag
let r49 = match(str, /\{#.+#\}/);               // 49: looks like {# #} template comment
let r50 = match(str, /(['"]).*?\1/);              // 50: backreference with quote chars
