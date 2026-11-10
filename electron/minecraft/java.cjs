const { execSync } = require("child_process");

function findJava() {
    try {
        execSync("java -version");

        return "java";
    } catch {
        return null;
    }
}

module.exports = {
    findJava,
};
