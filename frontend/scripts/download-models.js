/**
 * Downloads face-api.js model weights from GitHub into public/models/.
 * Runs automatically before `npm run dev` and `npm run build`.
 * Files are skipped if they already exist.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const MODEL_DIR = path.join(__dirname, "..", "public", "models");
const BASE =
  "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/";

const FILES = [
  "ssd_mobilenetv1_model-weights_manifest.json",
  "ssd_mobilenetv1_model-shard1",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model-shard1",
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model-shard1",
  "face_recognition_model-shard2",
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      console.log(`  skip  ${path.basename(dest)}`);
      return resolve();
    }
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          console.log(`  done  ${path.basename(dest)}`);
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}

async function main() {
  if (!fs.existsSync(MODEL_DIR)) fs.mkdirSync(MODEL_DIR, { recursive: true });
  console.log("Downloading face-api.js models…");
  for (const f of FILES) {
    await download(BASE + f, path.join(MODEL_DIR, f));
  }
  console.log("Models ready.\n");
}

main().catch((err) => {
  console.error("Model download failed:", err.message);
  process.exit(1);
});
