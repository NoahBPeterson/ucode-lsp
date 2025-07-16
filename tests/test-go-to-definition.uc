// Test file for Go to Definition feature
import { run_command } from './lib/commands.uc';
import { get_config_value } from './lib/config.uc';

// Test local function definition
function localFunction() {
    return "local";
}

// Test usage of imported function
function test() {
    run_command("test");           // Should navigate to definition in ./lib/commands.uc
    get_config_value("setting");  // Should navigate to definition in ./lib/config.uc
    
    // Test local function call
    localFunction();  // Should navigate to localFunction above
    
    return "done";
}

// Test variable definition
let myVariable = 42;

function useVariable() {
    return myVariable;  // Should navigate to myVariable definition above
}

test();