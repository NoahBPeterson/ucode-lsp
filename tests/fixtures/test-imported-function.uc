// Test imported function recognition
import { run_command } from '../lib/commands.uc';

// This should NOT show "Undefined function: run_command"
const result = run_command('echo test');
print(result);