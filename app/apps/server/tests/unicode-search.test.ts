import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { pool } from "../src/db/pool.js";
import { indexDoc, searchNoteIndex } from "../src/index/indexer.js";
import { appendUpdate } from "../src/yjs/persistence.js";
import { resetDb } from "./helpers/db.js";
import { seedOrg, seedVault, seedNote } from "./helpers/seed.js";

describe("Unicode note search", () => {
  beforeEach(async () => resetDb());
  afterAll(async () => pool.end());

  it("finds Korean substrings, rejects unrelated queries, and keeps English matching", async () => {
    const org = await seedOrg("Unicode Search", "unicode-search");
    const vaultId = await seedVault(org);
    const korean = await seedNote(vaultId, null, "한글노트.md");
    const english = await seedNote(vaultId, null, "English.md");
    const write = async (docId: string, body: string) => {
      const doc = new Y.Doc();
      doc.getText("content").insert(0, body);
      await appendUpdate(docId, Y.encodeStateAsUpdate(doc));
      doc.destroy();
      await indexDoc(docId);
    };
    await write(korean, "검색기능과 한국어검색을 테스트합니다");
    await write(english, "Quick brown fox database running café");
    const search = (query: string) => searchNoteIndex({
      vaultId,
      query,
      k: 10,
      readableDocIds: [korean, english],
      includeFiles: false,
    });

    for (const query of [
      "검색", "검색기능", "기능", "한국", "한국어검색", "어검색", "테스트",
      "검색기능과", "한국어검색을", "테스트합",
    ]) {
      const hits = await search(query);
      expect(hits[0]?.docId, query).toBe(korean);
    }
    expect(await search("우주선 행성")).toEqual([]);
    expect((await search("quick"))[0]?.docId).toBe(english);
    expect((await search("database"))[0]?.docId).toBe(english);
  });
});
