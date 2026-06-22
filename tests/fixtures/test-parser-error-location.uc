/**
 * Test file to reproduce parser error on wrong location
 */
    
// More code here
function helper() {
    return 42;
}

/* This block comment is 10 lines away
 * from the stray slash above
 * and the error should NOT appear here
 */
export function generate_bandwidth_overrides() {
    /* Capture timestamp now; append at end */
    let timestamp = time();
    
    /* Another comment
     * with multiple lines
     */
    let data = [];
    
    return {
        timestamp: timestamp,
        data: data
    };
};