// SPDX-License-Identifier: Apache-2.0
import pg from "pg";
import { auditContext } from "./log.js";

/** Preserve pg's callback/promise API while binding audit identity with SET LOCAL.
 * Explicit transactions keep their boundary; isolated writes get a transaction
 * so their row trigger and identity commit together. Reads stay ordinary reads.
 */
export class AuditClient extends pg.Client {
  private auditTransaction = false;
  private auditTail: Promise<void> = Promise.resolve();

  override query(...args: any[]): any {
    const input = args[0];
    const sql = typeof input === "string" ? input : input?.text;
    if (typeof sql !== "string") return (pg.Client.prototype.query as any).apply(this, args);
    const context = auditContext.getStore();
    const command = sql.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/, "");
    const begin = /^BEGIN\b|^START\s+TRANSACTION\b/i.test(command);
    const end = /^(COMMIT|END)\b|^ROLLBACK(?!\s+TO)\b/i.test(command);
    const write = /^(INSERT|UPDATE|DELETE|WITH|CALL)\b/i.test(command);
    if (!context && !this.auditTransaction && !begin) {
      return (pg.Client.prototype.query as any).apply(this, args);
    }
    if (!begin && !end && (!context || this.auditTransaction || !write)) {
      return (pg.Client.prototype.query as any).apply(this, args);
    }
    const callback = typeof args.at(-1) === "function" ? args.pop() : undefined;
    const raw = (...values: any[]): Promise<any> => (pg.Client.prototype.query as any).apply(this, values);
    const bind = () => raw("SELECT set_config('infinite_brain.audit', $1, true)", [JSON.stringify(context ?? {})]);
    const run = async () => {
      if (begin) {
        const result = await raw(...args);
        this.auditTransaction = true;
        try { await bind(); } catch (error) {
          await raw("ROLLBACK"); this.auditTransaction = false; throw error;
        }
        return result;
      }
      if (end) {
        try { return await raw(...args); } finally { this.auditTransaction = false; }
      }
      await raw("BEGIN");
      try {
        await bind();
        const result = await raw(...args);
        await raw("COMMIT");
        return result;
      } catch (error) {
        await raw("ROLLBACK"); throw error;
      }
    };
    // A client may receive parallel independent writes (pg supports queuing).
    // Keep the implicit transaction wrappers from nesting or committing each other.
    const pending = this.auditTail.then(run);
    this.auditTail = pending.then(() => undefined, () => undefined);
    if (callback) { void pending.then((result) => callback(null, result), callback); return; }
    return pending;
  }
}
