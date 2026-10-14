// Shim: the old resolver code shares the server pool (one process, one pg pool).
export { pool } from "../../../../src/db/pool.js";
