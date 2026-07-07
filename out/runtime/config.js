"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readConfig = readConfig;
exports.writeConfig = writeConfig;
/*
 * runtime/config.ts — read/write the project's .dali/config.json, the persisted
 * runtime choice (docker|local), DALi prefix, and default image tag. Located by
 * walking up to the project root (.git/package.json) like the slicer.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sliceSources_1 = require("../sliceSources");
const CONFIG_REL = path.join('.dali', 'config.json');
/** Read `.dali/config.json` from the project root at/above `baseDir`. Never throws;
 *  returns `{}` when the file is absent or malformed, and ignores unknown/ill-typed
 *  fields so a hand-edited config can't break a render. */
function readConfig(baseDir) {
    try {
        const root = (0, sliceSources_1.findProjectRoot)(baseDir);
        const file = path.join(root, CONFIG_REL);
        if (!fs.existsSync(file)) {
            return {};
        }
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (parsed && typeof parsed === 'object') {
            const out = {};
            if (parsed.runtime === 'docker' || parsed.runtime === 'local') {
                out.runtime = parsed.runtime;
            }
            if (typeof parsed.daliPrefix === 'string') {
                out.daliPrefix = parsed.daliPrefix;
            }
            if (typeof parsed.imageTag === 'string') {
                out.imageTag = parsed.imageTag;
            }
            if (typeof parsed.image === 'string') {
                out.image = parsed.image;
            }
            return out;
        }
        return {};
    }
    catch {
        return {};
    }
}
/** Write `.dali/config.json` under `projectRoot` (mkdir -p). Returns the file path. */
function writeConfig(projectRoot, cfg) {
    const dir = path.join(projectRoot, '.dali');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
    return file;
}
