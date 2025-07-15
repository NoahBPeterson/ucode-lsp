// Test file with complex syntax patterns to test parser robustness

// Nested functions
function outer(x) {
    function inner(y) {
        return x + y;
    }
    return inner;
}

// Complex expressions
let complex = ((a + b) * (c - d)) / ((e + f) * (g - h));
let chained = obj.prop1.prop2[index].method().result;

// Nested control structures
for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 5; j++) {
        if (i % 2 == 0) {
            if (j > 2) {
                continue;
            } else {
                break;
            }
        }
    }
}

// Switch statement
switch (value) {
    case 1:
        console.log("one");
        break;
    case 2:
    case 3:
        console.log("two or three");
        break;
    default:
        console.log("other");
}

// Complex object with nested structures
let complexObj = {
    users: [
        {
            id: 1,
            name: "Alice",
            settings: {
                theme: "dark",
                notifications: true
            }
        },
        {
            id: 2,
            name: "Bob",
            settings: {
                theme: "light",
                notifications: false
            }
        }
    ],
    config: {
        version: "1.0.0",
        features: ["auth", "api", "ui"]
    }
};

// Function with complex parameter handling
function processData(data, options) {
    let result = [];
    
    for (let item of data) {
        if (options.filter && !options.filter(item)) {
            continue;
        }
        
        let processed = options.transform ? 
            options.transform(item) : 
            item;
            
        push(result, processed);
    }
    
    return result;
}

// Error handling with nested try-catch
try {
    let data = loadData();
    try {
        let processed = processData(data, {
            filter: function(item) { return item.active; },
            transform: function(item) { return item.value; }
        });
        return processed;
    } catch (processingError) {
        console.log("Processing failed: " + processingError);
        return [];
    }
} catch (loadError) {
    console.log("Loading failed: " + loadError);
    return null;
}

// Ternary chain
let status = user.isActive ? 
    (user.isVerified ? "active-verified" : "active-unverified") :
    (user.isSuspended ? "suspended" : "inactive");

// Complex array and object operations
let filtered = data
    .filter(function(item) { return item.score > 80; })
    .map(function(item) { return item.name; })
    .sort();

// Regex and string manipulation
let emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let isValidEmail = match(user.email, emailPattern);
let cleanName = trim(replace(user.name, /[^a-zA-Z\s]/, ""));