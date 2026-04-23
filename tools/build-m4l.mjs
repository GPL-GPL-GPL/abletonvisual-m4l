import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceDir = resolve(root, "src");
const packageDir = resolve(root, "package");

const sharedModules = ["av_util.js"];

const devices = [
  {
    name: "av-sync-sender",
    maxpat: "av-sync-sender.maxpat",
    amxdName: "av Sync Sender.amxd",
    modules: ["av_sync_sender.js", "audio_analyzer.js", "transport_poller.js"]
  },
  {
    name: "av-sync-hub",
    maxpat: "av-sync-hub.maxpat",
    amxdName: "av Sync Hub.amxd",
    modules: [
      "av_sync_hub.js",
      "config_loader.js",
      "osc_emitter.js",
      "osc_receiver.js",
      "handshake_client.js"
    ]
  }
];

rmSync(packageDir, { force: true, recursive: true });
mkdirSync(packageDir, { recursive: true });

for (const device of devices) {
  const outputDir = resolve(packageDir, device.name);
  const maxpatPath = resolve(sourceDir, device.maxpat);

  mkdirSync(outputDir, { recursive: true });

  cpSync(maxpatPath, resolve(outputDir, device.maxpat));
  for (const file of [...device.modules, ...sharedModules]) {
    cpSync(resolve(sourceDir, file), resolve(outputDir, file));
  }
  cpSync(resolve(root, "README.md"), resolve(outputDir, "README.md"));

  const patchBytes = readFileSync(maxpatPath);
  const header = Buffer.alloc(32);
  header.write("ampf", 0, "ascii");
  header.writeUInt32LE(4, 4);
  header.write("aaaa", 8, "ascii");
  header.write("meta", 12, "ascii");
  header.writeUInt32LE(4, 16);
  header.writeUInt32LE(7, 20);
  header.write("ptch", 24, "ascii");
  header.writeUInt32LE(patchBytes.length, 28);

  writeFileSync(resolve(outputDir, device.amxdName), Buffer.concat([header, patchBytes]));

  writeFileSync(
    resolve(outputDir, "manifest.json"),
    JSON.stringify(
      {
        name: device.name,
        version: "0.1.0",
        host: "127.0.0.1",
        port: 7777,
        files: [device.amxdName, device.maxpat, ...device.modules, ...sharedModules, "README.md"]
      },
      null,
      2
    )
  );

  console.log(`Packaged ${device.name} to ${outputDir}`);
}
