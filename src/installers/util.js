const fs = require("fs");
const path = require("path");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function hookScriptPath(name) {
  return path.join(__dirname, "..", "hook-scripts", `${name}.js`);
}

module.exports = { readJson, writeJson, hookScriptPath };
