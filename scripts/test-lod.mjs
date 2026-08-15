import { generateRoom } from "../src/scene.js";
import { buildOctree, selectLod } from "../src/octree.js";

const cloud = generateRoom(80000);
const tree = buildOctree(cloud, { maxLeaf: 48, maxDepth: 14 });
const cam = { eye: [0, 1.55, 3.5] };
const budget = 20000;
const picked = selectLod(tree, cam, budget, 16, 800);
const proxies = picked.filter((k) => k < 0).length;
const leaves = picked.length - proxies;
if (picked.length < budget * 0.8 && picked.length < cloud.count * 0.8) {
  console.error(`FAIL drew ${picked.length} expected ~${budget} of ${cloud.count}`);
  process.exit(1);
}
console.log(
  JSON.stringify({
    count: cloud.count,
    nodes: tree.nodes.length,
    picked: picked.length,
    leaves,
    proxies,
  })
);
