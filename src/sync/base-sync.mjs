/**
 * BaseSync — abstract base class for third-party data synchronization.
 *
 * Subclass this to implement sync targets like Feishu, Notion, Google Sheets, etc.
 *
 * Usage:
 *   class MySync extends BaseSync {
 *     async authenticate() { ... }
 *     async upsertRecords(tableId, records, keyField) { ... }
 *     async fetchExistingRecords(tableId, keyField) { ... }
 *   }
 */

export class BaseSync {
  /**
   * @param {object} config - Sync target configuration (tokens, table IDs, etc.)
   */
  constructor(config = {}) {
    this.config = config;
    this.authenticated = false;
  }

  /**
   * Authenticate with the target service.
   * Should set this.authenticated = true on success.
   * @returns {Promise<void>}
   */
  async authenticate() {
    throw new Error("Subclass must implement authenticate()");
  }

  /**
   * Upsert (insert or update) records into a table.
   *
   * @param {string}   tableId    - Target table/sheet identifier
   * @param {Array<object>} records - Array of record objects
   * @param {string}   keyField   - Field name used as unique key for upsert matching
   * @returns {Promise<{created: number, updated: number, skipped: number}>}
   */
  async upsertRecords(tableId, records, keyField) {
    throw new Error("Subclass must implement upsertRecords()");
  }

  /**
   * Fetch existing records from a table (for diffing before upsert).
   *
   * @param {string} tableId  - Target table/sheet identifier
   * @param {string} keyField - Field name to use as key
   * @returns {Promise<Map<string, object>>} Map of key → record
   */
  async fetchExistingRecords(tableId, keyField) {
    throw new Error("Subclass must implement fetchExistingRecords()");
  }

  /**
   * Ensure authentication before any operation.
   */
  async ensureAuth() {
    if (!this.authenticated) {
      await this.authenticate();
    }
  }

  /**
   * Utility: batch upsert with progress logging.
   *
   * @param {string} label
   * @param {string} tableId
   * @param {Array<object>} records
   * @param {string} keyField
   */
  async syncTable(label, tableId, records, keyField) {
    await this.ensureAuth();

    if (!records.length) {
      console.log(`[sync] ${label}: no records to sync`);
      return { created: 0, updated: 0, skipped: 0 };
    }

    console.log(`[sync] ${label}: syncing ${records.length} records...`);
    const result = await this.upsertRecords(tableId, records, keyField);
    console.log(`[sync] ${label}: ✅ created=${result.created} updated=${result.updated} skipped=${result.skipped}`);
    return result;
  }
}
