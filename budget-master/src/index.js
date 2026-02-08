"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const index_js_1 = require("./api/index.js");
(0, index_js_1.startApi)().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map