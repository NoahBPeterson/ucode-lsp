// Large file to test parser performance with substantial code

// Generate many variable declarations
let var1 = "value1";
let var2 = "value2";
let var3 = "value3";
let var4 = "value4";
let var5 = "value5";
let var6 = "value6";
let var7 = "value7";
let var8 = "value8";
let var9 = "value9";
let var10 = "value10";
let var11 = "value11";
let var12 = "value12";
let var13 = "value13";
let var14 = "value14";
let var15 = "value15";
let var16 = "value16";
let var17 = "value17";
let var18 = "value18";
let var19 = "value19";
let var20 = "value20";

// Generate many function declarations
function func1() { return "result1"; }
function func2() { return "result2"; }
function func3() { return "result3"; }
function func4() { return "result4"; }
function func5() { return "result5"; }
function func6() { return "result6"; }
function func7() { return "result7"; }
function func8() { return "result8"; }
function func9() { return "result9"; }
function func10() { return "result10"; }

// Generate nested structures
let data = {
    level1: {
        level2: {
            level3: {
                level4: {
                    level5: {
                        value: "deeply nested"
                    }
                }
            }
        }
    }
};

// Generate large array with complex expressions
let calculations = [
    (1 + 2) * 3 - 4 / 5,
    (6 + 7) * 8 - 9 / 10,
    (11 + 12) * 13 - 14 / 15,
    (16 + 17) * 18 - 19 / 20,
    (21 + 22) * 23 - 24 / 25,
    (26 + 27) * 28 - 29 / 30,
    (31 + 32) * 33 - 34 / 35,
    (36 + 37) * 38 - 39 / 40,
    (41 + 42) * 43 - 44 / 45,
    (46 + 47) * 48 - 49 / 50
];

// Generate many control flow statements
function processLargeDataset(items) {
    let results = [];
    
    for (let i = 0; i < length(items); i++) {
        let item = items[i];
        
        if (item.type == "A") {
            if (item.priority > 5) {
                let processed = {
                    id: item.id,
                    value: item.value * 2,
                    timestamp: time()
                };
                push(results, processed);
            } else {
                let processed = {
                    id: item.id,
                    value: item.value,
                    timestamp: time()
                };
                push(results, processed);
            }
        } else if (item.type == "B") {
            if (item.priority > 3) {
                let processed = {
                    id: item.id,
                    value: item.value * 1.5,
                    timestamp: time()
                };
                push(results, processed);
            }
        } else {
            let processed = {
                id: item.id,
                value: item.value * 0.5,
                timestamp: time()
            };
            push(results, processed);
        }
    }
    
    return results;
}

// Generate many function calls
let result1 = func1();
let result2 = func2();
let result3 = func3();
let result4 = func4();
let result5 = func5();
let result6 = func6();
let result7 = func7();
let result8 = func8();
let result9 = func9();
let result10 = func10();

// Generate complex string operations
let text1 = "The quick brown fox";
let text2 = "jumps over the lazy dog";
let combined = text1 + " " + text2;
let parts1 = split(text1, " ");
let parts2 = split(text2, " ");
let lengths = [length(text1), length(text2), length(combined)];

// Generate many array operations
push(calculations, 100);
push(calculations, 200);
push(calculations, 300);
push(calculations, 400);
push(calculations, 500);

let first = calculations[0];
let last = calculations[length(calculations) - 1];
let middle = calculations[length(calculations) / 2];

// Generate complex object access patterns
let config = {
    database: {
        host: "localhost",
        port: 5432,
        name: "myapp",
        credentials: {
            username: "user",
            password: "secret"
        }
    },
    api: {
        baseUrl: "https://api.example.com",
        version: "v1",
        endpoints: {
            users: "/users",
            posts: "/posts",
            comments: "/comments"
        }
    }
};

let dbHost = config.database.host;
let dbPort = config.database.port;
let apiBase = config.api.baseUrl;
let usersEndpoint = config.api.endpoints.users;