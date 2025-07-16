
function getScore(difficulty) {
    if (difficulty == "easy") {
        return 10;
    } else if (difficulty == "hard") {
        return 20.5;
    } else {
        return null;
    }
}

function checkValue(input) {
    if (input == 42) {
        return "magic";
    } else {
        return input;
    }
}

let x = 5;
let name = "test";
let price = 29.99;
let isActive = true;
