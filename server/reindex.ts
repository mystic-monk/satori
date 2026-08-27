import { rebuildIndex } from "./db.js";

const result = rebuildIndex();
console.log(`Reindexed ${result.count} notes from vault/ into .pkm/index.sqlite`);
