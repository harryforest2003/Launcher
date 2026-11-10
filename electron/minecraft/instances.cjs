const fs = require("fs");
const path = require("path");

const instanceFile = path.join(
    process.cwd(),
    "src/data/instances.json"
);

function loadInstances() {
    if (!fs.existsSync(instanceFile)) {
        return [];
    }

    return JSON.parse(fs.readFileSync(instanceFile));
}

function saveInstances(instances) {
    fs.writeFileSync(
        instanceFile,
        JSON.stringify(instances, null, 2)
    );
}

module.exports = {
    loadInstances,
    saveInstances,
};